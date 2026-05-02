import {
  SandboxError,
  type BindMount,
  type ContainerHandle,
  type ContainerHost,
  type ContainerStartOptions,
  type ExecOptions,
  type ExecResult,
  type ResolvedImage,
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

async function readToEnd(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function bindMountFlag(m: BindMount): string {
  const ro = m.readOnly ? `,readonly` : "";
  return `--mount=type=bind,source=${m.hostPath},target=${m.containerPath}${ro}`;
}

class DockerHandle implements ContainerHandle {
  constructor(public readonly name: string) {}

  async exec(opts: ExecOptions): Promise<ExecResult> {
    const args = ["exec", "-i"];
    if (opts.cwd) args.push("--workdir", opts.cwd);
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      args.push("--env", `${k}=${v}`);
    }
    args.push(this.name, ...opts.cmd);

    const proc = Bun.spawn(["docker", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (opts.abortSignal) {
      const onAbort = () => {
        Bun.spawn(["docker", "kill", "--signal", "TERM", this.name]).exited.catch(() => {});
      };
      if (opts.abortSignal.aborted) onAbort();
      else opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
    const done = (async () => {
      const exitCode = await proc.exited;
      if (exitCode === 137) {
        throw new SandboxError("sandbox_oom", `container ${this.name} exec OOM-killed`);
      }
      return { exitCode, signal: null as NodeJS.Signals | null };
    })();
    return {
      stdout: new LineStream(proc.stdout),
      stderr: new LineStream(proc.stderr),
      done,
    };
  }

  async stop(): Promise<void> {
    // Best-effort stop + rm. Ignore "no such container" failures (idempotent).
    const stop = Bun.spawn(["docker", "stop", "--time", "5", this.name], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await stop.exited;
    const rm = Bun.spawn(["docker", "rm", "--force", this.name], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await rm.exited;
  }
}

async function ensureImageBuilt(image: ResolvedImage): Promise<void> {
  if (image.kind !== "image" || image.build === undefined) return;
  const inspect = Bun.spawn(["docker", "image", "inspect", image.tag], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await inspect.exited) === 0) return;

  const { dockerfile, contextDir } = image.build;
  const proc = Bun.spawn(
    ["docker", "build", "--tag", image.tag, "--file", dockerfile, contextDir],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await readToEnd(proc.stderr);
    throw new SandboxError(
      "sandbox_image_unavailable",
      `docker build failed: ${stderr.trim()}`,
    );
  }
}

function imageRunArgs(image: ResolvedImage): { tag: string } {
  if (image.kind !== "image") {
    throw new SandboxError(
      "sandbox_misconfigured",
      `DockerContainerHost.start cannot run a compose image directly`,
    );
  }
  return { tag: image.tag };
}

class ComposeHandle implements ContainerHandle {
  constructor(
    public readonly name: string,
    private readonly composeFile: string,
    private readonly service: string,
  ) {}

  async exec(opts: ExecOptions): Promise<ExecResult> {
    const args = ["compose", "--project-name", this.name, "--file", this.composeFile, "exec"];
    if (opts.cwd) args.push("--workdir", opts.cwd);
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      args.push("--env", `${k}=${v}`);
    }
    args.push("-T", this.service, ...opts.cmd);
    const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    if (opts.abortSignal) {
      const onAbort = () => {
        Bun.spawn([
          "docker",
          "compose",
          "--project-name",
          this.name,
          "--file",
          this.composeFile,
          "kill",
          "--signal",
          "SIGTERM",
          this.service,
        ]).exited.catch(() => {});
      };
      if (opts.abortSignal.aborted) onAbort();
      else opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
    const done = (async () => {
      const exitCode = await proc.exited;
      if (exitCode === 137) {
        throw new SandboxError("sandbox_oom", `compose exec ${this.service} OOM-killed`);
      }
      return { exitCode, signal: null as NodeJS.Signals | null };
    })();
    return {
      stdout: new LineStream(proc.stdout),
      stderr: new LineStream(proc.stderr),
      done,
    };
  }

  async stop(): Promise<void> {
    const proc = Bun.spawn(
      [
        "docker",
        "compose",
        "--project-name",
        this.name,
        "--file",
        this.composeFile,
        "down",
        "--volumes",
        "--remove-orphans",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
  }
}

export class DockerContainerHost implements ContainerHost {
  async start(opts: ContainerStartOptions): Promise<ContainerHandle> {
    if (opts.image.kind === "compose") {
      return this.startCompose(opts, opts.image);
    }
    await ensureImageBuilt(opts.image);
    const { tag } = imageRunArgs(opts.image);

    const args: string[] = [
      "run",
      "--detach",
      "--name",
      opts.name,
      "--cpus",
      opts.resources.cpus,
      "--memory",
      opts.resources.memory,
      "--pids-limit",
      String(opts.resources.pidsLimit),
      "--tmpfs",
      `/tmp:rw,size=${opts.resources.tmpfsSize}`,
    ];

    if (opts.user !== undefined) args.push("--user", opts.user);
    else if (opts.image.remoteUser !== null) args.push("--user", opts.image.remoteUser);

    for (const m of opts.bindMounts) args.push(bindMountFlag(m));
    for (const [k, v] of Object.entries(opts.env)) args.push("--env", `${k}=${v}`);

    args.push(tag);
    // Keep the container alive for `docker exec` to attach to.
    args.push("sleep", "infinity");

    const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    const exit = await proc.exited;
    if (exit !== 0) {
      const stderr = await readToEnd(proc.stderr);
      if (/no such image|pull access denied|manifest unknown|unable to find image/i.test(stderr)) {
        throw new SandboxError(
          "sandbox_image_unavailable",
          `docker run failed: ${stderr.trim()}`,
        );
      }
      throw new SandboxError("sandbox_start_failed", `docker run failed: ${stderr.trim()}`);
    }

    return new DockerHandle(opts.name);
  }

  private async startCompose(
    opts: ContainerStartOptions,
    image: Extract<ResolvedImage, { kind: "compose" }>,
  ): Promise<ContainerHandle> {
    // TODO(v1, §10): Compose mode does not yet apply opts.resources (cpus/memory/etc.) — those flags
    // belong on the compose file's `deploy.resources` block, not on the parent process. Tracked as a
    // known limitation in the design spec.
    const proc = Bun.spawn(
      [
        "docker",
        "compose",
        "--project-name",
        opts.name,
        "--file",
        image.composeFile,
        "up",
        "--detach",
        "--wait",
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await readToEnd(proc.stderr);
      throw new SandboxError(
        "sandbox_start_failed",
        `docker compose up failed: ${stderr.trim()}`,
      );
    }
    return new ComposeHandle(opts.name, image.composeFile, image.service);
  }
}
