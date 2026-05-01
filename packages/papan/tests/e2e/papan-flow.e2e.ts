import { expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let baseURL: string;
let cleanup: () => void = () => {};
const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "papan-e2e-"));
  const dbPath = join(dir, "papan.db");
  const app = spawn("bun", ["run", "src/index.ts", "--port", "0", "--db", dbPath], {
    cwd: packageRoot,
    env: { ...process.env },
  });
  baseURL = await waitForPapan(app);
  cleanup = () => {
    app.kill();
    rmSync(dir, { recursive: true, force: true });
  };
});

test.afterAll(() => cleanup());

test("covers create, list, detail, state, comments, history, and board update", async ({
  page,
}) => {
  const title = `Papan browser QA ${Date.now()}`;
  const comment = "QA comment rendered from Playwright";

  await page.goto(`${baseURL}/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Created by the Papan QA browser flow.");
  await page.getByLabel("Labels").fill("qa,e2e");
  await page.getByRole("button", { name: "Create issue" }).click();

  await expect(page.getByRole("heading", { name: /PENTAS-\d+ / })).toContainText(title);
  await expect(page.locator(".label").filter({ hasText: /^qa$/ })).toBeVisible();
  await expect(page.locator(".label").filter({ hasText: /^e2e$/ })).toBeVisible();

  await page.goto(`${baseURL}/`);
  await expect(page.locator(".card", { hasText: title })).toBeVisible();

  await page
    .locator(".card", { hasText: title })
    .getByRole("link", { name: /PENTAS-\d+/ })
    .click();
  await page.locator("article select").selectOption("In QA");
  await expect(page.locator(".state-badge", { hasText: "In QA" })).toBeVisible();

  await page.getByPlaceholder("Add a comment").fill(comment);
  await page.getByRole("button", { name: "Add comment" }).click();

  await page.reload();
  await expect(page.locator("#comments-list")).toContainText(comment);
  await expect(page.locator("#history")).toContainText("state Todo");
  await expect(page.locator("#history")).toContainText("In QA");
  await expect(page.locator("#history")).toContainText("comment added");

  await page.goto(`${baseURL}/`);
  const inQaColumn = page.locator('.kcol[data-state="In QA"]');
  await expect(inQaColumn.locator(".card", { hasText: title })).toBeVisible();
});

function waitForPapan(app: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Papan to start. stderr: ${stderr}`));
    }, 10_000);

    app.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/papan listening on (https?:\/\/\S+)/);
      if (!match?.[1]) return;
      clearTimeout(timer);
      resolve(match[1].replace(/\/$/, ""));
    });
    app.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    app.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Papan exited before startup with code ${code}. stderr: ${stderr}`));
    });
    app.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
