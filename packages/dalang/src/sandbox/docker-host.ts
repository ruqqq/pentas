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
    private readonly composeFiles: string[],
    private readonly service: string,
  ) {}

  private composeFlags(): string[] {
    const out: string[] = ["compose", "--project-name", this.name];
    for (const f of this.composeFiles) {
      out.push("--file", f);
    }
    return out;
  }

  async exec(opts: ExecOptions): Promise<ExecResult> {
    const args = [...this.composeFlags(), "exec"];
    if (opts.cwd) args.push("--workdir", opts.cwd);
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      args.push("--env", `${k}=${v}`);
    }
    args.push("-T", this.service, ...opts.cmd);
    const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
    if (opts.abortSignal) {
      const onAbort = () => {
        Bun.spawn(
          ["docker", ...this.composeFlags(), "kill", "--signal", "SIGTERM", this.service],
        ).exited.catch(() => {});
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
      ["docker", ...this.composeFlags(), "down", "--volumes", "--remove-orphans"],
      { stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
    // Best-effort: remove any overlay file we wrote (composeFiles[1+] are dalang-controlled).
    for (const f of this.composeFiles.slice(1)) {
      await Bun.spawn(["rm", "-f", f], { stdout: "ignore", stderr: "ignore" }).exited;
    }
  }
}

/**
 * Extract the owning dalang process PID from a worker name. Worker names
 * have the form `dalang-worker-<pid>-<counter>`. Returns null if the name
 * doesn't parse.
 */
function ownerPidOf(name: string): number | null {
  const m = name.match(/^dalang-worker-(\d+)-\d+$/);
  if (!m || m[1] === undefined) return null;
  const pid = Number(m[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Returns true if a process with the given PID is alive on this host. Uses
 * /proc when available (Linux), falls back to `kill -0` semantics via
 * `process.kill(pid, 0)` (which doesn't actually send a signal — just probes).
 */
function isHostPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. EPERM: process exists but we can't signal it
    // (still alive, just owned by another user).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Tear down `dalang-worker-*` containers and compose projects whose owning
 * dalang process is no longer running. Safe to call when other dalang
 * instances are active on the same host — their live workers are skipped.
 * Idempotent. Does not error on hosts without Docker — the spawn calls
 * fail silently.
 */
export async function sweepOrphanWorkers(): Promise<{
  containersRemoved: string[];
  composeProjectsRemoved: string[];
  skippedLive: string[];
}> {
  const containersRemoved: string[] = [];
  const composeProjectsRemoved: string[] = [];
  const skippedLive: string[] = [];

  // 1. Image-kind containers: anything named dalang-worker-* whose owner is gone.
  const psProc = Bun.spawn(
    ["docker", "ps", "-a", "--filter", "name=^dalang-worker-", "--format", "{{.Names}}"],
    { stdout: "pipe", stderr: "ignore" },
  );
  if ((await psProc.exited) === 0) {
    const names = (await new Response(psProc.stdout).text()).trim().split("\n").filter(Boolean);
    for (const name of names) {
      const ownerPid = ownerPidOf(name);
      if (ownerPid !== null && isHostPidAlive(ownerPid)) {
        skippedLive.push(name);
        continue;
      }
      const rm = Bun.spawn(["docker", "rm", "--force", name], {
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await rm.exited) === 0) containersRemoved.push(name);
    }
  }

  // 2. Compose projects named dalang-worker-* whose owner is gone.
  const lsProc = Bun.spawn(
    ["docker", "compose", "ls", "--all", "--filter", "name=dalang-worker-", "--format", "json"],
    { stdout: "pipe", stderr: "ignore" },
  );
  if ((await lsProc.exited) === 0) {
    const raw = (await new Response(lsProc.stdout).text()).trim();
    if (raw.length > 0) {
      try {
        const entries = JSON.parse(raw) as Array<{ Name?: string; ConfigFiles?: string }>;
        for (const e of entries) {
          if (typeof e.Name !== "string" || !e.Name.startsWith("dalang-worker-")) continue;
          const ownerPid = ownerPidOf(e.Name);
          if (ownerPid !== null && isHostPidAlive(ownerPid)) {
            skippedLive.push(e.Name);
            continue;
          }
          const args = ["compose", "--project-name", e.Name];
          if (typeof e.ConfigFiles === "string" && e.ConfigFiles.length > 0) {
            for (const f of e.ConfigFiles.split(",")) {
              args.push("--file", f);
            }
          }
          args.push("down", "--volumes", "--remove-orphans");
          const proc = Bun.spawn(["docker", ...args], { stdout: "ignore", stderr: "ignore" });
          if ((await proc.exited) === 0) composeProjectsRemoved.push(e.Name);
        }
      } catch {
        // Older docker compose CLIs may not emit valid JSON; skip the parse.
      }
    }
  }

  return { containersRemoved, composeProjectsRemoved, skippedLive };
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

    const composeFiles = [image.composeFile];

    // If we have additional bind mounts or env, write an overlay compose file
    // that compose will deep-merge with the user's compose file.
    if (opts.bindMounts.length > 0 || Object.keys(opts.env).length > 0) {
      const overlayPath = await writeComposeOverlay(image, opts);
      composeFiles.push(overlayPath);
    }

    const upArgs = ["compose", "--project-name", opts.name];
    for (const f of composeFiles) {
      upArgs.push("--file", f);
    }
    upArgs.push("up", "--detach", "--wait");
    const proc = Bun.spawn(["docker", ...upArgs], { stdout: "ignore", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await readToEnd(proc.stderr);
      throw new SandboxError(
        "sandbox_start_failed",
        `docker compose up failed: ${stderr.trim()}`,
      );
    }
    return new ComposeHandle(opts.name, composeFiles, image.service);
  }
}

async function writeComposeOverlay(
  image: Extract<ResolvedImage, { kind: "compose" }>,
  opts: ContainerStartOptions,
): Promise<string> {
  const overlayDir = `${process.env["TMPDIR"] ?? "/tmp"}/dalang-overlay-${opts.name}`;
  const overlayPath = `${overlayDir}/overlay.compose.yml`;
  await Bun.spawn(["mkdir", "-p", overlayDir], { stdout: "ignore", stderr: "ignore" }).exited;

  // Volumes use compose's short syntax: "host:container:mode". Always double-quote
  // the whole triple so `:` inside paths or modifiers can't be misparsed as YAML
  // mapping separators. Embedded `"` and `\` get escaped.
  const volumes = opts.bindMounts.map((m) => {
    const triple = `${m.hostPath}:${m.containerPath}:${m.readOnly ? "ro" : "rw"}`;
    return `      - ${yamlDouble(triple)}`;
  });
  const envEntries = Object.entries(opts.env).map(
    ([k, v]) => `      ${yamlScalarKey(k)}: ${yamlDouble(v)}`,
  );

  let body = `services:\n  ${yamlScalarKey(image.service)}:\n`;
  if (volumes.length > 0) {
    body += `    volumes:\n${volumes.join("\n")}\n`;
  }
  if (envEntries.length > 0) {
    body += `    environment:\n${envEntries.join("\n")}\n`;
  }
  await Bun.write(overlayPath, body);
  return overlayPath;
}

function yamlDouble(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlScalarKey(s: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : yamlDouble(s);
}
