/** Bounded, versioned metadata cache. Never persists errors, nulls or empty results. */
interface Entry { time: number; value: unknown }
export class MetadataCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  constructor(private persist?: (text: string) => Promise<void>, private now = () => Date.now()) {}
  restore(text: string) {
    try {
      const data = JSON.parse(text) as { version?: unknown; entries?: unknown };
      if (data.version !== 1 || !Array.isArray(data.entries)) return;
      for (const pair of data.entries.slice(-200) as unknown[]) {
        if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
        const e = pair[1] as Partial<Entry> | null;
        if (e && typeof e.time === "number" && e.time <= this.now() && this.now() - e.time < 7 * 86400000 && e.value != null) this.entries.set(pair[0], { time: e.time, value: e.value });
      }
    } catch { /* Corrupt cache is disposable. */ }
  }
  async clear() {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
    this.writes = this.writes.then(async () => { if (this.persist) await this.persist(JSON.stringify({ version: 1, entries: [] })); }).catch(() => {});
    await this.writes;
  }
  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.time < 7 * 86400000) return JSON.parse(JSON.stringify(entry.value)) as T;
    let task = this.pending.get(key);
    if (task === undefined) {
      const generation = this.generation;
      task = (async () => {
        const value = await load();
        if (generation === this.generation && value != null && (!Array.isArray(value) || value.length > 0)) {
          this.entries.delete(key);
          this.entries.set(key, { time: this.now(), value: JSON.parse(JSON.stringify(value)) });
          while (this.entries.size > 200) {
            const oldest = [...this.entries.keys()][0];
            this.entries.delete(oldest);
          }
          if (this.persist) {
            const text = JSON.stringify({ version: 1, entries: [...this.entries] });
            this.writes = this.writes.then(() => this.persist(text)).catch(() => { /* Cache writes must not fail searches. */ });
            await this.writes;
          }
        }
        return value;
      })();
      this.pending.set(key, task);
      void task.finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); }).catch(() => {});
    }
    return JSON.parse(JSON.stringify(await task)) as T;
  }
}
