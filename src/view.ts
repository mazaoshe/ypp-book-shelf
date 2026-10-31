import { ItemView, Menu, TFile, WorkspaceLeaf, normalizePath, requestUrl } from "obsidian";
import type BookShelfPlugin from "./main";
import { FetchModal } from "./fetchModal";
import { listSep, t } from "./i18n";
import { DeleteBookModal } from "./deleteModal";
import { BookItem, MissingKey } from "./types";
import { collectBooks, countWords } from "./library";
import { asStr } from "./fm";
import { childFiles } from "./vaultScope";

export const VIEW_TYPE_BOOK_SHELF = "book-shelf-view";

export class BookShelfView extends ItemView {
  plugin: BookShelfPlugin;
  private searchText = "";
  private statusFilter = "全部";
  private categoryFilter = "全部";
  private viewMode: "grid" | "list" = "grid";
  private sortMode = "mtime";
  private sortDesc = true;
  private books: BookItem[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: BookShelfPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_BOOK_SHELF;
  }

  getDisplayText() {
    return t("书架");
  }

  getIcon() {
    return "library-big";
  }

  async onOpen() {
    this.contentEl.addClass("book-shelf-view");
    this.render();

    const rerender = this.debounce(() => this.render(), 400);
    this.registerEvent(this.app.vault.on("modify", rerender));
    this.registerEvent(this.app.vault.on("create", rerender));
    this.registerEvent(this.app.vault.on("delete", rerender));
    this.registerEvent(this.app.vault.on("rename", rerender));
  }

