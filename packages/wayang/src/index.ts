#!/usr/bin/env bun
import { runWayang } from "./main";

const args = Bun.argv.slice(2);
let port: number | undefined;
let dbPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port") port = Number(args[++i]);
  else if (a === "--db") dbPath = args[++i];
}
runWayang({ port, dbPath });
