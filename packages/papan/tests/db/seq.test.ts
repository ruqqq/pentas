import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { allocateIdentifier } from "../../src/db/seq";

describe("allocateIdentifier", () => {
  test("returns monotonically increasing PENTAS-N", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(allocateIdentifier(db)).toBe("PENTAS-1");
    expect(allocateIdentifier(db)).toBe("PENTAS-2");
    expect(allocateIdentifier(db)).toBe("PENTAS-3");
  });
});
