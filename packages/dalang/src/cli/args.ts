// packages/dalang/src/cli/args.ts
export interface ParsedArgs {
  workflowPath: string;
  port: number | null;
  help: boolean;
}

export const DALANG_HELP = `Usage: dalang [WORKFLOW.md] [--port <port>]

Options:
  --port <port>  Override the HTTP server port from WORKFLOW.md.
  -h, --help     Print this help text and exit.
`;

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.some((a) => a === "--help" || a === "-h")) {
    return { workflowPath: "./WORKFLOW.md", port: null, help: true };
  }

  let workflowPath: string | null = null;
  let port: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--port") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--port requires a value");
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new Error(`invalid --port value: ${v}`);
      port = n;
      continue;
    }
    if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    if (workflowPath !== null) throw new Error(`unexpected positional argument: ${a}`);
    workflowPath = a;
  }
  return { workflowPath: workflowPath ?? "./WORKFLOW.md", port, help: false };
}
