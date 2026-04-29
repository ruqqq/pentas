// packages/dalang/src/config/reload.ts
import chokidar, { type FSWatcher } from "chokidar";
import { stat } from "node:fs/promises";
import { loadWorkflow, type LoadedWorkflow, WorkflowError } from "./workflow-loader";

export type ReloadListener = (next: LoadedWorkflow) => void;
export type ReloadErrorListener = (err: WorkflowError) => void;

export class WorkflowReloader {
  private workflow: LoadedWorkflow | null = null;
  private watcher: FSWatcher | null = null;
  private listeners: ReloadListener[] = [];
  private errorListeners: ReloadErrorListener[] = [];
  private reloadChain: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  current(): LoadedWorkflow {
    if (!this.workflow) throw new Error("WorkflowReloader.start() not called");
    return this.workflow;
  }

  onReload(fn: ReloadListener): void { this.listeners.push(fn); }
  onError(fn: ReloadErrorListener): void { this.errorListeners.push(fn); }

  async start(): Promise<void> {
    this.workflow = await loadWorkflow(this.path);
    this.watcher = chokidar.watch(this.path, { ignoreInitial: true });
    this.watcher.on("change", () => { void this.tryReload(); });
  }

  async checkMtimeReload(): Promise<void> {
    const st = await stat(this.path).catch(() => null);
    if (!st) return;
    if (this.workflow && st.mtimeMs > this.workflow.mtimeMs) {
      await this.tryReload();
    }
  }

  private tryReload(): Promise<void> {
    const next = this.reloadChain.then(() => this.runReload());
    this.reloadChain = next.catch(() => {});
    return next;
  }

  private async runReload(): Promise<void> {
    try {
      const next = await loadWorkflow(this.path);
      this.workflow = next;
      for (const fn of this.listeners) fn(next);
    } catch (err) {
      const we = err instanceof WorkflowError ? err : new WorkflowError("workflow_validation_error", (err as Error).message);
      for (const fn of this.errorListeners) fn(we);
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
