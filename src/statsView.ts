import { ItemView, WorkspaceLeaf } from "obsidian";
import type BookShelfPlugin from "./main";
import {
  ActivityStore,
  booksOn,
  currentStreak,
  dailyCounts,
  dayKey,
  longestStreak,
} from "./activity";

export const VIEW_TYPE_BOOK_STATS = "ypp-book-shelf-stats";

type Range = "week" | "month" | "year" | "all";
type ChartMode = "heatmap" | "bar";

const WEEK_LABEL = ["一", "二", "三", "四", "五", "六", "日"];

export class BookStatsView extends ItemView {
  private range: Range = "year";
  private chartMode: ChartMode = "heatmap";
  private year = new Date().getFullYear();

  constructor(leaf: WorkspaceLeaf, private plugin: BookShelfPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_BOOK_STATS;
  }
  getDisplayText() {
    return "阅读统计";
  }
  getIcon() {
    return "bar-chart-3";
  }

  get store(): ActivityStore {
    return this.plugin.settings.activity;
  }

  async onOpen() {
    this.render();
  }

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("bs-stats");

    this.renderHeader(el);
    const body = el.createDiv({ cls: "bs-stats-body" });
    this.renderCards(body);

    const charts = body.createDiv({ cls: "bs-stats-charts" });
    if (this.range === "week" || this.range === "month") {
      if (this.range === "week") this.renderWeekStrip(charts);
      else this.renderMonthGrid(charts);
      this.renderMonthBars(charts);
    } else if (this.range === "year") {
      if (this.chartMode === "heatmap") this.renderHeatmap(charts);
      else this.renderMonthBars(charts);
    } else {
      this.renderYearBars(charts);
    }

