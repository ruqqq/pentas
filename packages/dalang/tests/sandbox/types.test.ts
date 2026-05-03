import { test, expect } from "bun:test";
import { SandboxImageConfigSchema, type ResolvedImage } from "../../src/sandbox/types";

test("SandboxImageConfigSchema accepts devcontainer source with default path", () => {
  const parsed = SandboxImageConfigSchema.parse({ source: "devcontainer" });
  expect(parsed).toEqual({ source: "devcontainer", path: ".devcontainer" });
});

test("SandboxImageConfigSchema accepts dockerfile source with explicit path", () => {
  const parsed = SandboxImageConfigSchema.parse({
    source: "dockerfile",
    path: "build/Dockerfile",
  });
  expect(parsed).toEqual({ source: "dockerfile", path: "build/Dockerfile" });
});

test("SandboxImageConfigSchema accepts image source with tag", () => {
  const parsed = SandboxImageConfigSchema.parse({
    source: "image",
    tag: "node:20-bullseye",
  });
  expect(parsed).toEqual({ source: "image", tag: "node:20-bullseye" });
});

test("SandboxImageConfigSchema rejects image source without tag", () => {
  const result = SandboxImageConfigSchema.safeParse({ source: "image" });
  expect(result.success).toBe(false);
});

test("ResolvedImage type allows compose mode with project file path", () => {
  const r: ResolvedImage = {
    kind: "compose",
    composeFile: "/abs/.devcontainer/docker-compose.yml",
    service: "app",
    workspaceFolder: "/workspace",
    remoteUser: "ubuntu",
    postCreateCommand: "bun install",
  };
  expect(r.kind).toBe("compose");
});
