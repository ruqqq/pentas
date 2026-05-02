import { z } from "zod";

export const SandboxImageConfigSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("devcontainer"),
    path: z.string().min(1).default(".devcontainer"),
  }),
  z.object({
    source: z.literal("dockerfile"),
    path: z.string().min(1),
  }),
  z.object({
    source: z.literal("image"),
    tag: z.string().min(1),
  }),
]);

export type SandboxImageConfig = z.infer<typeof SandboxImageConfigSchema>;

export const SandboxResourcesSchema = z
  .object({
    cpus: z.string().min(1).default("2"),
    memory: z.string().min(1).default("4g"),
    pidsLimit: z.number().int().positive().default(1024),
    tmpfsSize: z.string().min(1).default("2g"),
  })
  .default({});

export type SandboxResources = z.infer<typeof SandboxResourcesSchema>;

export type ResolvedImage =
  | {
      kind: "image";
      tag: string;
      /** If set, the image must be built from this Dockerfile before run. */
      build?: { dockerfile: string; contextDir: string };
      workspaceFolder: string;
      remoteUser: string | null;
      postCreateCommand: string | null;
    }
  | {
      kind: "compose";
      composeFile: string;
      service: string;
      workspaceFolder: string;
      remoteUser: string | null;
      postCreateCommand: string | null;
    };

export interface BindMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface ContainerStartOptions {
  /** Stable identifier dalang picks (e.g. `dalang-<workerId>`); used as the container name and compose project. */
  name: string;
  image: ResolvedImage;
  bindMounts: BindMount[];
  env: Record<string, string>;
  resources: SandboxResources;
  /** Run as this user inside the container, falling back to the image's `remoteUser`. */
  user?: string;
}

export interface ExecOptions {
  cmd: string[];
  /** Working directory inside the container. */
  cwd?: string;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}

export interface ExecResult {
  /** Async iterable of stdout lines (no trailing newline). */
  stdout: AsyncIterable<string>;
  /** Async iterable of stderr lines. */
  stderr: AsyncIterable<string>;
  /** Resolves with the process exit code once both streams have ended. */
  done: Promise<{ exitCode: number; signal: NodeJS.Signals | null }>;
}

export interface ContainerHandle {
  /** Stable name supplied at start time. */
  readonly name: string;
  /** Run a command inside the started container. Multiple calls allowed. */
  exec(opts: ExecOptions): Promise<ExecResult>;
  /** Stop and remove the container (and any compose-side services). Idempotent. */
  stop(): Promise<void>;
}

export interface ContainerHost {
  start(opts: ContainerStartOptions): Promise<ContainerHandle>;
}

export class SandboxError extends Error {
  constructor(
    public readonly code:
      | "sandbox_unavailable"
      | "sandbox_image_unavailable"
      | "sandbox_start_failed"
      | "sandbox_exec_disconnected"
      | "sandbox_oom"
      | "sandbox_misconfigured",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SandboxError";
  }
}
