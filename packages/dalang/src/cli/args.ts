// packages/dalang/src/cli/args.ts
export interface ParsedArgs {
  command: "serve" | "lint";
  workflowPath: string;
  port: number | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] === "lint") {
    const rest = argv.slice(1);
    if (rest.includes("--port")) throw new Error("--port is only valid for serve mode");
    if (rest.length > 1) throw new Error(`unexpected positional argument: ${rest[1]}`);
    return { command: "lint", workflowPath: rest[0] ?? "./WORKFLOW.md", port: null };
  }

  let workflowPath: string | null = null;
  let port: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--port") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--port requires a value");
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n < 0) throw new Error(`invalid --port value: ${v}`);
      port = n;
      continue;
    }
    if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    if (workflowPath !== null) throw new Error(`unexpected positional argument: ${a}`);
    workflowPath = a;
  }
  return { command: "serve", workflowPath: workflowPath ?? "./WORKFLOW.md", port };
}
