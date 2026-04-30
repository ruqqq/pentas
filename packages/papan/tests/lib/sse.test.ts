import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/lib/sse";

describe("EventBus", () => {
  test("publishes to all subscribers", () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.publish("test", { v: 1 });
    expect(a).toEqual([{ name: "test", data: { v: 1 } }]);
    expect(b).toEqual([{ name: "test", data: { v: 1 } }]);
  });

  test("unsubscribe stops delivery", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    off();
    bus.publish("test", {});
    expect(seen).toEqual([]);
  });

  test("throwing subscriber is dropped, others still receive", () => {
    const bus = new EventBus();
    bus.subscribe(() => {
      throw new Error("boom");
    });
    const seen: unknown[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.publish("test", {});
    expect(seen.length).toBe(1);
    expect(bus.size).toBe(1);
  });
});
