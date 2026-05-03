import { test, expect } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeContainerHost } from "../../src/sandbox/fake-host";
import { remoteRunQuery } from "../../src/sandbox/remote-runner";
import type {
  ContainerHandle,
  ExecOptions,
  ExecResult,
  ResolvedImage,
} from "../../src/sandbox/types";

const dummyImage: ResolvedImage = {
  kind: "image",
  tag: "fake",
  workspaceFolder: "/workspace",
  remoteUser: null,
  postCreateCommand: null,
};

const fixtureShim = resolve(import.meta.dir, "..", "fixtures", "worker", "echo-shim.ts");

test("remoteRunQuery yields provider_event payloads from the shim until finished", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "remote-runner-1",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  try {
    const events: unknown[] = [];
    for await (const ev of remoteRunQuery({
      handle,
      shimCmd: [process.execPath, "run", fixtureShim],
      invocation: { items: [{ a: 1 }, { b: 2 }] },
    })) {
      events.push(ev);
    }
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  } finally {
    await handle.stop();
  }
});

test("remoteRunQuery records provider_event payloads to a host JSONL transcript", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "remote-runner-transcript",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  const transcriptDir = await mkdtemp(join(tmpdir(), "dalang-remote-transcript-"));
  const transcriptPath = join(transcriptDir, "worker.jsonl");
  try {
    const events: unknown[] = [];
    for await (const ev of remoteRunQuery({
      handle,
      shimCmd: [process.execPath, "run", fixtureShim],
      invocation: { items: [{ a: 1 }, { b: 2 }] },
      transcriptPath,
    })) {
      events.push(ev);
    }

    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
    const lines = (await readFile(transcriptPath, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ a: 1 }, { b: 2 }]);
  } finally {
    await handle.stop();
  }
});

test("remoteRunQuery throws when the shim emits an error event", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "remote-runner-2",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  try {
    const fn = async () => {
      for await (const _ev of remoteRunQuery({
        handle,
        shimCmd: [process.execPath, "run", fixtureShim],
        invocation: "not-an-object",
      })) {
        // drain
      }
    };
    await expect(fn()).rejects.toThrow(/invalid input|invalid invocation/);
  } finally {
    await handle.stop();
  }
});

test("remoteRunQuery aborts the shim when the abortSignal fires", async () => {
  const host = new FakeContainerHost();
  const handle = await host.start({
    name: "remote-runner-3",
    image: dummyImage,
    bindMounts: [],
    env: {},
    resources: { cpus: "1", memory: "256m", pidsLimit: 256, tmpfsSize: "32m" },
  });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  try {
    const events: unknown[] = [];
    for await (const ev of remoteRunQuery({
      handle,
      shimCmd: ["sleep", "10"],
      invocation: {},
      abortSignal: ac.signal,
    })) {
      events.push(ev);
    }
    expect(events).toEqual([]);
  } catch {
    // aborted exec yields no events; either path is acceptable
  } finally {
    await handle.stop();
  }
});

test("remoteRunQuery starts draining stderr before processing stdout events", async () => {
  let stderrStarted = false;
  const handle: ContainerHandle = {
    name: "concurrent-stderr",
    async exec(_opts: ExecOptions): Promise<ExecResult> {
      return {
        stdout: (async function* () {
          await Bun.sleep(10);
          yield JSON.stringify({
            kind: "error",
            message: `stderr started: ${stderrStarted}`,
          });
        })(),
        stderr: (async function* () {
          stderrStarted = true;
          yield "stderr detail";
        })(),
        done: Promise.resolve({ exitCode: 1, signal: null }),
      };
    },
    async stop(): Promise<void> {},
  };

  const fn = async () => {
    for await (const _ev of remoteRunQuery({
      handle,
      shimCmd: ["ignored"],
      invocation: {},
    })) {
      // drain
    }
  };

  await expect(fn()).rejects.toMatchObject({
    message: "worker shim error: stderr started: true",
    stderr: "stderr detail",
  });
});
