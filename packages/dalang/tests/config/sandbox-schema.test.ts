import { test, expect } from "bun:test";
import { SandboxConfigSchema } from "../../src/config/sandbox-schema";

test("default disabled config parses with no fields", () => {
  expect(SandboxConfigSchema.parse({ enabled: false })).toEqual({
    enabled: false,
    image: { source: "devcontainer", path: ".devcontainer" },
    resources: { cpus: "2", memory: "4g", pidsLimit: 1024, tmpfsSize: "2g" },
    providers: {
      claude: { executablePath: "claude" },
      codex: { executablePath: "codex" },
      opencode: { executablePath: "opencode" },
    },
  });
});

test("enabled config can override image source", () => {
  const parsed = SandboxConfigSchema.parse({
    enabled: true,
    image: { source: "image", tag: "node:20-bullseye" },
  });
  expect(parsed.enabled).toBe(true);
  expect(parsed.image).toEqual({ source: "image", tag: "node:20-bullseye" });
});

test("enabled config can override resources and provider paths", () => {
  const parsed = SandboxConfigSchema.parse({
    enabled: true,
    resources: { cpus: "4", memory: "8g" },
    providers: { codex: { executablePath: "/opt/dalang/codex" } },
  });
  expect(parsed.resources.cpus).toBe("4");
  expect(parsed.resources.memory).toBe("8g");
  expect(parsed.resources.pidsLimit).toBe(1024);
  expect(parsed.providers.codex.executablePath).toBe("/opt/dalang/codex");
  expect(parsed.providers.claude.executablePath).toBe("claude");
});

test("invalid resource cpus is rejected", () => {
  expect(
    SandboxConfigSchema.safeParse({ enabled: true, resources: { cpus: "" } }).success,
  ).toBe(false);
});
