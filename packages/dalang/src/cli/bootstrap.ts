// packages/dalang/src/cli/bootstrap.ts
import { resolve } from "node:path";
import { WorkflowReloader } from "../config/reload";
import { validateForDispatch, probeClaudeAuth, probeCodexAuth, probeOpencodeAuth, ValidationError } from "../config/validate";
import { resolveTrackerApiKey, Orchestrator } from "../orchestrator/orchestrator";
import { RestTrackerAdapter } from "../tracker/rest-adapter";
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
  /** If set, overrides workflow's tracker.endpoint (e.g. for in-process wayang). */
  trackerEndpoint?: string;
  /** If set, overrides workflow's tracker.api_key. */
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

  serverPort(): number { return this.server?.port ?? 0; }

  async start(): Promise<void> {
    await this.reloader.start();
    const wf = this.reloader.current();
    validateForDispatch(wf.config);
    if (!this.opts.skipAuthProbe) {
      if (wf.config.agent_provider === "codex") {
        const err = await probeCodexAuth(wf.config.codex!.executable_path);
        if (err) throw new ValidationError("codex_auth_inactive", err);
      } else if (wf.config.agent_provider === "opencode") {
        const err = await probeOpencodeAuth(wf.config.opencode!.executable_path, wf.config.opencode!.model);
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
    const tracker = new RestTrackerAdapter({
      endpoint: this.opts.trackerEndpoint ?? wf.config.tracker.endpoint,
      apiKey: this.opts.trackerApiKey !== undefined
        ? resolveTrackerApiKey(this.opts.trackerApiKey)
        : resolveTrackerApiKey(wf.config.tracker.api_key ?? null),
    });
    const runQuery = this.opts.runQueryFactory
      ? this.opts.runQueryFactory()
      : wf.config.agent_provider === "codex"
        ? codexRunQuery
        : wf.config.agent_provider === "opencode"
          ? opencodeRunQuery
          : sdkRunQuery;
    this.orch = new Orchestrator({
      tracker, config: wf.config, promptTemplate: wf.promptTemplate,
      runQuery, logger: this.log,
    });
    const initialProvider = wf.config.agent_provider;
    this.reloader.onReload((next) => {
      if (next.config.agent_provider !== initialProvider) {
        this.log.warn(
          { from: initialProvider, to: next.config.agent_provider },
          "workflow reload changed agent_provider; ignoring (restart dalang to switch providers)",
        );
        return;
      }
      try { validateForDispatch(next.config); }
      catch (err) {
        this.log.warn({ err: (err as Error).message }, "workflow reload failed validation");
        return;
      }
      this.orch?.updateConfig(next.config, next.promptTemplate);
    });
    this.reloader.onError((err) => this.log.warn({ err: err.message }, "workflow reload error"));
    const port = this.opts.port ?? wf.config.server.port;
    this.server = startServer({
      state: this.orch.state,
      refresh: async () => { await this.orch?.tick(); },
      port,
    });
    this.scheduleTick(0);
  }

  private scheduleTick(delayMs: number): void {
    if (this.stopped) return;
    this.tickTimer = setTimeout(async () => {
      this.tickTimer = null;
      try {
        await this.reloader.checkMtimeReload();
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
