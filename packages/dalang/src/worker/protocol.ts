import { z } from "zod";

const ClaudeInvocationSchema = z.object({
  provider: z.literal("claude"),
  prompt: z.string(),
  cwd: z.string().min(1),
  model: z.string().min(1),
  executablePath: z.string().min(1),
  resumeSessionId: z.string().min(1).optional(),
  claude: z.object({
    permissionMode: z.enum(["auto", "default", "plan", "bypassPermissions"]),
  }),
});

const CodexInvocationSchema = z.object({
  provider: z.literal("codex"),
  prompt: z.string(),
  cwd: z.string().min(1),
  model: z.string().min(1),
  executablePath: z.string().min(1),
  resumeSessionId: z.string().min(1).optional(),
  codex: z.object({
    sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]),
    approvalPolicy: z.enum(["untrusted", "on-failure", "on-request", "never"]),
    networkAccessEnabled: z.boolean(),
    env: z.record(z.string(), z.string()).optional(),
    git: z
      .object({
        userName: z.string().min(1),
        userEmail: z.string().email(),
      })
      .optional(),
  }),
});

const OpencodeInvocationSchema = z.object({
  provider: z.literal("opencode"),
  prompt: z.string(),
  cwd: z.string().min(1),
  model: z.string().min(1),
  executablePath: z.string().min(1),
  resumeSessionId: z.string().min(1).optional(),
});

export const WorkerInvocationSchema = z.discriminatedUnion("provider", [
  ClaudeInvocationSchema,
  CodexInvocationSchema,
  OpencodeInvocationSchema,
]);

export type WorkerInvocation = z.infer<typeof WorkerInvocationSchema>;

export const WorkerEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("provider_event"),
    payload: z.unknown(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    /** Optional structured detail; opaque to the host. */
    detail: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("finished"),
  }),
]);

export type WorkerEvent = z.infer<typeof WorkerEventSchema>;

/** Serializes a single event as a single NDJSON line (no trailing newline). */
export function serializeEvent(ev: WorkerEvent): string {
  return JSON.stringify(ev);
}