    if (this.plugin.trackingBooks) this.renderPreferences(body);
  }

  private renderHeader(el: HTMLElement) {
    const bar = el.createDiv({ cls: "bs-stats-bar" });

    const tabs = bar.createDiv({ cls: "bs-seg" });
    for (const [value, label] of [
      ["week", "周"],
      ["month", "月"],
      ["year", "年"],
      ["all", "全部"],
    ] as [Range, string][]) {
      const b = tabs.createEl("button", { text: label });
      if (this.range === value) b.addClass("is-active");
      b.onclick = () => {
        this.range = value;
        this.render();
      };
    }

    if (this.range === "year" || this.range === "month") {
      const nav = bar.createDiv({ cls: "bs-year-nav" });
      const prev = nav.createEl("button", { text: "‹" });
      prev.onclick = () => {
        this.year -= 1;
        this.render();
      };
      nav.createSpan({ text: `${this.year}年`, cls: "bs-year-label" });
      const next = nav.createEl("button", { text: "›" });
      next.onclick = () => {
        this.year += 1;
        this.render();
      };
    }

    const right = bar.createDiv({ cls: "bs-stats-right" });
    if (this.range === "year") {
      const toggle = right.createDiv({ cls: "bs-seg" });
      for (const [value, label] of [
        ["heatmap", "▦"],
        ["bar", "▤"],
      ] as [ChartMode, string][]) {
        const b = toggle.createEl("button", { text: label });
        if (this.chartMode === value) b.addClass("is-active");
        b.onclick = () => {
          this.chartMode = value;
          this.render();
        };
      }
    }
  }

  // ---------- 数字卡 ----------

  private renderCards(body: HTMLElement) {
    const s = this.store;
    const days = new Set(Object.keys(s.days).filter((d) => this.dayHasBooks(d)));
    let label = "今年";
    let filtered = [...days].filter((d) => d.startsWith(String(this.year)));

    if (this.range === "week") {
      label = "本周";
      const start = this.weekStart(new Date());
      filtered = [...days].filter((d) => new Date(d) >= start);
    } else if (this.range === "month") {
      label = "本月";
      const ym = `${new Date().getFullYear()}-${String(
        new Date().getMonth() + 1
      ).padStart(2, "0")}`;
      filtered = [...days].filter((d) => d.startsWith(ym));
    } else if (this.range === "all") {
      label = "累计";
      filtered = [...days];
    }

    const touched = new Set<string>();
    for (const d of filtered) for (const p of this.pathsOn(d)) touched.add(p);

    const books = this.plugin.collectBooks();
    let finished = 0;
    let reading = 0;
    for (const b of books) {
      if (b.status === "读完") finished++;
      else if (b.status === "在读") reading++;
    }

    const booksMode = this.plugin.trackingBooks;
    const unit = booksMode ? "书" : "笔记";
    const cards = body.createDiv({ cls: "bs-cardrow" });
    const items: [string, string, string, string][] = [
      ["📅", String(filtered.length), `${label}${booksMode ? "阅读" : "动手"}天数`, "有编辑记录的天数"],
      ["🔥", String(currentStreak(days)), "当前连续", "连续有动作的天数"],
      ["📚", String(touched.size), `${label}动过的${unit}`, "编辑过的笔记"],
      ["🏆", String(longestStreak(days)), "最长连续", "历史最长连续天数"],
    ];
    if (booksMode) {
      items.push(
        ["✅", String(finished) + " / " + String(books.length), "读完 / 藏书", "按阅读状态字段判断"],
        ["📖", String(reading), "在读", "按阅读状态字段判断"]
      );
    }
    for (const [icon, value, name, desc] of items) {
      const card = cards.createDiv({ cls: "bs-statcard" });
      card.title = desc;
      const head = card.createDiv({ cls: "bs-statcard-head" });
      head.createSpan({ cls: "bs-statcard-icon", text: icon });
      head.createSpan({ text: value, cls: "bs-statcard-value" });
      card.createDiv({ cls: "bs-statcard-name", text: name });
    }

    // 还没攒到数据时给个明确说明
    if (days.size === 0) {
      body.createDiv({
        cls: "bs-hint",
        text: `记录从今天开始累计：编辑 \`${this.plugin.trackFolder}/\` 下的任意笔记后，这里就会出现格子。文件修改时间被同步任务覆盖过，历史无法回溯。`,
      });
    }
  }

  /** 只算当前统计目录里的笔记（切换目录后旧记录不混进来） */
  private pathsOn(day: string): string[] {
    const folder = this.plugin.trackFolder;
    return booksOn(this.store, day).filter(
      (p) => !folder || p.startsWith(folder + "/")
    );
  }

  private dayHasBooks(day: string) {
    return this.pathsOn(day).length > 0;
  }

  private weekStart(d: Date): Date {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const wd = (out.getDay() + 6) % 7; // 周一为一周开始
    out.setDate(out.getDate() - wd);
    return out;
  }

  // ---------- 图表 ----------

  private renderHeatmap(host: HTMLElement) {
    const wrap = host.createDiv({ cls: "bs-chart" });
    wrap.createDiv({ cls: "bs-chart-title", text: "每日阅读（编辑过的书）" });

    const year = this.year;
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    const counts = dailyCounts(this.store, start, end);
    const max = Math.max(1, ...counts.values());

    const cell = 11;
    const gap = 3;
    const left = 26;
    const top = 18;
    const startPad = (start.getDay() + 6) % 7;
    const totalDays = Math.round(
      (end.getTime() - start.getTime()) / 86400000
    ) + 1;
    const weeks = Math.ceil((startPad + totalDays) / 7);
    const width = left + weeks * (cell + gap);
    const height = top + 7 * (cell + gap) + 26;

    const svg = svgEl(wrap, width, height);

    // 月份标签
    for (let m = 0; m < 12; m++) {
      const first = new Date(year, m, 1);
      const offset = Math.round(
        (first.getTime() - start.getTime()) / 86400000
      );
      const week = Math.floor((startPad + offset) / 7);
      if (week >= weeks) continue;
      text(svg, left + week * (cell + gap), 11, `${m + 1}月`, {
        fill: "var(--text-faint)",
        "font-size": "9",
      });
    }
    // 星期标签
    for (const [i, label] of [
      [0, "一"],
      [2, "三"],
      [4, "五"],
    ] as [number, string][]) {
      text(svg, 4, top + i * (cell + gap) + cell - 2, label, {
        fill: "var(--text-faint)",
        "font-size": "9",
      });
    }

    let totalDaysRead = 0;
    let totalBooks = new Set<string>();
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(year, 0, 1 + i);
      const key = dayKey(d);
      const n = counts.get(key) ?? 0;
      const idx = startPad + i;
      const week = Math.floor(idx / 7);
      const row = idx % 7;
      const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
      const rect = svgEl(svg, 0, 0, "rect") as SVGRectElement;
      rect.setAttribute("x", String(left + week * (cell + gap)));
      rect.setAttribute("y", String(top + row * (cell + gap)));
      rect.setAttribute("width", String(cell));
      rect.setAttribute("height", String(cell));
      rect.setAttribute("rx", "2");
      rect.setAttribute("class", `bs-heat l${level}`);
      if (n > 0) {
        totalDaysRead++;
        for (const p of this.pathsOn(key)) totalBooks.add(p);
        (rect as any).title = `${key} · ${n} 本\n${this.pathsOn(key)
          .map((p) => p.split("/").pop()?.replace(/\.md$/, ""))
          .join("\n")}`;
        const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
        t.textContent = (rect as any).title;
        rect.appendChild(t);
      }
    }

    // 图例
    const legendY = top + 7 * (cell + gap) + 10;
    text(svg, left, legendY + 9, "少", {
      fill: "var(--text-faint)",
      "font-size": "10",
    });
    for (let l = 0; l <= 4; l++) {
      const r = svgEl(svg, 0, 0, "rect") as SVGRectElement;
      r.setAttribute("x", String(left + 18 + l * (cell + 2)));
      r.setAttribute("y", String(legendY));
      r.setAttribute("width", String(cell));
      r.setAttribute("height", String(cell));
      r.setAttribute("rx", "2");
      r.setAttribute("class", `bs-heat l${l}`);
    }
    text(svg, left + 18 + 5 * (cell + 2) + 6, legendY + 9, "多", {
      fill: "var(--text-faint)",
      "font-size": "10",
    });

    wrap.createDiv({
      cls: "bs-chart-foot",
      text: `${year} 年共阅读 ${totalDaysRead} 天，涉及 ${totalBooks.size} 本书`,
    });
  }

  private renderMonthGrid(host: HTMLElement) {
    const wrap = host.createDiv({ cls: "bs-chart" });
    const start = new Date(this.year, 0, 1);
    const month = this.range === "month" ? new Date().getMonth() : 0;
    const first = new Date(this.year, month, 1);
    const daysInMonth = new Date(this.year, month + 1, 0).getDate();
    wrap.createDiv({
      cls: "bs-chart-title",
      text: `${this.year} 年 ${month + 1} 月每日阅读`,
    });
    const counts = dailyCounts(
      this.store,
      first,
      new Date(this.year, month, daysInMonth)
    );
    const max = Math.max(1, ...counts.values());
    const pad = (first.getDay() + 6) % 7;
    const cell = 28;
    const gap = 6;
    const width = 7 * (cell + gap);
    const height = Math.ceil((pad + daysInMonth) / 7) * (cell + gap) + 16;
    const svg = svgEl(wrap, width, height);

    for (let i = 0; i < daysInMonth; i++) {
      const key = dayKey(new Date(this.year, month, i + 1));
      const n = counts.get(key) ?? 0;
      const idx = pad + i;
      const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
      const g = svgEl(svg, 0, 0, "g") as SVGGElement;
      const r = svgEl(g, 0, 0, "rect") as SVGRectElement;
      const x = (idx % 7) * (cell + gap);
      const y = Math.floor(idx / 7) * (cell + gap);
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", String(cell));
      r.setAttribute("height", String(cell));
      r.setAttribute("rx", "4");
      r.setAttribute("class", `bs-heat l${level}`);
      text(g, x + 6, y + 18, String(i + 1), {
        fill: level >= 3 ? "#fff" : "var(--text-muted)",
        "font-size": "11",
      });
      if (n > 0) {
        const t = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "title"
        );
        t.textContent = `${key} · ${n} 本\n${this.pathsOn(key)
          .map((p) => p.split("/").pop()?.replace(/\.md$/, ""))
          .join("\n")}`;
        g.appendChild(t);
      }
    }
  }

  private renderWeekStrip(host: HTMLElement) {
    const wrap = host.createDiv({ cls: "bs-chart" });
    wrap.createDiv({ cls: "bs-chart-title", text: "本周阅读" });
    const start = this.weekStart(new Date());
    const counts = dailyCounts(
      this.store,
      start,
      new Date(start.getTime() + 6 * 86400000)
    );
    const max = Math.max(1, ...counts.values());
    const cell = 46;
    const gap = 10;
    const width = 7 * (cell + gap);
    const height = cell + 34;
    const svg = svgEl(wrap, width, height);
    let i = 0;
    for (const [key, n] of counts) {
      const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
      const g = svgEl(svg, 0, 0, "g") as SVGGElement;
      const r = svgEl(g, 0, 0, "rect") as SVGRectElement;
      const x = i * (cell + gap);
      r.setAttribute("x", String(x));
      r.setAttribute("y", "6");
      r.setAttribute("width", String(cell));
      r.setAttribute("height", String(cell));
      r.setAttribute("rx", "6");
      r.setAttribute("class", `bs-heat l${level}`);
      text(g, x + cell / 2 - 8, 34, String(new Date(key).getDate()), {
        fill: level >= 3 ? "#fff" : "var(--text-muted)",
        "font-size": "13",
      });
      text(g, x + cell / 2 - 5, cell + 26, WEEK_LABEL[i], {
        fill: "var(--text-faint)",
        "font-size": "11",
      });
      if (n > 0) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
        t.textContent = `${key} · ${n} 本`;
        g.appendChild(t);
      }
      i++;
    }
  }

  private renderMonthBars(host: HTMLElement) {
    const wrap = host.createDiv({ cls: "bs-chart" });
    const year = this.range === "month" ? new Date().getFullYear() : this.year;
    wrap.createDiv({ cls: "bs-chart-title", text: "每月阅读天数" });

    const perMonth: number[] = [];
    const store = this.store;
    for (let m = 0; m < 12; m++) {
      const days = new Date(year, m + 1, 0).getDate();
      let n = 0;
      for (let d = 1; d <= days; d++) {
        if (this.pathsOn(dayKey(new Date(year, m, d))).length > 0) n++;
      }
      perMonth.push(n);
    }

    const max = Math.max(1, ...perMonth);
    const width = 760;
    const height = 240;
    const padL = 40;
    const padB = 26;
    const padT = 16;
    const svg = svgEl(wrap, width, height);
    const plotH = height - padT - padB;

    for (const q of [0, 0.5, 1]) {
      const y = padT + plotH * (1 - q);
      const line = svgEl(svg, 0, 0, "line") as SVGLineElement;
      line.setAttribute("x1", String(padL));
      line.setAttribute("x2", String(width - 10));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("class", "bs-axis-line");
      text(svg, 2, y + 4, `${Math.round(max * q)}天`, {
        fill: "var(--text-faint)",
        "font-size": "10",
      });
    }

    const barW = (width - padL - 20) / 12 - 8;
    perMonth.forEach((n, m) => {
      const h = (n / max) * plotH;
      const x = padL + m * ((width - padL - 20) / 12) + 4;
      const r = svgEl(svg, 0, 0, "rect") as SVGRectElement;
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(padT + plotH - h));
      r.setAttribute("width", String(barW));
      r.setAttribute("height", String(Math.max(h, 1)));
      r.setAttribute("rx", "3");
      r.setAttribute("class", n > 0 ? "bs-bar has" : "bs-bar");
      const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      t.textContent = `${m + 1} 月 · ${n} 天`;
      r.appendChild(t);
      text(svg, x + barW / 2 - 10, height - 8, `${m + 1}月`, {
        fill: "var(--text-faint)",
        "font-size": "10",
      });
    });
  }

  private renderYearBars(host: HTMLElement) {
    const wrap = host.createDiv({ cls: "bs-chart" });
    wrap.createDiv({ cls: "bs-chart-title", text: "每年阅读天数" });
    const years = new Map<number, number>();
    for (const day of Object.keys(this.store.days)) {
      if (this.pathsOn(day).length === 0) continue;
      const y = Number(day.slice(0, 4));
      years.set(y, (years.get(y) ?? 0) + 1);
    }
    if (years.size === 0) {
      wrap.createDiv({ cls: "bs-empty", text: "还没有记录，从今天开始积累" });
      return;
    }
    const entries = [...years.entries()].sort((a, b) => a[0] - b[0]);
    const max = Math.max(1, ...entries.map(([, n]) => n));
    const width = Math.max(320, entries.length * 70);
    const height = 240;
    const padL = 40;
    const plotH = height - 46;
    const svg = svgEl(wrap, width, height);
    const slot = (width - padL) / entries.length;
    entries.forEach(([y, n], i) => {
      const h = (n / max) * plotH;
      const r = svgEl(svg, 0, 0, "rect") as SVGRectElement;
      r.setAttribute("x", String(padL + i * slot + 8));
      r.setAttribute("y", String(16 + plotH - h));
      r.setAttribute("width", String(slot - 24));
      r.setAttribute("height", String(Math.max(h, 1)));
      r.setAttribute("rx", "3");
      r.setAttribute("class", "bs-bar has");
      const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      t.textContent = `${y} · ${n} 天`;
      r.appendChild(t);
      text(svg, padL + i * slot + 4, height - 24, String(y), {
        fill: "var(--text-faint)",
        "font-size": "11",
      });
      text(svg, padL + i * slot + 8, height - 8, `${n} 天`, {
        fill: "var(--text-muted)",
        "font-size": "11",
      });
    });
  }

  // ---------- 偏好分析 ----------

  private renderPreferences(body: HTMLElement) {
    const books = this.plugin.collectBooks();
    if (books.length === 0) return;

    const genreCount = new Map<string, number>();
    const pubCount = new Map<string, number>();
    for (const b of books) {
      const fm = b.frontmatter;
      const raw = fm["category"] ?? fm["genre"];
      const joined = Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
      for (const g of joined.split(/[,，、;；]+/)) {
        // 微信读书的 category 形如「个人成长-励志成长」，取大类
        const k = g.split("-")[0].trim();
        if (k) genreCount.set(k, (genreCount.get(k) ?? 0) + 1);
      }
      const pub = fm["publisher"];
      if (pub) {
        const k = String(Array.isArray(pub) ? pub.join("/") : pub).trim();
        if (k) pubCount.set(k, (pubCount.get(k) ?? 0) + 1);
      }
    }

    const row = body.createDiv({ cls: "bs-pref-row" });

    const radarCard = row.createDiv({ cls: "bs-pref-card" });
    radarCard.createDiv({ cls: "bs-chart-title", text: "偏好分析 · 分类" });
    const genres = [...genreCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    if (genres.length >= 3) {
      this.renderRadar(radarCard, genres);
    } else {
      const top = genres.length
        ? `主要是「${genres[0][0]}」`
        : "书还太少，先在 frontmatter 里标 genre";
      radarCard.createDiv({ cls: "bs-pref-empty", text: top });
    }

    const pubCard = row.createDiv({ cls: "bs-pref-card" });
    pubCard.createDiv({ cls: "bs-chart-title", text: "偏好出版方" });
    const pubs = [...pubCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (pubs.length === 0) {
      pubCard.createDiv({ cls: "bs-pref-empty", text: "还没有 publisher 字段" });
    }
    for (const [name, n] of pubs) {
      const line = pubCard.createDiv({ cls: "bs-pref-line" });
      line.createSpan({ text: name });
      line.createSpan({ cls: "bs-pref-num", text: `${n} 本` });
    }
  }

  private renderRadar(
    host: HTMLElement,
    entries: [string, number][]
  ) {
    const size = 260;
    const cx = size / 2;
    const cy = size / 2 + 6;
    const radius = 78;
    const n = entries.length;
    const svg = svgEl(host, size, size);
    const max = Math.max(...entries.map(([, v]) => v));
    const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
    const at = (i: number, r: number) => [
      cx + Math.cos(angle(i)) * r,
      cy + Math.sin(angle(i)) * r,
    ];

    for (const ring of [0.33, 0.66, 1]) {
      const pts = entries
        .map((_, i) => at(i, radius * ring))
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(" ");
      const poly = svgEl(svg, 0, 0, "polygon") as SVGPolygonElement;
      poly.setAttribute("points", pts);
      poly.setAttribute("class", "bs-radar-ring");
    }

    const vals = entries
      .map(([, v], i) => at(i, (v / max) * radius))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    const area = svgEl(svg, 0, 0, "polygon") as SVGPolygonElement;
    area.setAttribute("points", vals);
    area.setAttribute("class", "bs-radar-area");

    entries.forEach(([name], i) => {
      const [x, y] = at(i, radius + 20);
      const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
      text(svg, x, y + 4, name, {
        fill: "var(--text-muted)",
        "font-size": "10",
        "text-anchor": anchor,
      });
    });
  }
}

// ---------- 小工具 ----------

function svgEl(
  parent: Element,
  width?: number,
  height?: number,
  tag = "svg"
): SVGElement {
  const el = document.createElementNS(`http://www.w3.org/2000/svg`, tag);
  if (tag === "svg") {
    el.setAttribute("width", String(width ?? 0));
    el.setAttribute("height", String(height ?? 0));
    el.setAttribute("viewBox", `0 0 ${width ?? 0} ${height ?? 0}`);
  }
  parent.appendChild(el);
  return el as SVGElement;
}

function text(
  parent: Element,
  x: number,
  y: number,
  content: string,
  attrs: Record<string, string>
) {
  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
  t.textContent = content;
  parent.appendChild(t);
}

