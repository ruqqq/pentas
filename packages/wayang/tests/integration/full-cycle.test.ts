import { describe, expect, test } from "bun:test";
import { runWayang } from "../../src/main";
import { unlinkSync, existsSync } from "node:fs";

const RUN = process.env["RUN_INTEGRATION"] === "1";

describe.skipIf(!RUN)("full HTTP cycle", () => {
  test("create → list → patch state → comment → SSE event", async () => {
    const dbPath = "/tmp/wayang-it.db";
    if (existsSync(dbPath)) unlinkSync(dbPath);
    const { server, db } = runWayang({ port: 0, dbPath });
    try {
      const created = await fetch(`${server.url}api/v1/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "integration", state: "Todo" }),
      });
      const issue = (await created.json()) as { id: string };

      const list = await fetch(`${server.url}api/v1/issues?state=Todo`);
      const listBody = (await list.json()) as { issues: { id: string }[] };
      expect(listBody.issues.map((i) => i.id)).toContain(issue.id);

      const patch = await fetch(`${server.url}api/v1/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "In Progress", actor: "agent" }),
      });
      expect(patch.status).toBe(200);

      const comment = await fetch(`${server.url}api/v1/issues/${issue.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "progress", author: "agent" }),
      });
      expect(comment.status).toBe(201);

      // SSE: connect AFTER mutations to verify subsequent event.
      const sse = await fetch(`${server.url}api/v1/events`);
      const reader = sse.body!.getReader();
      const decoder = new TextDecoder();

      void fetch(`${server.url}api/v1/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "Done", actor: "user" }),
      });

      let buf = "";
      const deadline = Date.now() + 3000;
      while (!buf.includes("event: state.changed") && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
      }
      expect(buf).toContain("event: state.changed");
      await reader.cancel();
      db.close();
    } finally {
      server.stop();
    }
  }, 10000);
});
