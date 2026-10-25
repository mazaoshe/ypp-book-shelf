import { App, Plugin, TFile } from "obsidian";

/** 每天 -> 当天编辑过的书籍笔记路径集合（同一本书一天只记一次） */
export interface ActivityStore {
  /** "YYYY-MM-DD" -> { "Sources/Books/x/x.md": 1 } */
  days: Record<string, Record<string, number>>;
  /** 首次开始记录的时间戳 */
  since: number;
}

export function emptyActivity(): ActivityStore {
  return { days: {}, since: Date.now() };
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 监听书籍笔记的修改，按天累计。
 *
 * 规则：
 * - 同一本书同一天只计一次（用户关心的是“今天动过几本书”）
 * - 2 秒内 5 个以上文件同时变更，判定为插件批量同步，不计入
 */
export class ActivityTracker {
  private pending = new Map<string, number>();
  private flushTimer: number | null = null;
  private disposed = false;

  constructor(
    private app: App,
    private plugin: Plugin,
    private store: ActivityStore,
    private shouldTrack: (path: string) => boolean,
    private skipBatchSync: boolean,
    private onFlush: () => void | Promise<void>
  ) {}

  start() {
    const ref = this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) return;
      if (file.extension !== "md") return;
      if (!this.shouldTrack(file.path)) return;
      this.pending.set(file.path, Date.now());
      if (this.flushTimer === null) {
        this.flushTimer = window.setTimeout(() => {
          void this.flush();
        }, 2500);
      }
    });
    this.plugin.registerEvent(ref);
    this.plugin.register(() => this.dispose());
  }

  private async flush() {
    this.flushTimer = null;
    if (this.disposed) return;
    const batch = this.pending;
    this.pending = new Map();
    if (batch.size === 0) return;

    // 批量同步写入：一次改很多文件，不算“读过”
    if (this.skipBatchSync && batch.size >= 5) {
      const times = [...batch.values()].sort();
      const span = times[times.length - 1] - times[0];
      if (span <= 2000) return;
    }

    const day = dayKey(new Date());
    const bucket = (this.store.days[day] ??= {});
    let changed = false;
    for (const path of batch.keys()) {
      if (!bucket[path]) {
        bucket[path] = 1;
        changed = true;
      }
    }
    if (changed) await this.onFlush();
  }

  dispose() {
    this.disposed = true;
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
      void this.flush();
    }
  }
}

/** 某天内编辑过的书 */
export function booksOn(store: ActivityStore, day: string): string[] {
  return Object.keys(store.days[day] ?? {});
}

/** 区间内每天的阅读书籍数 */
export function dailyCounts(
  store: ActivityStore,
  from: Date,
  to: Date
): Map<string, number> {
  const out = new Map<string, number>();
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end) {
    const k = dayKey(cursor);
    out.set(k, booksOn(store, k).length);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** 最长连续天数 */
export function longestStreak(days: Set<string>): number {
  let best = 0;
  for (const d of days) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 1);
    if (days.has(dayKey(prev))) continue; // 不是连续段的起点
    let len = 0;
    const cur = new Date(d);
    while (days.has(dayKey(cur))) {
      len++;
      cur.setDate(cur.getDate() + 1);
    }
    if (len > best) best = len;
  }
  return best;
}

/** 当前连续天数（到今天或昨天为止） */
export function currentStreak(days: Set<string>): number {
  let len = 0;
  const cur = new Date();
  if (!days.has(dayKey(cur))) cur.setDate(cur.getDate() - 1);
  while (days.has(dayKey(cur))) {
    len++;
    cur.setDate(cur.getDate() - 1);
  }
  return len;
}
