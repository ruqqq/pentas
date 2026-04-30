import { expect, test } from "bun:test";
import {
  deriveBranchName,
  githubItemMatchesOwnership,
  githubProjectItemToWorkItem,
} from "../../../src/control-plane/github/normalize";

const item = {
  id: "PVTI_1",
  updatedAt: "2026-04-30T02:00:00Z",
  fieldValues: {
    nodes: [
      { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "In Dev", field: { name: "Status" } },
      { __typename: "ProjectV2ItemFieldTextValue", text: "feature/custom-branch", field: { name: "Branch" } },
      { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Dalang", field: { name: "Agent" } },
    ],
  },
  content: {
    __typename: "Issue",
    id: "ISSUE_1",
    number: 12,
    title: "Fix Checkout!",
    body: "Body",
    url: "https://github.com/acme/app/issues/12",
    createdAt: "2026-04-30T01:00:00Z",
    updatedAt: "2026-04-30T01:30:00Z",
    labels: { nodes: [{ name: "Dalang" }, { name: "Bug" }] },
    assignees: { nodes: [{ login: "dalang-bot" }] },
  },
};

test("githubProjectItemToWorkItem maps issue project item", () => {
  const got = githubProjectItemToWorkItem(item, {
    repository: "acme/app",
    statusField: "Status",
    branchField: "Branch",
  });

  expect(got).toMatchObject({
    id: "PVTI_1",
    identifier: "acme/app#12",
    title: "Fix Checkout!",
    description: "Body",
    state: "In Dev",
    branch_name: "feature/custom-branch",
    url: "https://github.com/acme/app/issues/12",
    external_ref: "acme/app#12",
    labels: ["dalang", "bug"],
  });
});

test("githubProjectItemToWorkItem ignores draft issues and pull requests", () => {
  expect(githubProjectItemToWorkItem({ ...item, content: { __typename: "DraftIssue" } }, {
    repository: "acme/app",
    statusField: "Status",
    branchField: null,
  })).toBeNull();
  expect(githubProjectItemToWorkItem({ ...item, content: { __typename: "PullRequest" } }, {
    repository: "acme/app",
    statusField: "Status",
    branchField: null,
  })).toBeNull();
});

test("githubProjectItemToWorkItem skips items with truncated field values", () => {
  expect(githubProjectItemToWorkItem({
    ...item,
    fieldValues: {
      ...item.fieldValues,
      pageInfo: { hasNextPage: true, endCursor: "next" },
    },
  }, {
    repository: "acme/app",
    statusField: "Status",
    branchField: "Branch",
  })).toBeNull();
});

test("ownership supports label assignee and project field", () => {
  expect(githubItemMatchesOwnership(item, { mode: "label", value: "dalang" })).toBe(true);
  expect(githubItemMatchesOwnership(item, { mode: "assignee", value: "dalang-bot" })).toBe(true);
  expect(githubItemMatchesOwnership(item, { mode: "project_field", field: "Agent", value: "Dalang" })).toBe(true);
  expect(githubItemMatchesOwnership(item, { mode: "label", value: "other" })).toBe(false);
});

test("deriveBranchName is deterministic", () => {
  expect(deriveBranchName(12, "Fix Checkout!")).toBe("dalang/12-fix-checkout");
  expect(deriveBranchName(12, "Fix Checkout!", "juara/", "acme/app")).toBe("juara/acme-app-12");
});
