import type { RunQueryOptions } from "./agent-runner";

export const CLAUDE_ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "MultiEdit",
  "Write",
  "Bash",
  "TodoWrite",
] as const;

export function isolatedClaudeEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CONFIG_DIR: process.env["DALANG_CLAUDE_CONFIG_DIR"] ?? "/tmp/dalang-claude-config",
  };
}

export function buildClaudeQueryOptions(
  opts: Extract<RunQueryOptions, { claude: unknown }>,
  abortController?: AbortController,
): Parameters<typeof import("@anthropic-ai/claude-agent-sdk").query>[0] {
  return {
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.claude.permissionMode,
      ...(opts.claude.effort !== undefined ? { effort: opts.claude.effort } : {}),
      pathToClaudeCodeExecutable: opts.executablePath,
      resume: opts.resumeSessionId,
      abortController,
      settingSources: [],
      mcpServers: {},
      allowedTools: [...CLAUDE_ALLOWED_TOOLS],
      env: isolatedClaudeEnv(),
    },
  };
}
