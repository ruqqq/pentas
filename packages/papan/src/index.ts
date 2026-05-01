#!/usr/bin/env bun
import { PAPAN_HELP, parseArgs } from "./cli/args";
import { runPapan } from "./main";

const args = parseArgs(Bun.argv.slice(2));
if (args.help) {
  console.log(PAPAN_HELP.trimEnd());
  process.exit(0);
}

runPapan({ port: args.port, dbPath: args.dbPath });
