/** Reference counts keyed by notification method, as required by EditorApi.(un)subscribe*Notifications. */
export class RefCounts {
  private readonly counts = new Map<string, number>();
  /** Returns true when the key went from 0 to 1. */
  inc(key: string): boolean {
    const n = this.counts.get(key) ?? 0;
    this.counts.set(key, n + 1);
    return n === 0;
  }
  /** Returns true when the key went from 1 to 0. Unbalanced calls are ignored (returns false). */
  dec(key: string): boolean {
    const n = this.counts.get(key);
    if (n === undefined) return false;
    if (n <= 1) {
      this.counts.delete(key);
      return true;
    }
    this.counts.set(key, n - 1);
    return false;
  }
  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }
  has(key: string): boolean {
    return this.counts.has(key);
  }
  keys(): string[] {
    return [...this.counts.keys()];
  }
  clear(): void {
    this.counts.clear();
  }
}
