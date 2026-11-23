/**
 * Fixed-capacity ring buffer for zero-allocation real-time oscilloscope plots.
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }

  at(index: number): T {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return this.buffer[(start + index) % this.capacity] as T;
  }

  toArray(): T[] {
    const out = new Array<T>(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = this.at(i);
    }
    return out;
  }
}
