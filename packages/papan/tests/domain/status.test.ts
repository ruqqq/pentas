import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STATUSES,
  STATUS_KINDS,
  isDispatchable,
  isStatusKind,
  isTerminal,
  isWaiting,
} from "../../src/domain/status";

describe("project status defaults", () => {
  test("kinds are exhaustive", () => {
    expect(STATUS_KINDS).toEqual(["dispatchable", "waiting", "terminal"]);
  });

  test("isStatusKind validates", () => {
    expect(isStatusKind("dispatchable")).toBe(true);
    expect(isStatusKind("waiting")).toBe(true);
    expect(isStatusKind("terminal")).toBe(true);
    expect(isStatusKind("garbage")).toBe(false);
  });

  test("DEFAULT_STATUSES preserves the legacy 10-state ordering", () => {
    expect(DEFAULT_STATUSES.map((s) => s.name)).toEqual([
      "Todo",
      "Plan",
      "Review Plan",
      "Ready for Dev",
      "In Dev",
      "Ready for Review",
      "Waiting PR Checks",
      "Ready for Human Review",
      "Done",
      "Cancelled",
    ]);
    DEFAULT_STATUSES.forEach((s, i) => expect(s.position).toBe(i));
  });

  test("DEFAULT_STATUSES classifies kinds correctly", () => {
    const byName = new Map(DEFAULT_STATUSES.map((s) => [s.name, s.kind]));
    expect(byName.get("Todo")).toBe("dispatchable");
    expect(byName.get("In Dev")).toBe("dispatchable");
    expect(byName.get("Ready for Review")).toBe("dispatchable");
    expect(byName.get("Waiting PR Checks")).toBe("waiting");
    expect(byName.get("Ready for Human Review")).toBe("waiting");
    expect(byName.get("Done")).toBe("terminal");
    expect(byName.get("Cancelled")).toBe("terminal");
  });

  test("kind helpers", () => {
    const d = { name: "x", position: 0, kind: "dispatchable" } as const;
    const w = { name: "y", position: 1, kind: "waiting" } as const;
    const t = { name: "z", position: 2, kind: "terminal" } as const;
    expect(isDispatchable(d)).toBe(true);
    expect(isWaiting(w)).toBe(true);
    expect(isTerminal(t)).toBe(true);
    expect(isDispatchable(w)).toBe(false);
    expect(isTerminal(d)).toBe(false);
  });
});
