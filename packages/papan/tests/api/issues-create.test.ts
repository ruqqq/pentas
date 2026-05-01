import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { startServer } from "../../src/api/server";
import { issuesCreateRoute } from "../../src/api/routes/issues-create";
import { createProject } from "../../src/db/repo/projects";
import { addStatus } from "../../src/db/repo/project-statuses";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("POST /api/v1/issues", () => {
  test("creates with defaults", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "new" }),
    });
    expect(res.status).toBe(201);
    const issue = (await res.json()) as { state: string; title: string; identifier: string };
    expect(issue.state).toBe("Todo");
    expect(issue.title).toBe("new");
    expect(issue.identifier).toBe("PENTAS-1");
    server.stop();
  });

  test("400 on missing title", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    server.stop();
  });

  test("400 on invalid state", async () => {
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", state: "Bogus" }),
    });
    expect(res.status).toBe(400);
    server.stop();
  });

  test("default state = first dispatchable for the resolved project", async () => {
    // Make 'Backlog' the first dispatchable in a custom project; 'Todo' shouldn't be the default.
    const alpha = createProject(db, { slug: "alpha", name: "Alpha" });
    addStatus(db, alpha.id, { name: "Backlog", kind: "dispatchable", position: 0 });
    db.query("UPDATE project_statuses SET position = position + 100 WHERE project_id = ?").run(
      alpha.id,
    );
    db.query(
      "UPDATE project_statuses SET position = 0 WHERE project_id = ? AND name = 'Backlog'",
    ).run(alpha.id);

    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", project_slug: "alpha" }),
    });
    expect(res.status).toBe(201);
    const issue = (await res.json()) as { state: string };
    expect(issue.state).toBe("Backlog");
    server.stop();
  });

  test("400 no_dispatchable_status when project has no dispatchable status and state is omitted", async () => {
    const alpha = createProject(db, { slug: "alpha", name: "Alpha" });
    // Strip every dispatchable status from the project — no issues use them yet so deletes are safe.
    db.query(
      "UPDATE project_statuses SET kind = 'waiting' WHERE project_id = ? AND kind = 'dispatchable'",
    ).run(alpha.id);
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", project_slug: "alpha" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_dispatchable_status");
    server.stop();
  });

  test("accepts custom state when configured for the project", async () => {
    const alpha = createProject(db, { slug: "alpha", name: "Alpha" });
    addStatus(db, alpha.id, { name: "Triage", kind: "dispatchable" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);
    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", state: "Triage", project_slug: "alpha" }),
    });
    expect(res.status).toBe(201);
    server.stop();
  });
});
