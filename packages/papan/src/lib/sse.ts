export interface BusEvent {
  name: string;
  data: unknown;
}

export type Subscriber = (event: BusEvent) => void;

export class EventBus {
  #subs = new Set<Subscriber>();

  get size(): number {
    return this.#subs.size;
  }

  subscribe(fn: Subscriber): () => void {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  }

  publish(name: string, data: unknown): void {
    const event: BusEvent = { name, data };
    for (const fn of [...this.#subs]) {
      try {
        fn(event);
      } catch {
        this.#subs.delete(fn);
      }
    }
  }
}
