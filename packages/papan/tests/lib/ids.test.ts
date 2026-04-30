import { describe, expect, test } from "bun:test";
import { ulid, formatIdentifier } from "../../src/lib/ids";

describe("ulid", () => {
  test("produces 26-char Crockford base32 string", () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("two IDs in sequence are unique and lexicographically ordered", () => {
    const a = ulid();
    const b = ulid();
    expect(a).not.toEqual(b);
    expect(a < b).toBe(true);
  });
});

describe("formatIdentifier", () => {
  test("formats as PENTAS-N", () => {
    expect(formatIdentifier(1)).toBe("PENTAS-1");
    expect(formatIdentifier(42)).toBe("PENTAS-42");
  });
});
