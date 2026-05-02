// packages/dalang/src/cli/bootstrap.ts
import { resolve } from "node:path";
import { WorkflowReloader } from "../config/reload";
import {
  validateForDispatch,
  probeClaudeAuth,
  probeCodexAuth,
  probeOpencodeAuth,
  ValidationError,
} from "../config/validate";
import { Orchestrator } from "../orchestrator/orchestrator";
import { createControlPlaneAdapter } from "../control-plane/factory";
import { sdkRunQuery } from "../agent/sdk-runner";
import { codexRunQuery } from "../agent/codex-runner";
import { opencodeRunQuery } from "../agent/opencode-runner";
import { shutdownOpencodeServer } from "../agent/opencode-server";
import { startServer, type ServerHandle } from "../http/server";
import { createLogger, type Logger } from "../logging/logger";
import type { RunQuery } from "../agent/agent-runner";

export interface BootstrapOptions {
  workflowPath: string;
  port: number | null;
  skipAuthProbe?: boolean;
  runQueryFactory?: () => RunQuery;
  logger?: Logger;
  /** If set, overrides workflow's Papan control-plane endpoint (e.g. for in-process papan). */
  trackerEndpoint?: string;
  /** If set, overrides workflow's Papan control-plane api_key. */
  trackerApiKey?: string | null;
}

export class Bootstrap {
  private reloader: WorkflowReloader;
  private orch: Orchestrator | null = null;
  private server: ServerHandle | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly opts: BootstrapOptions;
  private readonly log: Logger;

  constructor(opts: BootstrapOptions) {
    this.opts = opts;
    this.log = opts.logger ?? createLogger({ name: "dalang", level: "info" });
    this.reloader = new WorkflowReloader(opts.workflowPath);
  }

  serverPort(): number {
    return this.server?.port ?? 0;
  }

  async checkWorkflowReload(): Promise<void> {
    await this.reloader.checkMtimeReload();
  }