  private debounce(fn: () => void, ms: number) {
    let timer: number | null = null;
    return () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(fn, ms);
    };
  }

  private get s() {
    return this.plugin.settings;
  }

  /** 同一本书目录里常有 微信读书/豆瓣/Z-Library 多个副本，只留一个主笔记 */
  collectBooks(): BookItem[] {
    return collectBooks(this.app, this.s);
  }

  /** 本地封面优先：同目录 cover.jpg/png/webp 先于 frontmatter（微信读书同步会把 cover 刷回外链） */
  localCover(noteFile?: TFile): string {
    if (!noteFile?.parent) return "";
    const dir = noteFile.parent.path;
    const base = this.s.coverFileName || "cover.jpg";
    const stem = base.replace(/\.[^.]+$/, "");
    const names = [base, `${stem}.png`, `${stem}.jpeg`, `${stem}.webp`];
    for (const n of names) {
      const p = dir === "/" ? n : `${dir}/${n}`;
      const f = this.app.vault.getAbstractFileByPath(normalizePath(p));
      if (f instanceof TFile) return this.app.vault.adapter.getResourcePath(f.path);
    }
    return "";
  }

  coverSrc(raw: string, noteFile?: TFile): string {
    const local = this.localCover(noteFile);
    if (local) return local;
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    const clean = raw.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    const candidates = [clean];
    if (noteFile?.parent && noteFile.parent.path !== "/") {
      candidates.push(`${noteFile.parent.path}/${clean}`);
    }
    for (const c of candidates) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(c));
      if (file instanceof TFile) {
        return this.app.vault.adapter.getResourcePath(file.path);
      }
    }
    return "";
  }

  render() {
    const el = this.contentEl;
    el.empty();

    // 视图模式与排序都以设置为准：上次切过就沿用，别每次重开都回默认
    this.viewMode = this.plugin.settings.viewMode ?? "grid";
    this.sortMode = this.plugin.settings.sortMode || "mtime";
    this.sortDesc = this.plugin.settings.sortDesc ?? true;
    this.books = this.collectBooks();

    // 顶栏
    const bar = el.createDiv({ cls: "bs-toolbar" });
    const searchWrap = bar.createDiv({ cls: "bs-search" });
    const input = searchWrap.createEl("input", {
      type: "text",
      placeholder: t("搜索书名或作者"),
    });
    input.value = this.searchText;
    input.oninput = () => {
      this.searchText = input.value;
      this.renderItems();
    };

    const statuses = this.uniqueStatuses();
    const statusCount = (st: string) =>
      st === "全部"
        ? this.books.length
        : this.books.filter((b) => b.status === st).length;
    const select = bar.createEl("select", { cls: "dropdown" });
    for (const st of ["全部", ...statuses]) {
      const opt = select.createEl("option", {
        text: t("{st}（{n}）", { st: st === "全部" ? t("全部") : st, n: statusCount(st) }),
        value: st,
      });
      if (st === this.statusFilter) opt.selected = true;
    }
    select.onchange = () => {
      this.statusFilter = select.value;
      this.renderItems();
    };

    // 分类筛选：只认 category / genre，跟统计雷达取同一套大类
    const categories = this.uniqueCategories();
    const catCount = (c: string) =>
      c === "全部"
        ? this.books.length
        : this.books.filter((b) => b.categories.includes(c)).length;
    if (this.categoryFilter !== "全部" && !categories.includes(this.categoryFilter)) {
      this.categoryFilter = "全部";
    }
    const catSelect = bar.createEl("select", { cls: "dropdown" });
    catSelect.title = t("按分类筛选");
    for (const c of ["全部", ...categories]) {
      const opt = catSelect.createEl("option", {
        text: t("{st}（{n}）", { st: c === "全部" ? t("全部") : c, n: catCount(c) }),
        value: c,
      });
      if (c === this.categoryFilter) opt.selected = true;
    }
    catSelect.onchange = () => {
      this.categoryFilter = catSelect.value;
      this.renderItems();
    };

    const toggle = bar.createDiv({ cls: "bs-viewtoggle" });
    const modes: ["grid" | "list", string][] = [
      ["grid", t("网格")],
      ["list", t("列表")],
    ];
    for (const [mode, label] of modes) {
      const btn = toggle.createEl("button", {
        text: label,
        cls: this.viewMode === mode ? "bs-btn bs-btn-sm is-active" : "bs-btn bs-btn-sm",
      });
      btn.onclick = () => {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        this.plugin.settings.viewMode = mode;
        void this.plugin.saveSettings();
        this.render();
      };
    }

    const sortSelect = bar.createEl("select", { cls: "dropdown" });
    const sortOptions: [string, string][] = [
      ["mtime", t("按最近修改")],
      ["ctime", t("按加入时间")],
      ["title", t("按书名")],
      ["author", t("按作者")],
      ["rating", t("按评分")],
      ["status", t("按阅读状态")],
      ["pages", t("按页数")],
      ["category", t("按分类")],
      ["translator", t("按译者")],
      ["publisher", t("按出版社")],
    ];
    if (!sortOptions.some(([v]) => v === this.sortMode)) this.sortMode = "mtime";
    for (const [value, label] of sortOptions) {
      const opt = sortSelect.createEl("option", { text: label, value });
      if (value === this.sortMode) opt.selected = true;
    }
    sortSelect.onchange = () => {
      this.sortMode = sortSelect.value;
      this.persistSort();
      this.renderItems();
    };

    const dirBtn = bar.createEl("button", {
      text: this.sortDesc ? t("↓ 倒序") : t("↑ 正序"),
      cls: "bs-btn",
    });
    dirBtn.title = t("切换升/降序");
    dirBtn.onclick = () => {
      this.sortDesc = !this.sortDesc;
      dirBtn.setText(this.sortDesc ? t("↓ 倒序") : t("↑ 正序"));
      this.renderItems();
    };

    const newBtn = bar.createEl("button", { text: t("+ 新建书籍"), cls: "bs-btn" });
    newBtn.onclick = () =>
      new FetchModal(this.app, this.plugin, null, (f) => {
        this.render();
        if (f) void this.app.workspace.getLeaf(false).openFile(f);
      }).open();

    const statsBtn = bar.createEl("button", {
      text: t("统计"),
      cls: "bs-btn",
    });
    statsBtn.onclick = () => void this.plugin.activateStatsView();

    const refresh = bar.createEl("button", { text: t("刷新"), cls: "bs-btn" });
    refresh.onclick = () => this.render();

    this.countEl = bar.createSpan({ cls: "bs-count" });

    this.gridEl = el.createDiv({ cls: "bs-grid" });
    this.renderItems();
  }

  private gridEl: HTMLElement;
  private countEl: HTMLElement;

  private uniqueStatuses(): string[] {
    const set = new Set<string>();
    for (const b of this.books) if (b.status) set.add(b.status);
    return Array.from(set);
  }

  private uniqueCategories(): string[] {
    const set = new Set<string>();
    for (const b of this.books) for (const c of b.categories) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh"));
  }

  /** 缺字段 key → 当前语言文案 */
  private missingLabel(k: MissingKey): string {
    if (k === "cover") return t("封面");
    if (k === "author") return t("作者");
    return t("简介");
  }

  private filteredBooks(): BookItem[] {
    const q = this.searchText.trim().toLowerCase();
    let list = this.books.filter((b) => {
      if (this.statusFilter !== "全部" && b.status !== this.statusFilter) return false;
      if (
        this.categoryFilter !== "全部" &&
        !b.categories.includes(this.categoryFilter)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
      );
    });
    const statusOrder = (s: string) =>
      s === "在读" ? 0 : s === "想读" ? 1 : s === "读完" ? 2 : 3;
    const scoreNum = (b: BookItem) => {
      const raw = b.score || asStr(b.frontmatter["rating"]);
      const stars = (raw.match(/[⭐★]/g) ?? []).length;
      if (stars > 0) return stars;
      const n = parseFloat(raw.replace(/[^\d.]/g, ""));
      return isNaN(n) ? 0 : n;
    };
    const dir = this.sortDesc ? -1 : 1;
    const cmp = (a: BookItem, b: BookItem): number => {
      switch (this.sortMode) {
        case "title":
          return a.title.localeCompare(b.title, "zh");
        case "author":
          return (a.author || "~zzz").localeCompare(b.author || "~zzz", "zh");
        case "rating":
          return scoreNum(a) - scoreNum(b);
        case "pages":
          return a.pages - b.pages;
        case "translator":
          return (a.translator || "~zzz").localeCompare(b.translator || "~zzz", "zh");
        case "publisher":
          return (a.publisher || "~zzz").localeCompare(b.publisher || "~zzz", "zh");
        case "category":
          return (a.categories[0] ?? "~zzz").localeCompare(
            b.categories[0] ?? "~zzz",
            "zh"
          );
        case "ctime":
          return a.file.stat.ctime - b.file.stat.ctime;
        case "status": {
          const d = statusOrder(a.status) - statusOrder(b.status);
          return d !== 0 ? d : a.title.localeCompare(b.title, "zh");
        }
        default:
          return a.file.stat.mtime - b.file.stat.mtime;
      }
    };
    list = list.slice().sort((a, b) => {
      const r = cmp(a, b) * dir;
      return r !== 0 ? r : a.title.localeCompare(b.title, "zh");
    });
    return list;
  }

  renderItems() {
    if (!this.gridEl) return;
    this.gridEl.empty();
    this.gridEl.className = this.viewMode === "list" ? "bs-list-wrap" : "bs-grid";
    const list = this.filteredBooks();

    if (this.countEl) {
      this.countEl.setText(
        list.length === this.books.length
          ? t("共 {n} 本", { n: this.books.length })
          : t("{a} / {b} 本", { a: list.length, b: this.books.length })
      );
    }

    if (list.length === 0) {
      this.gridEl.createDiv({
        cls: "bs-empty",
        text: this.books.length
          ? t("没有匹配的书")
          : t("在 {folder} 里没找到书籍笔记（检查设置里的目录和 type 字段）", { folder: this.s.folder }),
      });
      return;
    }

    if (this.viewMode === "list") this.renderTable(list);
    else this.renderCards(list);
  }

  private renderCards(list: BookItem[]) {
    for (const book of list) {
      const card = this.gridEl.createDiv({ cls: "bs-card" });

      const coverBox = card.createDiv({ cls: "bs-cover" });
      const src = this.coverSrc(book.cover, book.file);
      if (src) {
        this.setCoverImage(coverBox, src, book.title);
      } else {
        this.renderPlaceholder(coverBox, book.title);
      }

      const body = card.createDiv({ cls: "bs-body" });
      const titleEl = body.createDiv({ cls: "bs-title", text: book.title });
      titleEl.onclick = () => this.app.workspace.getLeaf(false).openFile(book.file);
      titleEl.title = book.file.path;

      // 副标题显示作者·译者，同一本书的不同译本一眼能分开
      const byline = [
        book.author,
        book.translator ? t("译：{name}", { name: book.translator }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (byline) body.createDiv({ cls: "bs-author", text: byline });

      const tags = body.createDiv({ cls: "bs-tags" });
      if (book.status) tags.createSpan({ cls: "bs-tag", text: book.status });
      const rating = asStr(book.frontmatter["rating"]);
      if (rating) tags.createSpan({ cls: "bs-tag bs-tag-rating", text: rating });

      const missing = book.missing.map((k) => this.missingLabel(k));
      if (missing.length > 0) {
        const actions = body.createDiv({ cls: "bs-actions" });
        const fetchBtn = actions.createEl("button", {
          text: t("补全"),
          cls: "bs-btn bs-btn-sm",
        });
        fetchBtn.title = t("缺：{list}", { list: missing.join(listSep()) });
        fetchBtn.onclick = (e) => {
          e.stopPropagation();
          new FetchModal(this.app, this.plugin, book.file, () => this.render()).open();
        };
      }
      coverBox.onclick = () => this.app.workspace.getLeaf(false).openFile(book.file);

      const moreBtn = card.createEl("button", {
        cls: "bs-more",
        attr: { "aria-label": t("更多操作") },
        text: "⋯",
      });
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        const rect = moreBtn.getBoundingClientRect();
        this.bookMenu(book).showAtPosition({ x: rect.left, y: rect.bottom });
      };
      card.oncontextmenu = (e) => {
        e.preventDefault();
        this.bookMenu(book).showAtMouseEvent(e);
      };
    }
  }

  /** 列表视图：封面 / 书名 / 作者 / 译者 / 出版社 / 评分 / 页数 / 状态 / 笔记 / 简介，表头点击排序 */
  private renderTable(list: BookItem[]) {
    this.hideCoverPreview();
    this.hideHoverText();
    const table = this.gridEl.createEl("table", { cls: "bs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    headRow.createEl("th", { cls: "bs-col-cover" });
    const sortable: [string, string, string][] = [
      ["title", t("书名"), ""],
      ["author", t("作者"), " bs-col-author"],
      ["translator", t("译者"), " bs-col-wide"],
      ["publisher", t("出版社"), " bs-col-wide"],
      ["rating", t("评分"), " bs-col-num"],
      ["pages", t("页数"), " bs-col-num"],
      ["status", t("状态"), " bs-col-num"],
    ];
    for (const [key, label, extraCls] of sortable) {
      const th = headRow.createEl("th", { cls: `bs-th-sort${extraCls}` });
      const arrow = this.sortMode === key ? (this.sortDesc ? " ↓" : " ↑") : "";
      th.setText(label + arrow);
      th.onclick = () => {
        if (this.sortMode === key) this.sortDesc = !this.sortDesc;
        else {
          this.sortMode = key;
          // 书名/作者/译者/出版社默认正序，数字和状态默认倒序
          this.sortDesc = ["rating", "pages", "status", "category"].includes(key);
        }
        this.persistSort();
        this.render();
      };
    }
    headRow.createEl("th", { cls: "bs-col-num", text: t("字数") });
    headRow.createEl("th", { text: t("简介") });
    headRow.createEl("th", { text: "" });

    const tbody = table.createEl("tbody");
    const pending: { file: TFile; cell: HTMLElement }[] = [];
    for (const book of list) {
      const tr = tbody.createEl("tr");

      // 小封面，鼠标悬停时在右边弹出大图
      const coverTd = tr.createEl("td", { cls: "bs-col-cover" });
      const thumb = coverTd.createDiv({ cls: "bs-thumb" });
      const thumbSrc = this.coverSrc(book.cover, book.file);
      if (thumbSrc) {
        this.setThumbImage(thumb, thumbSrc);
        thumb.onmouseenter = () => {
          const img = thumb.querySelector("img");
          if (img?.src) this.showCoverPreview(img.src, thumb);
        };
        thumb.onmouseleave = () => this.hideCoverPreview();
      }

      const titleTd = tr.createEl("td", { cls: "bs-td-title" });
      const nameEl = titleTd.createDiv({ cls: "bs-td-name", text: book.title });
      nameEl.onclick = () => this.app.workspace.getLeaf(false).openFile(book.file);
      // 悬停看笔记内容：走 Obsidian 原生页面预览（需开启核心插件「页面预览」）
      nameEl.onmouseenter = (evt: MouseEvent) => {
        this.app.workspace.trigger("hover-link", {
          event: evt,
          source: "ypp-book-shelf",
          hoverParent: this,
          targetEl: nameEl,
          linktext: book.file.path,
          sourcePath: book.file.path,
        });
      };
      if (book.isbn) titleTd.createDiv({ cls: "bs-td-sub", text: `ISBN ${book.isbn}` });

      tr.createEl("td", { cls: "bs-td-muted bs-col-author", text: book.author || "—" });
      tr.createEl("td", { cls: "bs-td-muted bs-col-wide", text: book.translator || "—" });
      tr.createEl("td", { cls: "bs-td-muted bs-col-wide", text: book.publisher || "—" });
      tr.createEl("td", { cls: "bs-td-muted bs-col-num", text: book.score || "—" });
      tr.createEl("td", {
        cls: "bs-td-muted bs-col-num",
        text: book.pages ? String(book.pages) : "—",
      });

      const statusTd = tr.createEl("td", { cls: "bs-col-num bs-td-status" });
      if (book.status) statusTd.createSpan({ cls: "bs-tag", text: book.status });
      else statusTd.setText("—");

      // 字数要读笔记正文，先占位，读完再填
      const wordTd = tr.createEl("td", { cls: "bs-td-muted bs-col-num" });
      wordTd.setText("…");
      pending.push({ file: book.file, cell: wordTd });

      const descTd = tr.createEl("td", { cls: "bs-td-desc", text: book.desc || "—" });
      if (book.desc) {
        descTd.onmouseenter = () => this.showHoverText(book.desc, descTd);
        descTd.onmouseleave = () => this.scheduleHideHoverText();
      }

      const moreBtn = tr.createEl("td").createEl("button", {
        cls: "bs-row-more",
        attr: { "aria-label": t("更多操作") },
        text: "⋯",
      });
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        const rect = moreBtn.getBoundingClientRect();
        this.bookMenu(book).showAtPosition({ x: rect.left, y: rect.bottom });
      };
      tr.oncontextmenu = (e) => {
        e.preventDefault();
        this.bookMenu(book).showAtMouseEvent(e);
      };
    }

    void this.fillWordCounts(pending);
  }

  /** 排序方式也写回设置，下次打开沿用 */
  private persistSort() {
    this.plugin.settings.sortMode = this.sortMode;
    this.plugin.settings.sortDesc = this.sortDesc;
    void this.plugin.saveSettings();
  }

  private setThumbImage(box: HTMLElement, src: string) {
    const img = box.createEl("img");
    if (/^https?:\/\//i.test(src)) {
      void this.resolveRemote(src).then((local) => {
        if (img.isConnected && local) img.src = local;
      });
    } else {
      img.src = src;
    }
  }

  private previewEl: HTMLElement | null = null;

  /** 悬停大图挂在 body 上，否则会被表格的横向滚动容器裁掉 */
  private showCoverPreview(src: string, anchor: HTMLElement) {
    this.hideCoverPreview();
    const rect = anchor.getBoundingClientRect();
    const box = document.body.createDiv({ cls: "bs-cover-preview" });
    const width = 160;
    const height = 240;
    const left = rect.right + 10 + width > window.innerWidth ? rect.left - width - 10 : rect.right + 10;
    box.style.left = `${Math.max(4, left)}px`;
    box.style.top = `${Math.max(4, Math.min(rect.top, window.innerHeight - height - 10))}px`;
    box.createEl("img").src = src;
    this.previewEl = box;
  }

  private hideCoverPreview() {
    this.previewEl?.remove();
    this.previewEl = null;
  }

  private quoteCache = new Map<string, number>();

  /** 填「字数」列：只算正文，跳过 frontmatter 和书籍信息/内容简介 callout，按路径 + mtime 缓存 */
  private async fillWordCounts(rows: { file: TFile; cell: HTMLElement }[]) {
    await Promise.all(
      rows.map(async ({ file, cell }) => {
        const key = `${file.path}:${file.stat.mtime}`;
        let n = this.quoteCache.get(key);
        if (n === undefined) {
          try {
            n = countWords(await this.app.vault.cachedRead(file));
          } catch {
            n = 0;
          }
          if (this.quoteCache.size > 500) this.quoteCache.clear();
          this.quoteCache.set(key, n);
        }
        if (cell.isConnected) {
          cell.setText(n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n));
        }
      })
    );
  }

  private hoverEl: HTMLElement | null = null;
  private hoverTimer: number | null = null;

  /** 悬停看全文（书名/简介）：挂在 body 上，不会被表格滚动容器裁掉 */
  private showHoverText(text: string, anchor: HTMLElement) {
    this.cancelHideHoverText();
    this.hideHoverText();
    if (!text.trim()) return;
    const rect = anchor.getBoundingClientRect();
    const box = document.body.createDiv({ cls: "bs-hover-text", text });
    const width = Math.min(420, window.innerWidth - 16);
    box.style.width = `${width}px`;
    const height = Math.min(box.getBoundingClientRect().height, 320);
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4));
    const below = rect.bottom + 8;
    const top = below + height > window.innerHeight - 4 ? Math.max(4, rect.top - height - 8) : below;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.onmouseenter = () => this.cancelHideHoverText();
    box.onmouseleave = () => this.hideHoverText();
    this.hoverEl = box;
  }

  private scheduleHideHoverText() {
    this.cancelHideHoverText();
    // 留点时间让鼠标移进浮层（长简介可以滚动看完）
    this.hoverTimer = window.setTimeout(() => this.hideHoverText(), 200);
  }

  private cancelHideHoverText() {
    if (this.hoverTimer !== null) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private hideHoverText() {
    this.hoverEl?.remove();
    this.hoverEl = null;
  }

  /** 同一个书目录里有多个副本时，手动指定哪篇代表这本书 */
  private async setPrimary(book: BookItem) {
    const parent = book.file.parent;
    if (!parent) return;
    const siblings = childFiles(parent);
    for (const f of siblings) {
      const isTarget = f.path === book.file.path;
      await this.app.fileManager.processFrontMatter(
        f,
        (fm: Record<string, unknown>) => {
          if (isTarget) fm.shelfPrimary = true;
          else if (fm.shelfPrimary !== undefined) delete fm.shelfPrimary;
        }
      );
    }
    this.render();
  }

  private remoteCache = new Map<string, string>();

  /** 豆瓣图有防盗链（直接 <img> 会 418），用 requestUrl 拉回来转 blob URL */
  private async resolveRemote(url: string): Promise<string> {
    const hit = this.remoteCache.get(url);
    if (hit) return hit;
    const headers: Record<string, string> = {};
    if (url.includes("doubanio.com")) headers.Referer = "https://book.douban.com/";
    try {
      const res = await requestUrl({ url, headers, throw: false });
      if (res.status < 200 || res.status >= 300) return "";
      const type = res.headers["content-type"] ?? "image/jpeg";
      const blob = new Blob([res.arrayBuffer], { type });
      const obj = URL.createObjectURL(blob);
      this.remoteCache.set(url, obj);
      return obj;
    } catch {
      return "";
    }
  }

  private setCoverImage(box: HTMLElement, src: string, title: string) {
    const img = box.createEl("img");
    const fail = () => {
      box.empty();
      this.renderPlaceholder(box, title);
    };
    if (/^https?:\/\//i.test(src)) {
      void this.resolveRemote(src).then((local) => {
        if (!img.isConnected) return;
        if (local) img.src = local;
        else fail();
      });
    } else {
      img.src = src;
      img.onerror = fail;
    }
  }

  /** 卡片操作菜单：右键（桌面）和「⋯」按钮（移动端）共用 */
  private bookMenu(book: BookItem): Menu {
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle(t("打开笔记"))
        .setIcon("file-text")
        .onClick(() => this.app.workspace.getLeaf(false).openFile(book.file))
    );
    menu.addItem((i) =>
      i
        .setTitle(t("重新拉取补全信息"))
        .setIcon("refresh-cw")
        .onClick(() =>
          new FetchModal(this.app, this.plugin, book.file, () => {
            this.render();
            this.plugin.refreshStats();
          }).open()
        )
    );
    menu.addItem((i) =>
      i
        .setTitle(t("以此篇为主（同目录只显示这篇）"))
        .setIcon("pin")
        .onClick(() => void this.setPrimary(book))
    );
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle(t("删除书籍…"))
        .setIcon("trash-2")
        .onClick(() =>
          new DeleteBookModal(this.app, book.file, () => this.render()).open()
        )
    );
    return menu;
  }

  private renderPlaceholder(box: HTMLElement, title: string) {
    const ph = box.createDiv({ cls: "bs-placeholder" });
    ph.setText((title || "书").slice(0, 1));
  }
}
