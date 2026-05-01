// packages/papan/src/cli/args.ts
export interface ParsedArgs {
  port?: number;
  dbPath?: string;
  help: boolean;
}

export const PAPAN_HELP = `Usage: papan [--port <port>] [--db <path>]

Options:
  --port <port>  Override the HTTP server port. Defaults to PAPAN_PORT or 3001.
  --db <path>    Override the SQLite database path. Defaults to PAPAN_DB_PATH or ~/.papan/papan.db.
  -h, --help     Print this help text and exit.
`;

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.some((a) => a === "--help" || a === "-h")) {
    return { port: undefined, dbPath: undefined, help: true };
  }

  let port: number | undefined;
  let dbPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--port") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--port requires a value");
      if (value.trim().length === 0) throw new Error("invalid --port value");
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) throw new Error(`invalid --port value: ${value}`);
      port = n;
      continue;
    }
    if (a === "--db") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--db requires a value");
      if (value.length === 0) throw new Error("invalid --db value");
      dbPath = value;
      continue;
    }
    if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    throw new Error(`unexpected positional argument: ${a}`);
  }

  return { port, dbPath, help: false };
}
