import { App, Modal, Notice, TFile, TFolder, normalizePath } from "obsidian";
import type BookShelfPlugin from "./main";
import { fetchDouban, searchWeread } from "./sources";
import { BookMeta } from "./types";
import { buildBookNote, DoubanLite } from "./noteTemplate";
import { t } from "./i18n";

function sanitizeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function yamlStr(s: string): string {
  if (!/[:#"\[\]{}&*!|>'"%@`]|^- |^\d+:/.test(s)) return s;
  return JSON.stringify(s);
}

function quoteLines(s: string): string {
  return s
    .split("\n")
    .map((l) => (l.trim() ? `> ${l}` : ">"))
    .join("\n");
}

export class FetchModal extends Modal {
  plugin: BookShelfPlugin;
  /** null 表示「新建书籍」模式 */
  file: TFile | null;
  onDone: (file?: TFile) => void;

  private keyword: string;
  private resultsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchBtn!: HTMLButtonElement;
  private overwrite = false;
  private useDouban: boolean;

  constructor(
    app: App,
    plugin: BookShelfPlugin,
    file: TFile | null,
    onDone: (file?: TFile) => void,
    initialKeyword = ""
  ) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.onDone = onDone;
    this.keyword = file
      ? file.basename.replace(/[（(].*?[）)]/g, "").trim()
      : initialKeyword;
    this.useDouban = plugin.settings.enableDouban;
  }

  private get isNew() {
    return this.file === null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("bs-modal");
    contentEl.createEl("h3", {
      text: this.isNew ? t("新建书籍") : t("补全书籍信息 · {name}", { name: this.file!.basename }),
    });

    const row = contentEl.createDiv({ cls: "bs-modal-row" });
    const input = row.createEl("input", {
      type: "text",
      cls: "bs-modal-input",
      placeholder: t("书名或关键词"),
    });
    input.value = this.keyword;
    input.onkeydown = (e) => {
      if (e.key === "Enter") this.runSearch();
    };
    this.searchBtn = row.createEl("button", { text: t("搜索"), cls: "mod-cta" });
    this.searchBtn.onclick = () => this.runSearch();

    const opts = contentEl.createDiv({ cls: "bs-modal-opts" });
    const cb1 = opts.createEl("input", { type: "checkbox" });
    cb1.checked = this.useDouban;
    cb1.onchange = () => (this.useDouban = cb1.checked);
    const l1 = opts.createEl("label", { text: t("同时从豆瓣补 ISBN / 页数 / 出版年") });
    l1.prepend(cb1);

    if (!this.isNew) {
      const cb2 = opts.createEl("input", { type: "checkbox" });
      cb2.checked = this.overwrite;
      cb2.onchange = () => (this.overwrite = cb2.checked);
      const l2 = opts.createEl("label", { text: t("覆盖已有字段") });
      l2.prepend(cb2);
    }

    this.statusEl = contentEl.createDiv({ cls: "bs-modal-status" });
    this.resultsEl = contentEl.createDiv({ cls: "bs-results" });

    if (this.keyword) this.runSearch();
  }

  onClose() {
    this.contentEl.empty();
  }

  private setStatus(text: string) {
    if (this.statusEl) this.statusEl.setText(text);
  }

  async runSearch() {
    const kw = (this.contentEl.querySelector(".bs-modal-input") as HTMLInputElement)
      ?.value?.trim();
    if (!kw) {
      this.setStatus(t("先输入书名"));
      return;
    }
    this.keyword = kw;
    this.searchBtn.disabled = true;
    this.setStatus(t("正在搜索微信读书…"));
    this.resultsEl.empty();
    try {
      const list = await searchWeread(kw);
      if (list.length === 0) {
        this.setStatus(t("没有搜到结果，换个关键词试试"));
        return;
      }
      this.setStatus(t("找到 {n} 条，点击右侧「用这条」写入属性", { n: list.length }));
      for (const item of list) this.renderResult(item);
    } catch (e) {
      this.setStatus(t("搜索失败：{msg}", { msg: (e as Error).message }));
    } finally {
      this.searchBtn.disabled = false;
    }
  }

  private renderResult(meta: BookMeta) {
    const row = this.resultsEl.createDiv({ cls: "bs-result" });

    const thumb = row.createDiv({ cls: "bs-result-thumb" });
    if (meta.cover) {
      const img = thumb.createEl("img");
      void this.loadThumb(img, meta.cover, thumb);
    } else {
      thumb.createDiv({ cls: "bs-placeholder", text: "书" });
    }

    const info = row.createDiv({ cls: "bs-result-info" });
    info.createDiv({ cls: "bs-result-title", text: meta.title ?? "" });
    const sub: string[] = [];
    if (meta.author) sub.push(meta.author);
    if (meta.translator) sub.push(t("译：{name}", { name: meta.translator }));
    if (meta.publisher) sub.push(meta.publisher);
    if (meta.rating) sub.push(t("推荐 {rating}", { rating: meta.rating }));
    info.createDiv({ cls: "bs-result-sub", text: sub.join(" · ") });
    if (meta.intro) {
      info.createDiv({ cls: "bs-result-intro", text: meta.intro.slice(0, 120) + "…" });
    }

    const btn = row.createEl("button", {
      text: this.isNew ? t("用这本新建") : t("用这条"),
      cls: "mod-cta",
    });
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const f = await this.apply(meta);
        new Notice(t("已写入《{title}》", { title: meta.title ?? this.keyword }));
        this.close();
        this.onDone(f);
      } catch (e) {
        new Notice(t("写入失败：{msg}", { msg: (e as Error).message }));
        btn.disabled = false;
      }
    };
  }

  /** 结果列表里的缩略图同样会被防盗链拦，走 requestUrl 转 blob */
  private async loadThumb(img: HTMLImageElement, url: string, box: HTMLElement) {
    img.src = url;
    img.onerror = async () => {
      try {
        const { requestUrl } = await import("obsidian");
        const res = await requestUrl({ url, throw: false });
        if (res.status < 200 || res.status >= 300) throw new Error("bad status");
        const blob = new Blob([res.arrayBuffer], {
          type: res.headers["content-type"] ?? "image/jpeg",
        });
        img.src = URL.createObjectURL(blob);
      } catch {
        box.empty();
        box.createDiv({ cls: "bs-placeholder", text: "书" });
      }
    };
  }

  private static norm(s: string): string {
    return s
      .toLowerCase()
      .replace(/[《》（）()【】\[\]\s:：,，.。、\-_—!！?？'"“”]/g, "");
  }

  /** 库里已有同名书（或在书目录下已有同名子目录）时，返回那篇笔记 */
  private findExisting(title: string): TFile | null {
    const target = FetchModal.norm(title);
    if (!target) return null;
    const root = (this.plugin.settings.folder || "").replace(/\/$/, "");
    const cands: { file: TFile; score: number }[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const base = FetchModal.norm(f.basename);
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? ({} as any);
      const rawTitle = String(fm.title ?? "")
        .replace(/^!?\[\[/, "")
        .replace(/\]\]$/, "")
        .split("|")[0];
      const fmTitle = FetchModal.norm(rawTitle);
      const hit = base === target || fmTitle === target || (target.length > 3 && base.startsWith(target));
      if (!hit) continue;
      let score = base === target || fmTitle === target ? 0 : 50;
      if (root && f.path.startsWith(root + "/")) score -= 10;
      score += f.path.length / 100;
      cands.push({ file: f, score });
    }
    if (cands.length === 0) return null;
    cands.sort((a, b) => a.score - b.score);
    return cands[0].file;
  }

  private async createNote(meta: BookMeta, douban: DoubanLite | null): Promise<TFile> {
    const s = this.plugin.settings;
    const root = (s.folder || "Sources/Books").replace(/\/$/, "");
    const name = sanitizeName(meta.title || this.keyword) || t("未命名书籍");
    const dir = normalizePath(`${root}/${name}`);

    const folder = this.app.vault.getAbstractFileByPath(dir);
    if (!(folder instanceof TFolder)) await this.app.vault.createFolder(dir);

    let path = normalizePath(`${dir}/${name}.md`);
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${dir}/${name} ${i}.md`);
      i++;
    }

    const extraLines = (s.defaultFrontmatter ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes(":"));

    const text = buildBookNote(meta, douban, meta.title || this.keyword, {
      hasLocalCover: false,
      extraLines,
      typeValue: s.newNoteType,
      statusField: s.statusField,
      statusValue: "想读",
    });
    return this.app.vault.create(path, text);
  }

  private async apply(meta: BookMeta): Promise<TFile> {
    const s = this.plugin.settings;
    let isNew = this.isNew;

    let douban = null;
    if (this.useDouban || isNew) {
      this.setStatus(t("正在查豆瓣的 ISBN / 页数…"));
      try {
        douban = await fetchDouban(meta.title ?? this.keyword, meta.author);
      } catch {
        douban = null;
      }
    }
    if (isNew && !this.useDouban) {
      // 新建笔记要把豆瓣信息写进版面，即使没勾选也至少尝试一次
      douban = douban ?? null;
    }

    if (isNew) {
      const title = meta.title || this.keyword;
      const existing = this.findExisting(title);
      if (existing) {
        this.setStatus(t("库里已有这本书，改为补全现有笔记…"));
        this.file = existing;
        this.overwrite = true;
        isNew = false;
      } else {
        this.setStatus(t("正在创建笔记…"));
        this.file = await this.createNote(meta, douban);
      }
    }
    const file = this.file!;

    this.setStatus(t("正在写入属性…"));
    const overwrite = this.overwrite || isNew;

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const setIfEmpty = (key: string, value: any) => {
        if (value === undefined || value === null || value === "") return;
        const cur = fm[key];
        const empty =
          cur === undefined ||
          cur === null ||
          (typeof cur === "string" && cur.trim() === "") ||
          (Array.isArray(cur) && cur.length === 0);
        if (empty || overwrite) fm[key] = value;
      };

      // 不下载封面：直接用图片地址，渲染时走 requestUrl 绕防盗链
      if (meta.cover) fm[s.coverField || "cover"] = meta.cover;
      if (meta.title) fm.title = `[[${meta.title}]]`;
      if (meta.bookId) setIfEmpty("bookId", meta.bookId);
      if (meta.rating) setIfEmpty("wereadRating", meta.rating);
      if (meta.author) setIfEmpty(s.authorField || "author", [meta.author]);
      if (meta.publisher && !isNew) setIfEmpty("publisher", meta.publisher);
      if (meta.intro) setIfEmpty("desc", meta.intro);
      if (meta.isbn) setIfEmpty("isbn", meta.isbn);
      if (douban) {
        if (douban.isbn) setIfEmpty("isbn", douban.isbn);
        if (douban.pages) setIfEmpty("pages", douban.pages);
        if (douban.yearPublished) {
          const year = parseInt(douban.yearPublished.slice(0, 4), 10);
          if (!isNaN(year)) setIfEmpty("yearPublished", year);
        }
        if (douban.publisher) setIfEmpty("publisher", douban.publisher);
      }
      if (!fm[s.statusField || "readingStatus"]) {
        fm[s.statusField || "readingStatus"] = isNew ? "想读" : "在读";
      }
    });

    this.setStatus(t("完成"));
    return file;
  }
}
