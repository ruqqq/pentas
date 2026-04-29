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
    expect(ALL_STATES).toEqual(["Todo", "In Progress", "In Review", "Done", "Cancelled"]);
    expect(ACTIVE_STATES).toEqual(["Todo", "In Progress"]);
    expect(TERMINAL_STATES).toEqual(["Done", "Cancelled"]);
  });

  test("isActive / isTerminal classify correctly", () => {
    expect(isActive("Todo")).toBe(true);
    expect(isActive("In Progress")).toBe(true);
    expect(isActive("Done")).toBe(false);
    expect(isTerminal("Done")).toBe(true);
    expect(isTerminal("Cancelled")).toBe(true);
    expect(isTerminal("Todo")).toBe(false);
  });

  test("isValidState recognizes all canonical states", () => {
    for (const s of ALL_STATES) expect(isValidState(s)).toBe(true);
    expect(isValidState("garbage")).toBe(false);
  });
});
