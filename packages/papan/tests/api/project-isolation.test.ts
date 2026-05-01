import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { startServer } from "../../src/api/server";
import { createProject } from "../../src/db/repo/projects";
import { createIssue, getIssueById } from "../../src/db/repo/issues";
import { issuesByIdsRoute } from "../../src/api/routes/issues-by-ids";
import { issuesCreateRoute } from "../../src/api/routes/issues-create";
import { issuesDeleteRoute } from "../../src/api/routes/issues-delete";
import { issuesDetailRoute } from "../../src/api/routes/issues-detail";
import { issuesListRoute } from "../../src/api/routes/issues-list";
import { commentsCreateRoute, commentsListRoute } from "../../src/api/routes/comments";
import { historyListRoute } from "../../src/api/routes/history";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("project-scoped issue API", () => {
  test("list, detail, by-ids, comments, history, and delete are isolated by project", async () => {
    const alpha = createProject(db, { slug: "alpha", name: "Alpha" });
    const beta = createProject(db, { slug: "beta", name: "Beta" });
    const alphaIssue = createIssue(db, {
      project_id: alpha.id,
      title: "alpha issue",
      state: "Todo",
    });
    const betaIssue = createIssue(db, { project_id: beta.id, title: "beta issue", state: "Todo" });

    const server = startServer({ db, apiToken: undefined, port: 0 }, [
      issuesListRoute(),
      issuesByIdsRoute(),
      issuesCreateRoute(),
      commentsCreateRoute(),
      commentsListRoute(),
      historyListRoute(),
      issuesDeleteRoute(),
      issuesDetailRoute(),
    ]);

    const alphaList = await fetch(`${server.url}api/v1/issues?project=alpha&state=Todo`);
    const alphaListBody = (await alphaList.json()) as { issues: { id: string }[] };
    expect(alphaListBody.issues.map((i) => i.id)).toEqual([alphaIssue.id]);

    const byIds = await fetch(
      `${server.url}api/v1/issues/by-ids?project=alpha&id=${alphaIssue.id}&id=${betaIssue.id}`,
    );
    const byIdsBody = (await byIds.json()) as { issues: { id: string }[] };
    expect(byIdsBody.issues.map((i) => i.id)).toEqual([alphaIssue.id]);

    const wrongDetail = await fetch(`${server.url}api/v1/issues/${betaIssue.id}?project=alpha`);
    expect(wrongDetail.status).toBe(404);

    const wrongComments = await fetch(
      `${server.url}api/v1/issues/${betaIssue.id}/comments?project=alpha`,
    );
    expect(wrongComments.status).toBe(404);

    const wrongHistory = await fetch(
      `${server.url}api/v1/issues/${betaIssue.id}/history?project=alpha`,
    );
    expect(wrongHistory.status).toBe(404);

    const wrongDelete = await fetch(`${server.url}api/v1/issues/${betaIssue.id}?project=alpha`, {
      method: "DELETE",
    });
    expect(wrongDelete.status).toBe(404);
    expect(getIssueById(db, betaIssue.id, beta.id)).not.toBeNull();

    const deleteAlpha = await fetch(`${server.url}api/v1/issues/${alphaIssue.id}?project=alpha`, {
      method: "DELETE",
    });
    expect(deleteAlpha.status).toBe(204);
    expect(getIssueById(db, alphaIssue.id, alpha.id)).toBeNull();
    server.stop();
  });

  test("rejects cross-project blockers", async () => {
    const alpha = createProject(db, { slug: "alpha", name: "Alpha" });
    const beta = createProject(db, { slug: "beta", name: "Beta" });
    const betaIssue = createIssue(db, { project_id: beta.id, title: "beta issue", state: "Todo" });
    const server = startServer({ db, apiToken: undefined, port: 0 }, [issuesCreateRoute()]);

    const res = await fetch(`${server.url}api/v1/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_slug: "alpha",
        title: "alpha blocked",
        blocker_ids: [betaIssue.id],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("project_scope_mismatch");
    expect(alpha.slug).toBe("alpha");
    server.stop();
  });
});
