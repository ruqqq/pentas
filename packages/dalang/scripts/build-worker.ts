import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const root = resolve(import.meta.dir, "..");
const entry = resolve(root, "src/worker/main.ts");
const outDir = resolve(root, "dist");
const outFile = resolve(outDir, "dalang-worker");

await mkdir(outDir, { recursive: true });

const proc = Bun.spawn(["bun", "build", "--compile", entry, "--outfile", outFile], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
const code = await proc.exited;
if (code !== 0) process.exit(code);
console.log(`built ${outFile}`);
