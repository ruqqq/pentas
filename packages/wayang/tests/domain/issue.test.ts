import { describe, expect, test } from "bun:test";
import {
  ACTIVE_STATES,
  ALL_STATES,
  TERMINAL_STATES,
  isActive,
  isTerminal,
  isValidState,
} from "../../src/domain/issue";

describe("issue state machine", () => {
  test("canonical sets are exhaustive", () => {
    expect(ALL_STATES).toEqual([
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
    expect(ACTIVE_STATES).toEqual([
      "Todo",
      "Plan",
      "Review Plan",
      "Ready for Dev",
      "In Dev",
      "Ready for Review",
    ]);
    expect(TERMINAL_STATES).toEqual(["Done", "Cancelled"]);
  });

  test("isActive / isTerminal classify correctly", () => {
    expect(isActive("Todo")).toBe(true);
    expect(isActive("Plan")).toBe(true);
    expect(isActive("In Dev")).toBe(true);
    expect(isActive("Ready for Human Review")).toBe(false);
    expect(isActive("Done")).toBe(false);
    expect(isTerminal("Done")).toBe(true);
    expect(isTerminal("Cancelled")).toBe(true);
    expect(isTerminal("Ready for Human Review")).toBe(false);
    expect(isTerminal("Todo")).toBe(false);
  });

  test("isValidState recognizes all canonical states", () => {
    for (const s of ALL_STATES) expect(isValidState(s)).toBe(true);
    expect(isValidState("garbage")).toBe(false);
  });
});

describe("Waiting PR Checks state", () => {
  test("is included in ALL_STATES between Ready for Review and Ready for Human Review", () => {
    const idx = (ALL_STATES as readonly string[]).indexOf("Waiting PR Checks");
    expect(idx).toBeGreaterThan(-1);
    expect(ALL_STATES[idx - 1]).toBe("Ready for Review");
    expect(ALL_STATES[idx + 1]).toBe("Ready for Human Review");
  });
  test("is not in ACTIVE_STATES (no agent dispatch)", () => {
    expect((ACTIVE_STATES as readonly string[]).includes("Waiting PR Checks")).toBe(false);
  });
  test("isValidState recognises it", () => {
    expect(isValidState("Waiting PR Checks")).toBe(true);
  });
  test("isActive returns false for it", () => {
    expect(isActive("Waiting PR Checks")).toBe(false);
  });
});
