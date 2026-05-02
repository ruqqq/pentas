import type {
  BindMount,
  ContainerHandle,
  ContainerHost,
  ContainerStartOptions,
  ExecOptions,
  ExecResult,
} from "./types";

class LineStream implements AsyncIterable<string> {
  constructor(private readonly source: ReadableStream<Uint8Array>) {}
  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    const decoder = new TextDecoder();
    let buf = "";
    const reader = this.source.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          yield buf.slice(0, nl);
          buf = buf.slice(nl + 1);
        }
      }
      if (buf.length > 0) yield buf;
    } finally {
      reader.releaseLock();
    }
  }
}

function translateCwd(cwd: string | undefined, mounts: readonly BindMount[]): string | undefined {
  if (!cwd) return undefined;
  for (const m of mounts) {
    if (cwd === m.containerPath) return m.hostPath;
    if (cwd.startsWith(`${m.containerPath}/`)) {
      return `${m.hostPath}/${cwd.slice(m.containerPath.length + 1)}`;
    }
  }
  return cwd;
}

class FakeHandle implements ContainerHandle {
  constructor(
    public readonly name: string,
    private readonly mounts: readonly BindMount[],
    private readonly env: Readonly<Record<string, string>>,
  ) {}

  async exec(opts: ExecOptions): Promise<ExecResult> {
    const cwd = translateCwd(opts.cwd, this.mounts);
    const proc = Bun.spawn(opts.cmd, {
      cwd,
      env: { ...this.env, ...(opts.env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) proc.kill();
      else opts.abortSignal.addEventListener("abort", () => proc.kill(), { once: true });
    }
    const done = (async () => {
      const exitCode = await proc.exited;
      return { exitCode, signal: null as NodeJS.Signals | null };
    })();
    return {
      stdout: new LineStream(proc.stdout),
      stderr: new LineStream(proc.stderr),
      done,
    };
  }

  async stop(): Promise<void> {
    // No-op for the fake.
  }
}

export class FakeContainerHost implements ContainerHost {
  async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
    return new FakeHandle(opts.name, opts.bindMounts, opts.env);
  }
}
