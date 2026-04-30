import { expect, test } from "bun:test";
import { applyDefaults } from "../../src/config/schema";
import { createControlPlaneAdapter } from "../../src/control-plane/factory";
import { GithubProjectsControlPlaneAdapter } from "../../src/control-plane/github/adapter";
import { PapanControlPlaneAdapter } from "../../src/control-plane/papan-adapter";

test("factory creates Papan control plane", () => {
  const cfg = applyDefaults({});
  const adapter = createControlPlaneAdapter({
    config: cfg,
    trackerEndpoint: null,
    trackerApiKey: undefined,
  });
  expect(adapter).toBeInstanceOf(PapanControlPlaneAdapter);
});

test("factory creates GitHub Projects control plane", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 4,
      repository: "acme/app",
      token: "token-1",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });
  const adapter = createControlPlaneAdapter({
    config: cfg,
    trackerEndpoint: null,
    trackerApiKey: undefined,
  });
  expect(adapter).toBeInstanceOf(GithubProjectsControlPlaneAdapter);
});

test("factory resolves GitHub token environment references", () => {
  process.env.DALANG_FACTORY_GITHUB_TOKEN = "resolved-token";
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 4,
      repository: "acme/app",
      token: "$DALANG_FACTORY_GITHUB_TOKEN",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });

  const adapter = createControlPlaneAdapter({
    config: cfg,
    trackerEndpoint: null,
    trackerApiKey: undefined,
  });

  expect(adapter).toBeInstanceOf(GithubProjectsControlPlaneAdapter);
  expect((adapter as GithubProjectsControlPlaneAdapter).cfg.token).toBe("resolved-token");
});

test("factory falls back to GITHUB_TOKEN for GitHub Projects", () => {
  process.env.GITHUB_TOKEN = "env-token";
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 4,
      repository: "acme/app",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });

  const adapter = createControlPlaneAdapter({
    config: cfg,
    trackerEndpoint: null,
    trackerApiKey: undefined,
  });

  expect(adapter).toBeInstanceOf(GithubProjectsControlPlaneAdapter);
  expect((adapter as GithubProjectsControlPlaneAdapter).cfg.token).toBe("env-token");
  delete process.env.GITHUB_TOKEN;
});

test("github adapter does not advertise pr checks when disabled", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 4,
      repository: "acme/app",
      token: "token-1",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
    },
  });
  const adapter = createControlPlaneAdapter({
    config: cfg,
    trackerEndpoint: null,
    trackerApiKey: undefined,
  });

  expect(adapter.capabilities.prChecks).toBeUndefined();
});

test("github adapter advertises pr checks when enabled", () => {
  const cfg = applyDefaults({
    control_plane: {
      kind: "github-projects",
      owner_type: "organization",
      owner: "acme",
      project_number: 4,
      repository: "acme/app",
      token: "token-1",
      status_field: "Status",
      active_states: ["Todo"],
      terminal_states: ["Done"],
      ownership: { mode: "label", value: "dalang" },
      pr_checks: { enabled: true },
    },
  });
  const adapter = createControlPlaneAdapter({
    config: cfg,
    trackerEndpoint: null,
    trackerApiKey: undefined,
  });

  expect(adapter.capabilities.prChecks).toBe(true);
});
