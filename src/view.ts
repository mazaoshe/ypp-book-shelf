import { ItemView, Menu, TFile, WorkspaceLeaf, normalizePath, requestUrl } from "obsidian";
import type BookShelfPlugin from "./main";
import { FetchModal } from "./fetchModal";
import { listSep, t } from "./i18n";
import { DeleteBookModal } from "./deleteModal";
import { BookItem } from "./types";
import { collectBooks } from "./library";
import { asStr } from "./fm";

export const VIEW_TYPE_BOOK_SHELF = "book-shelf-view";

export class BookShelfView extends ItemView {
  plugin: BookShelfPlugin;
  private searchText = "";
  private statusFilter = "全部";
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
      this.renderGrid();
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
      this.renderGrid();
    };

    const sortSelect = bar.createEl("select", { cls: "dropdown" });
    const sortOptions: [string, string][] = [
      ["mtime", t("按最近修改")],
      ["ctime", t("按加入时间")],
      ["title", t("按书名")],
      ["author", t("按作者")],
      ["rating", t("按评分")],
      ["status", t("按阅读状态")],
    ];
    if (!sortOptions.some(([v]) => v === this.sortMode)) this.sortMode = "mtime";
    for (const [value, label] of sortOptions) {
      const opt = sortSelect.createEl("option", { text: label, value });
      if (value === this.sortMode) opt.selected = true;
    }
    sortSelect.onchange = () => {
      this.sortMode = sortSelect.value;
      this.renderGrid();
    };

    const dirBtn = bar.createEl("button", {
      text: this.sortDesc ? t("↓ 倒序") : t("↑ 正序"),
      cls: "bs-btn",
    });
    dirBtn.title = t("切换升/降序");
    dirBtn.onclick = () => {
      this.sortDesc = !this.sortDesc;
      dirBtn.setText(this.sortDesc ? t("↓ 倒序") : t("↑ 正序"));
      this.renderGrid();
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
    this.renderGrid();
  }

  private gridEl: HTMLElement;
  private countEl: HTMLElement;

  private uniqueStatuses(): string[] {
    const set = new Set<string>();
    for (const b of this.books) if (b.status) set.add(b.status);
    return Array.from(set);
  }

  private filteredBooks(): BookItem[] {
    const q = this.searchText.trim().toLowerCase();
    let list = this.books.filter((b) => {
      if (this.statusFilter !== "全部" && b.status !== this.statusFilter) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
      );
    });
    const statusOrder = (s: string) =>
      s === "在读" ? 0 : s === "想读" ? 1 : s === "读完" ? 2 : 3;
    const ratingNum = (b: BookItem) => {
      const raw = asStr(b.frontmatter["rating"]);
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
          return ratingNum(a) - ratingNum(b);
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

  renderGrid() {
    if (!this.gridEl) return;
    const grid = this.gridEl;
    grid.empty();
    const list = this.filteredBooks();

    if (this.countEl) {
      this.countEl.setText(
        list.length === this.books.length
          ? t("共 {n} 本", { n: this.books.length })
          : t("{a} / {b} 本", { a: list.length, b: this.books.length })
      );
    }

    if (list.length === 0) {
      grid.createDiv({
        cls: "bs-empty",
        text: this.books.length
          ? t("没有匹配的书")
          : t("在 {folder} 里没找到书籍笔记（检查设置里的目录和 type 字段）", { folder: this.s.folder }),
      });
      return;
    }

    for (const book of list) {
      const card = grid.createDiv({ cls: "bs-card" });

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

      if (book.author) body.createDiv({ cls: "bs-author", text: book.author });

      const tags = body.createDiv({ cls: "bs-tags" });
      if (book.status) tags.createSpan({ cls: "bs-tag", text: book.status });
      const rating = asStr(book.frontmatter["rating"]);
      if (rating) tags.createSpan({ cls: "bs-tag bs-tag-rating", text: rating });

      const missing = this.missingFields(book);
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

  /** 同一个书目录里有多个副本时，手动指定哪篇代表这本书 */
  private async setPrimary(book: BookItem) {
    const parent = book.file.parent;
    if (!parent) return;
    const siblings = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.parent === parent);
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

  /** 缺哪些关键字段，用来决定是否还显示「补全」 */
  private missingFields(book: BookItem): string[] {
    const miss: string[] = [];
    if (!this.coverSrc(book.cover, book.file)) miss.push(t("封面"));
    if (!book.author) miss.push(t("作者"));
    const isWeread = asStr(book.frontmatter["doc_type"]).startsWith("weread");
    if (this.s.requireDesc && !isWeread) {
      if (!asStr(book.frontmatter["desc"])) miss.push(t("简介"));
    }
    return miss;
  }

  private remoteCache = new Map<string, string>();

  /** 豆瓣图有防盗链（直接 <img> 会 418），用 requestUrl 拉回来转 blob URL */
  private async resolveRemote(url: string): Promise<string> {
    const hit = this.remoteCache.get(url);
    if (hit) return hit;
    try {
      const res = await requestUrl({ url, throw: false });
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
