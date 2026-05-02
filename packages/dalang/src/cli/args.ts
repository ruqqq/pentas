// packages/dalang/src/cli/args.ts
export interface ParsedArgs {
  command: "serve" | "lint" | "auth" | "sandbox-doctor";
  workflowPath: string;
  port: number | null;
  help: boolean;
  /** Populated only when command === "auth"; contains the args after `auth`. */
  authArgv?: string[];
}

export const DALANG_HELP = `Usage: dalang [WORKFLOW.md] [--port <port>]
       dalang lint [WORKFLOW.md]
       dalang sandbox doctor [WORKFLOW.md]
       dalang auth <set|clear|status> [args]

Options:
  --port <port>  Override the HTTP server port from WORKFLOW.md.
  -h, --help     Print this help text and exit.
`;

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] === "auth") {
    return {
      command: "auth",
      workflowPath: "",
      port: null,
      help: false,
      authArgv: argv.slice(1),
    };
  }

  if (argv.some((a) => a === "--help" || a === "-h")) {
    return { command: "serve", workflowPath: "./WORKFLOW.md", port: null, help: true };
  }

  if (argv[0] === "lint") {
    const rest = argv.slice(1);
    if (rest.includes("--port")) throw new Error("--port is only valid for serve mode");
    if (rest.length > 1) throw new Error(`unexpected positional argument: ${rest[1]}`);
    return { command: "lint", workflowPath: rest[0] ?? "./WORKFLOW.md", port: null, help: false };
  }

  if (argv[0] === "sandbox") {
    if (argv[1] !== "doctor") throw new Error("expected sandbox subcommand: doctor");
    const rest = argv.slice(2);
    if (rest.includes("--port")) throw new Error("--port is only valid for serve mode");
    if (rest.length > 1) throw new Error(`unexpected positional argument: ${rest[1]}`);
    return {
      command: "sandbox-doctor",
      workflowPath: rest[0] ?? "./WORKFLOW.md",
      port: null,
      help: false,
    };
  }

  let workflowPath: string | null = null;
  let port: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--port") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--port requires a value");
      if (v.trim().length === 0) throw new Error("invalid --port value");
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new Error(`invalid --port value: ${v}`);
      port = n;
      continue;
    }
    if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    if (workflowPath !== null) throw new Error(`unexpected positional argument: ${a}`);
    workflowPath = a;
  }
  return { command: "serve", workflowPath: workflowPath ?? "./WORKFLOW.md", port, help: false };
}
