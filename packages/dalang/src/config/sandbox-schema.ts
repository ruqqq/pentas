import { z } from "zod";
import { SandboxImageConfigSchema, SandboxResourcesSchema } from "../sandbox/types";

const ProviderPathsSchema = z
  .object({
    claude: z.object({ executablePath: z.string().min(1).default("claude") }).default({}),
    codex: z.object({ executablePath: z.string().min(1).default("codex") }).default({}),
    opencode: z.object({ executablePath: z.string().min(1).default("opencode") }).default({}),
  })
  .default({});

export const SandboxConfigSchema = z.object({
  enabled: z.boolean(),
  image: SandboxImageConfigSchema.default({ source: "devcontainer", path: ".devcontainer" }),
  resources: SandboxResourcesSchema,
  providers: ProviderPathsSchema,
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