  async start(): Promise<void> {
    await this.reloader.start();
    const wf = this.reloader.current();
    validateForDispatch(wf.config);
    const sandboxed = wf.config.sandbox?.enabled === true;
    if (!this.opts.skipAuthProbe && !sandboxed) {
      if (wf.config.agent_provider === "codex") {
        const err = await probeCodexAuth(wf.config.codex!.executable_path);
        if (err) throw new ValidationError("codex_auth_inactive", err);
      } else if (wf.config.agent_provider === "opencode") {
        const err = await probeOpencodeAuth(
          wf.config.opencode!.executable_path,
          wf.config.opencode!.model,
        );
        if (err) {
          // The probe distinguishes binary failure from missing-provider-auth in its message,
          // so map the message prefix to the right ValidationCode.
          const code = err.startsWith("opencode auth probe: provider")
            ? "opencode_provider_not_authed"
            : "opencode_auth_inactive";
          throw new ValidationError(code, err);
        }
      } else {
        const err = await probeClaudeAuth(wf.config.claude!.executable_path);
        if (err) throw new ValidationError("claude_auth_inactive", err);
      }
    }
    if (!this.opts.skipAuthProbe && sandboxed) {
      const { FilesystemAuthStore, defaultStoreRoot } = await import("../auth/store");
      const store = new FilesystemAuthStore(defaultStoreRoot());
      const provider = wf.config.agent_provider;
      const credential =
        provider === "claude"
          ? await store.getClaudeToken()
          : provider === "codex"
            ? await store.getCodexAuthJson()
            : await store.getOpencodeAuthJson();
      if (credential === null) {
        throw new ValidationError(
          provider === "claude"
            ? "claude_auth_inactive"
            : provider === "codex"
              ? "codex_auth_inactive"
              : "opencode_auth_inactive",
          `sandbox enabled but no ${provider} credential in dalang's store; run \`dalang auth set ${provider} ...\``,
        );
      }
    }
    const controlPlane = createControlPlaneAdapter({
      config: wf.config,
      trackerEndpoint: this.opts.trackerEndpoint ?? null,
      trackerApiKey: this.opts.trackerApiKey,
    });
    await controlPlane.validateConnection?.();
    let runQuery: RunQuery;
    if (this.opts.runQueryFactory) {
      runQuery = this.opts.runQueryFactory();
    } else if (sandboxed) {
      const { DockerContainerHost } = await import("../sandbox/docker-host");
      const { FilesystemAuthStore, defaultStoreRoot } = await import("../auth/store");
      const { createSandboxedRunQuery } = await import("../sandbox/sandboxed-runner");
      const { resolve } = await import("node:path");
      const sandboxesRoot = resolve(wf.config.workspace.root, ".dalang", "sandboxes");
      const shimPath = process.env["DALANG_SHIM_PATH"];
      this.log.info(
        {
          provider: wf.config.agent_provider,
          imageSource: wf.config.sandbox!.image.source,
          sandboxesRoot,
          shimBinaryHostPath: shimPath ?? "(none — shim must be on PATH inside the image)",
        },
        "sandboxed runner selected",
      );
      runQuery = createSandboxedRunQuery({
        host: new DockerContainerHost(),
        store: new FilesystemAuthStore(defaultStoreRoot()),
        sandboxesRoot,
        repoDir: process.cwd(),
        config: wf.config.sandbox!,
        ...(shimPath ? { shimBinaryHostPath: shimPath } : {}),
        onLifecycleEvent: (e) => {
          // Lifecycle events with structured detail go to info; failure kinds escalate to warn.
          const failureKinds = new Set([
            "sandbox_unavailable",
            "sandbox_image_unavailable",
            "sandbox_start_failed",
            "sandbox_exec_disconnected",
            "sandbox_oom",
            "sandbox_auth_refresh_conflict",
            "sandbox_misconfigured",
          ]);
          const log = failureKinds.has(e.kind) ? this.log.warn.bind(this.log) : this.log.info.bind(this.log);
          log({ kind: e.kind, message: e.message, detail: e.detail }, "sandbox lifecycle");
        },
      });
    } else {
      runQuery =
        wf.config.agent_provider === "codex"
          ? codexRunQuery
          : wf.config.agent_provider === "opencode"
            ? opencodeRunQuery
            : sdkRunQuery;
    }
    this.orch = new Orchestrator({
      controlPlane,
      config: wf.config,
      promptTemplate: wf.promptTemplate,
      runQuery,
      logger: this.log,
    });
    const initialProvider = wf.config.agent_provider;
    const initialControlPlaneKind = wf.config.control_plane.kind;
    const initialControlPlaneSignature = JSON.stringify(wf.config.control_plane);
    this.reloader.onReload((next) => {
      if (next.config.agent_provider !== initialProvider) {
        this.log.warn(
          { from: initialProvider, to: next.config.agent_provider },
          "workflow reload changed agent_provider; ignoring (restart dalang to switch providers)",
        );
        return;
      }
      if (next.config.control_plane.kind !== initialControlPlaneKind) {
        this.log.warn(
          { from: initialControlPlaneKind, to: next.config.control_plane.kind },
          "workflow reload changed control_plane kind; ignoring (restart dalang to switch control planes)",
        );
        return;
      }
      if (JSON.stringify(next.config.control_plane) !== initialControlPlaneSignature) {
        this.log.warn(
          { kind: initialControlPlaneKind },
          "workflow reload changed control_plane config; ignoring (restart dalang to switch control-plane settings)",
        );
        return;
      }
      try {
        validateForDispatch(next.config);
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, "workflow reload failed validation");
        return;
      }
      this.orch?.updateConfig(next.config, next.promptTemplate);
    });
    this.reloader.onError((err) => this.log.warn({ err: err.message }, "workflow reload error"));
    const port = this.opts.port ?? wf.config.server.port;
    this.server = startServer({
      state: this.orch.state,
      refresh: async () => {
        await this.orch?.tick();
      },
      port,
    });
    this.scheduleTick(0);
  }

  private scheduleTick(delayMs: number): void {
    if (this.stopped) return;
    this.tickTimer = setTimeout(async () => {
      this.tickTimer = null;
      try {
        await this.checkWorkflowReload();
        await this.orch?.tick();
      } catch (err) {
        this.log.error({ err: (err as Error).message }, "tick failed");
      }
      if (this.stopped) return;
      this.scheduleTick(this.orch?.state.poll_interval_ms ?? 30000);
    }, delayMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.server?.stop();
    await this.reloader.stop();
    await this.orch?.drainPendingForTest();
    await shutdownOpencodeServer().catch(() => {});
  }
}
