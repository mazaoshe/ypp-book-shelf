import { ItemView, Menu, TFile, WorkspaceLeaf, normalizePath, requestUrl } from "obsidian";
import type BookShelfPlugin from "./main";
import { FetchModal } from "./fetchModal";
import { listSep, t } from "./i18n";
import { DeleteBookModal } from "./deleteModal";
import { BookItem, MissingKey } from "./types";
import {
  columnLabel,
  defaultDesc,
  isSortable,
  parseSortMode,
  propValue,
  sortModeFor,
  type ColumnConfig,
} from "./columns";
import { collectBooks, countWords } from "./library";
import { attachInlineEdit } from "./inlineEdit";
import { asStr } from "./fm";
import { childFiles } from "./vaultScope";

import { readingYear, matchesShelfFilters } from "./reading";

export const VIEW_TYPE_BOOK_SHELF = "book-shelf-view";

export class BookShelfView extends ItemView {
  plugin: BookShelfPlugin;
  private searchText = "";
  private statusFilter = "全部";
  private yearFilter = "all";
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

    const years = [...new Set(this.books.map((b) => readingYear(b.finishedDate)).filter(Boolean))].sort().reverse();
    if (this.yearFilter !== "all" && this.yearFilter !== "unknown" && !years.includes(this.yearFilter)) this.yearFilter = "all";
    const yearSelect = bar.createEl("select", { cls: "dropdown" });
    yearSelect.title = t("按读完年份筛选");
    yearSelect.setAttribute("aria-label", t("按读完年份筛选"));
    for (const year of ["all", ...years, "unknown"]) {
      const option = yearSelect.createEl("option", {
        value: year,
        text: year === "all" ? t("全部阅读年份") : year === "unknown" ? t("未填写有效读完日期") : year,
      });
      option.selected = year === this.yearFilter;
    }
    yearSelect.onchange = () => { this.yearFilter = yearSelect.value; this.renderItems(); };

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
    // 属性列排序（点表头进来的）也要能在下拉里显示当前项
    const currentMode = parseSortMode(this.sortMode);
    if (currentMode?.kind === "prop") {
      const col = (this.plugin.settings.columns ?? []).find(
        (c) => c.kind === "prop" && c.key === currentMode.key
      );
      sortOptions.push([
        this.sortMode,
        t("按{col}", { col: col ? columnLabel(col) : currentMode.key }),
      ]);
    } else if (!sortOptions.some(([v]) => v === this.sortMode)) {
      this.sortMode = "mtime";
    }
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
    let list = this.books.filter((b) => matchesShelfFilters(b, this.searchText, this.statusFilter, this.categoryFilter, this.yearFilter));
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
    const mode = parseSortMode(this.sortMode);
    // 属性列的排序键：空值统一用 "~zzz" 垫底
    const propKey = (b: BookItem) =>
      mode?.kind === "prop" ? propValue(b, mode.key) || "~zzz" : "";
    const cmp = (a: BookItem, b: BookItem): number => {
      if (mode?.kind === "prop") {
        return propKey(a).localeCompare(propKey(b), "zh", { numeric: true });
      }
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
      if (book.status) {
        tags.createSpan({
          cls: `bs-tag bs-tag-status ${this.statusClass(book.status)}`,
          text: book.status,
        });
      }
      if (book.source) {
        tags.createSpan({
          cls: `bs-tag bs-tag-source ${this.sourceClass(book.source)}`,
          text: book.source,
        });
      }
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

  /** 当前要显示的列：书名列始终在 */
  private visibleColumns(): ColumnConfig[] {
    const cols = this.plugin.settings.columns ?? [];
    return cols.filter(
      (c) => c.visible || (c.kind === "builtin" && c.key === "title")
    );
  }

  /** 列的样式类，跟 styles.css 的 .bs-col-* 对应 */
  private columnClass(col: ColumnConfig): string {
    if (col.kind === "prop") return "bs-td-muted bs-col-wide bs-td-prop";
    switch (col.key) {
      case "cover":
        return "bs-col-cover";
      case "title":
        return "bs-col-title";
      case "author":
        return "bs-col-author";
      case "translator":
      case "publisher":
        return "bs-col-wide";
      case "rating":
      case "pages":
      case "status":
      case "words":
        return "bs-col-num";
      default:
        return "bs-td-desc";
    }
  }

  /** 列表视图：按设置里的列显隐渲染，表头点击排序 */
  private renderTable(list: BookItem[]) {
    this.hideCoverPreview();
    this.hideHoverText();
    const table = this.gridEl.createEl("table", { cls: "bs-table" });
    const headRow = table.createEl("thead").createEl("tr");
    const columns = this.visibleColumns();
    const pending: { file: TFile; cell: HTMLElement }[] = [];

    // 表头：封面列没有文字，其余按列配置画
    for (const col of columns) {
      const cls = this.columnClass(col);
      if (col.kind === "builtin" && col.key === "cover") {
        headRow.createEl("th", { cls });
        continue;
      }
      if (!isSortable(col)) {
        headRow.createEl("th", { cls, text: columnLabel(col) });
        continue;
      }
      const mode = sortModeFor(col);
      const th = headRow.createEl("th", { cls: `bs-th-sort ${cls}` });
      const arrow = this.sortMode === mode ? (this.sortDesc ? " ↓" : " ↑") : "";
      th.setText(columnLabel(col) + arrow);
      th.onclick = () => {
        if (this.sortMode === mode) this.sortDesc = !this.sortDesc;
        else {
          this.sortMode = mode;
          this.sortDesc = defaultDesc(col);
        }
        this.persistSort();
        this.render();
      };
    }
    headRow.createEl("th", { text: "" });

    const tbody = table.createEl("tbody");
    for (const book of list) {
      const tr = tbody.createEl("tr");
      for (const col of columns) this.renderTableCell(col, tr, book, pending);

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

  private renderTableCell(
    col: ColumnConfig,
    tr: HTMLTableRowElement,
    book: BookItem,
    pending: { file: TFile; cell: HTMLElement }[]
  ) {
    if (col.kind === "prop") {
      if (col.key === "finishedDate") {
        this.renderDateCell(tr, book);
        return;
      }
      if (col.key === "readingSource") {
        this.renderSourceCell(tr, book);
        return;
      }
      const value = propValue(book, col.key);
      const td = tr.createEl("td", {
        cls: "bs-td-muted bs-td-prop",
        text: value || "—",
      });
      if (value) td.title = value;
      return;
    }
    switch (col.key) {
      case "cover": {
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
        return;
      }
      case "title": {
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
        if (book.isbn)
          titleTd.createDiv({ cls: "bs-td-sub", text: `ISBN ${book.isbn}` });
        return;
      }
      case "author":
        tr.createEl("td", {
          cls: "bs-td-muted bs-col-author",
          text: book.author || "—",
        });
        return;
      case "translator":
        tr.createEl("td", {
          cls: "bs-td-muted bs-col-wide",
          text: book.translator || "—",
        });
        return;
      case "publisher":
        tr.createEl("td", {
          cls: "bs-td-muted bs-col-wide",
          text: book.publisher || "—",
        });
        return;
      case "rating":
        tr.createEl("td", {
          cls: "bs-td-muted bs-col-num",
          text: book.score || "—",
        });
        return;
      case "pages":
        tr.createEl("td", {
          cls: "bs-td-muted bs-col-num",
          text: book.pages ? String(book.pages) : "—",
        });
        return;
      case "status": {
        this.renderStatusCell(tr, book);
        return;
      }
      case "words": {
        // 字数要读笔记正文，先占位，读完再填
        const wordTd = tr.createEl("td", { cls: "bs-td-muted bs-col-num" });
        wordTd.setText("…");
        pending.push({ file: book.file, cell: wordTd });
        return;
      }
      case "desc": {
        const descTd = tr.createEl("td", {
          cls: "bs-td-desc",
          text: book.desc || "—",
        });
        if (book.desc) {
          descTd.onmouseenter = () => this.showHoverText(book.desc, descTd);
          descTd.onmouseleave = () => this.scheduleHideHoverText();
        }
        return;
      }
    }
  }

  /** 阅读状态的颜色：想读蓝、在读橙、读完绿、弃读红，其他灰 */
  private statusClass(status: string): string {
    switch (status) {
      case "想读":
        return "bs-status-want";
      case "在读":
        return "bs-status-reading";
      case "读完":
        return "bs-status-finished";
      case "弃读":
        return "bs-status-dropped";
      default:
        return "bs-status-other";
    }
  }

  /** 阅读途径的颜色：先按常见来源固定配色，自定义来源用稳定哈希分色 */
  private sourceClass(source: string): string {
    const key = source.trim().toLowerCase();
    if (["微信读书", "微信阅读", "weread"].includes(key)) return "bs-source-weread";
    if (["纸质书", "纸质", "实体书", "print", "print-book"].includes(key)) return "bs-source-paper";
    if (["kindle", "kindle电子书"].includes(key)) return "bs-source-kindle";
    if (["电子书", "电子", "pdf"].includes(key)) return "bs-source-ebook";
    if (["听书", "有声书", "音频", "audio"].includes(key)) return "bs-source-audio";
    if (["其他", "other"].includes(key)) return "bs-source-other";
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
      hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    }
    return `bs-source-tone-${(hash % 6) + 1}`;
  }

  private renderDateCell(tr: HTMLTableRowElement, book: BookItem) {
    const td = tr.createEl("td", {
      cls: "bs-td-muted bs-td-prop bs-editable",
      text: book.finishedDate || "—",
    });
    td.title = t("点击编辑读完日期");
    td.onclick = (e) => {
      e.stopPropagation();
      attachInlineEdit(td, {
        kind: "date",
        value: book.finishedDate,
        ariaLabel: t("读完日期"),
        onCommit: (value) => this.writeBookField(book, "finishedDate", value),
      });
    };
  }

  private renderSourceCell(tr: HTMLTableRowElement, book: BookItem) {
    const td = tr.createEl("td", {
      cls: "bs-td-muted bs-td-prop bs-editable",
    });
    if (book.source) {
      td.createSpan({
        cls: `bs-tag bs-tag-source ${this.sourceClass(book.source)}`,
        text: book.source,
      });
    } else {
      td.setText("—");
    }
    td.title = t("点击编辑阅读途径");
    td.onclick = (e) => {
      e.stopPropagation();
      const options = (this.s.readingSources ?? []).map((value) => ({
        value,
        label: value,
      }));
      attachInlineEdit(td, {
        kind: "select",
        value: book.source,
        options,
        ariaLabel: t("阅读途径"),
        onCommit: (value) => this.writeBookField(book, "readingSource", value),
      });
    };
  }

  private renderStatusCell(tr: HTMLTableRowElement, book: BookItem) {
    const td = tr.createEl("td", { cls: "bs-col-num bs-td-status bs-editable" });
    if (book.status) {
      td.createSpan({
        cls: `bs-tag bs-tag-status ${this.statusClass(book.status)}`,
        text: book.status,
      });
    } else td.setText("—");
    td.title = t("点击编辑阅读状态");
    td.onclick = (e) => {
      e.stopPropagation();
      const options = ["想读", "在读", "读完", "弃读"].map((value) => ({
        value,
        label: t(value),
      }));
      attachInlineEdit(td, {
        kind: "select",
        value: book.status,
        options,
        ariaLabel: t("阅读状态"),
        onCommit: (value) =>
          this.writeBookField(book, this.s.statusField || "readingStatus", value),
      });
    };
  }

  /** 行内编辑统一走这里：写 frontmatter 后重新收集数据，列表立即刷新 */
  private async writeBookField(book: BookItem, key: string, value: string) {
    await this.app.fileManager.processFrontMatter(book.file, (fm: Record<string, unknown>) => {
      fm[key] = value;
    });
    this.render();
    this.plugin.refreshStats();
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
