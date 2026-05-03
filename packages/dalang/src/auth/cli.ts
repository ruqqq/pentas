import { readFile } from "node:fs/promises";
import type { AuthStore } from "./store";

export interface AuthCliOptions {
  store: AuthStore;
  argv: string[];
  log: (line: string) => void;
}

export async function runAuthCli(opts: AuthCliOptions): Promise<number> {
  const [sub, ...rest] = opts.argv;
  switch (sub) {
    case "set":
      return runSet(opts.store, rest, opts.log);
    case "clear":
      return runClear(opts.store, rest, opts.log);
    case "status":
      return runStatus(opts.store, opts.log);
    default:
      opts.log(
        "usage: dalang auth <set|clear|status> [args]\n" +
          "  set claude --token <token>\n" +
          "  set codex --from <path-to-auth.json>\n" +
          "  set opencode --from <path-to-auth.json>\n" +
          "  clear <claude|codex|opencode>\n" +
          "  status",
      );
      return 2;
  }
}

async function runSet(store: AuthStore, args: string[], log: (l: string) => void): Promise<number> {
  const provider = args[0];
  if (provider === "claude") {
    const tokenIdx = args.indexOf("--token");
    if (tokenIdx === -1 || typeof args[tokenIdx + 1] !== "string") {
      log("auth set claude requires --token <token>");
      return 2;
    }
    await store.setClaudeToken(args[tokenIdx + 1] as string);
    log("claude token stored");
    return 0;
  }
  if (provider === "codex" || provider === "opencode") {
    const fromIdx = args.indexOf("--from");
    if (fromIdx === -1 || typeof args[fromIdx + 1] !== "string") {
      log(`auth set ${provider} requires --from <path>`);
      return 2;
    }
    const raw = await readFile(args[fromIdx + 1] as string, "utf8");
    if (provider === "codex") await store.setCodexAuthJson(raw);
    else await store.setOpencodeAuthJson(raw);
    log(`${provider} auth.json stored`);
    return 0;
  }
  log(`unknown provider: ${provider ?? "<none>"}`);
  return 2;
}

async function runClear(
  store: AuthStore,
  args: string[],
  log: (l: string) => void,
): Promise<number> {
  const provider = args[0];
  switch (provider) {
    case "claude":
      await store.clearClaudeToken();
      break;
    case "codex":
      await store.clearCodexAuthJson();
      break;
    case "opencode":
      await store.clearOpencodeAuthJson();
      break;
    default:
      log(`unknown provider: ${provider ?? "<none>"}`);
      return 2;
  }
  log(`${provider} cleared`);
  return 0;
}

async function runStatus(store: AuthStore, log: (l: string) => void): Promise<number> {
  const claude = (await store.getClaudeToken()) !== null ? "configured" : "missing";
  const codex = (await store.getCodexAuthJson()) !== null ? "configured" : "missing";
  const opencode = (await store.getOpencodeAuthJson()) !== null ? "configured" : "missing";
  log(`claude:    ${claude}`);
  log(`codex:     ${codex}`);
  log(`opencode:  ${opencode}`);
  return 0;
}
