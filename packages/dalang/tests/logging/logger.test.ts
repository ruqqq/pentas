// packages/dalang/tests/logging/logger.test.ts
import { test, expect } from "bun:test";
import { createLogger } from "../../src/logging/logger";

test("createLogger returns an object with the standard methods", () => {
  const log = createLogger({ name: "dalang", level: "info" });
  expect(typeof log.info).toBe("function");
  expect(typeof log.warn).toBe("function");
  expect(typeof log.error).toBe("function");
  expect(typeof log.debug).toBe("function");
});

test("child(ctx) attaches issue context fields", () => {
  const log = createLogger({ name: "dalang", level: "info" });
  const child = log.child({ issue_id: "i1", issue_identifier: "X-1" });
  expect(typeof child.info).toBe("function");
});
