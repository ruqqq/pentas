import { z } from "zod";
import { SandboxImageConfigSchema, SandboxResourcesSchema } from "../sandbox/types";

const ProviderPathsSchema = z
  .object({
    claude: z.object({ executablePath: z.string().min(1).default("claude") }).default({}),
    codex: z
      .object({
        executablePath: z.string().min(1).default("codex"),
        env: z.record(z.string(), z.string()).optional(),
      })
      .default({}),
    opencode: z.object({ executablePath: z.string().min(1).default("opencode") }).default({}),
  })
  .default({});

const SandboxGitConfigSchema = z.object({
  userName: z.string().min(1),
  userEmail: z.string().email(),
});

export const SandboxConfigSchema = z.object({
  enabled: z.boolean(),
  image: SandboxImageConfigSchema.default({ source: "devcontainer", path: ".devcontainer" }),
  resources: SandboxResourcesSchema,
  providers: ProviderPathsSchema,
  git: SandboxGitConfigSchema.optional(),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
