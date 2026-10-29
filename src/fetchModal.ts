import { App, Modal, Notice, TFile, TFolder, normalizePath } from "obsidian";
import type BookShelfPlugin from "./main";
import {
  fetchDouban,
  fetchDoubanById,
  fetchDoubanByIsbn,
  looksLikeIsbn,
  searchDouban,
  searchDoubanByIsbn,
  searchWeread,
} from "./sources";
import { coverFileNameFor, downloadImage } from "./sources";
import { BookMeta } from "./types";
import { buildBookNote, DoubanLite } from "./noteTemplate";
import type { DoubanMeta } from "./types";
import { asStr, getFm } from "./fm";
import { markdownIn } from "./vaultScope";
import { t } from "./i18n";
import { confirmDialog } from "./confirmModal";

function sanitizeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

type SourceKind = "weread" | "douban";

/** requestUrl 没有内置超时，超时就当这个源不可用，别让整次搜索卡住 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(t("请求超时"))),
      ms
    );
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
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
      text: this.isNew ? t("新建书籍") : t("补全书籍信息 · {name}", { name: this.file.basename }),
    });

    const row = contentEl.createDiv({ cls: "bs-modal-row" });
    const input = row.createEl("input", {
      type: "text",
      cls: "bs-modal-input",
      placeholder: t("书名或关键词"),
    });
    input.value = this.keyword;
    input.onkeydown = (e) => {
      if (e.key === "Enter") void this.runSearch();
    };
    this.searchBtn = row.createEl("button", { text: t("搜索"), cls: "mod-cta" });
    this.searchBtn.onclick = () => void this.runSearch();

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

    if (this.keyword) void this.runSearch();
  }

  onClose() {
    this.contentEl.empty();
  }

  private setStatus(text: string) {
    if (this.statusEl) this.statusEl.setText(text);
  }

  private sourceLabel(kind: SourceKind): string {
    return kind === "weread" ? t("微信读书") : t("豆瓣");
  }

  /** 多源并发搜索：每个源独立超时，一个挂了不影响其它 */
  async runSearch() {
    const kw = this.contentEl
      .querySelector<HTMLInputElement>(".bs-modal-input")
      ?.value?.trim();
    if (!kw) {
      this.setStatus(t("先输入书名"));
      return;
    }
    const s = this.plugin.settings;
    const tasks: { src: SourceKind; p: Promise<BookMeta[]> }[] = [];
    // 关键词是 ISBN 时豆瓣走精准查询：suggest 接口不认 ISBN，按书名搜会直接空。
    // 微信读书的搜索只认书名/作者，ISBN 查询返回 0 条，这里直接跳过省一次请求
    const byIsbn = looksLikeIsbn(kw);
    if (s.enableWeread && !byIsbn) tasks.push({ src: "weread", p: withTimeout(searchWeread(kw), 8000) });
    if (s.enableDouban) {
      tasks.push({
        src: "douban",
        p: withTimeout(byIsbn ? searchDoubanByIsbn(kw) : searchDouban(kw), 8000),
      });
    }
    if (tasks.length === 0) {
      this.setStatus(t("两个搜索源都关掉了，去设置里打开一个"));
      return;
    }

    this.keyword = kw;
    this.searchBtn.disabled = true;
    this.resultsEl.empty();
    this.setStatus(t("正在搜索…"));
    try {
      const settled = await Promise.allSettled(tasks.map((x) => x.p));
      const groups: { src: SourceKind; list: BookMeta[] }[] = [];
      const errors: string[] = [];
      settled.forEach((r, i) => {
        const src = tasks[i].src;
        if (r.status === "fulfilled") {
          groups.push({ src, list: r.value });
        } else {
          errors.push(`${this.sourceLabel(src)}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      });

      const merged = this.mergeResults(groups);
      if (merged.length === 0) {
        this.setStatus(
          errors.length > 0
            ? t("搜索失败：{msg}", { msg: errors.join("；") })
            : t("没有搜到结果，换个关键词试试")
        );
        return;
      }
      const counts = groups
        .map((g) => `${this.sourceLabel(g.src)} ${g.list.length}`)
        .join(" · ");
      this.setStatus(
        t("找到 {n} 条（{counts}），点击右侧「用这条」写入属性", {
          n: merged.length,
          counts,
        })
      );
      for (const item of merged) this.renderResult(item);
      if (errors.length > 0) {
        this.statusEl.createDiv({ cls: "bs-status-err", text: errors.join("；") });
      }
    } finally {
      this.searchBtn.disabled = false;
    }
  }

  /** 同名书合并成一条，先到的源（微信读书）优先，只补空缺字段 */
  private mergeResults(groups: { src: SourceKind; list: BookMeta[] }[]): BookMeta[] {
    const out: BookMeta[] = [];
    const index = new Map<string, BookMeta>();
    for (const g of groups) {
      for (const m of g.list) {
        const key = FetchModal.norm(m.title ?? "");
        if (!key) continue;
        const hit = index.get(key);
        if (!hit) {
          const copy: BookMeta = { ...m, sources: [...(m.sources ?? [g.src])] };
          index.set(key, copy);
          out.push(copy);
          continue;
        }
        const fill = <K extends keyof BookMeta>(k: K) => {
          if (!hit[k] && m[k]) hit[k] = m[k];
        };
        (
          [
            "author",
            "translator",
            "publisher",
            "cover",
            "intro",
            "rating",
            "isbn",
            "yearPublished",
            "sourceUrl",
            "bookId",
            "subjectId",
          ] as (keyof BookMeta)[]
        ).forEach((k) => fill(k));
        if (!hit.sources?.includes(g.src)) {
          hit.sources = [...(hit.sources ?? []), g.src];
        }
      }
    }
    return out;
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
    const srcs = meta.sources ?? (meta.origin ? [meta.origin] : []);
    if (srcs.length > 0) {
      const badge = info.createDiv({ cls: "bs-result-src" });
      for (const one of srcs) {
        badge.createSpan({ cls: `bs-src bs-src-${one}`, text: this.sourceLabel(one) });
      }
    }
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
      .replace(/[《》（）()【】[\]\s:：,，.。、\-_—!！?？'"“”]/g, "");
  }

  /**
   * 两条记录是不是同一本书：ISBN 或微信读书 bookId 任一相同就是同一本，
   * 任一不同就是不同的书，两者都没法比时算未知（当作同一本，保留旧行为）。
   */
  private static compareBookIds(
    curIsbn: string,
    curBookId: string,
    newIsbn: string,
    newBookId: string
  ): "same" | "diff" | "unknown" {
    if (curIsbn && newIsbn && curIsbn === newIsbn) return "same";
    if (curBookId && newBookId && curBookId === newBookId) return "same";
    if ((curIsbn && newIsbn) || (curBookId && newBookId)) return "diff";
    return "unknown";
  }

  /** 补全模式下的守卫：选中的结果不是这本书时先问一句 */
  private async ensureSameBook(
    file: TFile,
    meta: BookMeta,
    douban: DoubanMeta | null
  ): Promise<boolean> {
    const fm = getFm(this.app, file);
    const curIsbn = FetchModal.isbnKey(asStr(fm["isbn"]));
    const curBookId = asStr(fm["bookId"]).trim();
    const newIsbn = FetchModal.isbnKey(meta.isbn || douban?.isbn || "");
    const newBookId = (meta.bookId || "").trim();
    const rel = FetchModal.compareBookIds(curIsbn, curBookId, newIsbn, newBookId);
    if (rel !== "diff") return true;

    const curTitle = file.basename;
    const newTitle = meta.title || this.keyword;
    const ok = await confirmDialog(this.app, {
      title: t("这可能是另一本书"),
      lines: [
        t("当前笔记：《{cur}》（ISBN {isbn}）", { cur: curTitle, isbn: curIsbn || "—" }),
        t("你选中的：《{next}》（ISBN {isbn}）", { next: newTitle, isbn: newIsbn || "—" }),
        t("同一本书的不同译本、不同出版社版本，建议新建一篇笔记，覆盖会丢版本信息。"),
      ],
      okText: t("仍然覆盖"),
      cancelText: t("取消"),
    });
    if (ok) this.overwrite = true;
    return ok;
  }

  /** ISBN 归一化：去掉连字符和空格，大小写统一，只为比较 */
  private static isbnKey(raw: string): string {
    return (raw ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
  }

  /** 同名不同出版版本的笔记文件名后缀，优先用译者 */
  private static editionSuffix(translator: string, isbnKey: string): string {
    const tr = (translator ?? "").trim();
    if (tr) return `（${tr} 译）`;
    return `（${isbnKey}）`;
  }

  /** 这个书名已经被某个版本占了（包含已带后缀的本子），用于决定新笔记要不要加后缀 */
  private titleTakenByAnotherEdition(title: string): boolean {
    const raw = title.trim();
    if (!raw) return false;
    const root = (this.plugin.settings.folder || "").replace(/\/$/, "");
    for (const f of markdownIn(this.app, root)) {
      const base = f.basename.trim();
      // norm() 会把全角括号当成噪音去掉，所以这里比 raw 文件名
      if (base === raw || base.startsWith(`${raw}（`)) return true;
    }
    return false;
  }

  /** 库里已有同名书（或在书目录下已有同名子目录）时，返回那篇笔记 */
  private findExisting(title: string, isbnKey?: string, bookId?: string): TFile | null {
    const target = FetchModal.norm(title);
    if (!target) return null;
    const root = (this.plugin.settings.folder || "").replace(/\/$/, "");
    const cands: { file: TFile; score: number }[] = [];
    for (const f of markdownIn(this.app, root)) {
      const base = FetchModal.norm(f.basename);
      const fm = getFm(this.app, f);
      // 同名但 ISBN / bookId 对不上 → 是另一个译本或版本，不能当同一本书覆盖
      const rel = FetchModal.compareBookIds(
        FetchModal.isbnKey(asStr(fm["isbn"])),
        asStr(fm["bookId"]).trim(),
        isbnKey ?? "",
        bookId ?? ""
      );
      if (rel === "diff") continue;
      const rawTitle = asStr(fm["title"])
        .replace(/^!?\[\[/, "")
        .replace(/\]\]$/, "")
        .split("|")[0];
      const fmTitle = FetchModal.norm(rawTitle);
      const hit =
        base === target ||
        fmTitle === target ||
        (target.length > 3 && base.startsWith(target)) ||
        // 带后缀的版本：书名（译者 译）
        f.basename.trim().startsWith(`${title.trim()}（`);
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

  private async createNote(
    meta: BookMeta,
    douban: DoubanLite | null,
    nameOverride?: string
  ): Promise<TFile> {
    const s = this.plugin.settings;
    const root = (s.folder || "Sources/Books").replace(/\/$/, "");
    const name = sanitizeName(nameOverride || meta.title || this.keyword) || t("未命名书籍");
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

  /**
   * 把远程封面存成书籍同目录的 cover 系列文件，返回写下的文件名；失败返回 null（画面回落外链）。
   * 存本地以后拔网、微信读书把 cover 刷回外链都不影响封面显示。
   */
  private async downloadCover(file: TFile, url: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    const s = this.plugin.settings;
    const name = coverFileNameFor(url, s.coverFileName || "cover.jpg");
    const dir = file.parent?.path ?? "";
    const path = normalizePath(!dir || dir === "/" ? name : `${dir}/${name}`);
    try {
      const buf = await downloadImage(url);
      if (!buf || buf.byteLength === 0) return null;
      await this.app.vault.adapter.writeBinary(path, buf);
      return name;
    } catch {
      return null;
    }
  }

  private async apply(meta: BookMeta): Promise<TFile> {
    const s = this.plugin.settings;
    let isNew = this.isNew;

    // 笔记里已有 ISBN 时优先按 ISBN 精准查，比按书名模糊搜更能锁住版本
    const noteIsbn =
      !isNew && this.file
        ? FetchModal.isbnKey(asStr(getFm(this.app, this.file)["isbn"]))
        : "";
    const lookupIsbn = FetchModal.isbnKey(meta.isbn || "") || noteIsbn;

    let douban: DoubanMeta | null = null;
    // 豆瓣来的结果已经知道 subject id，直接抓详情页；其它来源先试 ISBN，再走关键词搜索
    if (this.useDouban || isNew || meta.origin === "douban" || meta.subjectId) {
      this.setStatus(t("正在查豆瓣的 ISBN / 页数…"));
      try {
        if (meta.subjectId) douban = await fetchDoubanById(meta.subjectId);
        else if (lookupIsbn) douban = await fetchDoubanByIsbn(lookupIsbn);
        if (!douban) {
          douban = await fetchDouban(meta.title ?? this.keyword, meta.author);
        }
      } catch {
        douban = null;
      }
    }

    if (isNew) {
      const title = meta.title || this.keyword;
      const isbnKey = FetchModal.isbnKey(meta.isbn || douban?.isbn || "");
      const bookId = (meta.bookId || "").trim();
      const existing = this.findExisting(title, isbnKey, bookId);
      if (existing) {
        this.setStatus(t("库里已有这本书，改为补全现有笔记…"));
        this.file = existing;
        this.overwrite = true;
        isNew = false;
      } else {
        // 同名笔记已存在但 ISBN 对不上 → 这是另一个译本/版本，文件名带上译者区分
        const translator = (meta.translator || douban?.translator || "").trim();
        const nameOverride =
          isbnKey && this.titleTakenByAnotherEdition(title)
            ? `${title}${FetchModal.editionSuffix(translator, isbnKey)}`
            : undefined;
        this.setStatus(t("正在创建笔记…"));
        this.file = await this.createNote(meta, douban, nameOverride);
      }
    } else if (this.file) {
      // 补全模式：得先确认选中的确实是同一本书，否则会把别人的书名/属性写进来
      const ok = await this.ensureSameBook(this.file, meta, douban);
      if (!ok) return this.file;
    }
    const file = this.file;

    // 封面先尝试存本地；失败保留外链，渲染时走 requestUrl 绕防盗链
    const remoteCover = meta.cover || "";
    let localCoverName: string | null = null;
    if (remoteCover && this.plugin.settings.downloadCover === true) {
      this.setStatus(t("正在下载封面…"));
      localCoverName = await this.downloadCover(file, remoteCover);
    }

    this.setStatus(t("正在写入属性…"));
    const overwrite = this.overwrite || isNew;

    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      const setIfEmpty = (key: string, value: unknown) => {
        if (value === undefined || value === null || value === "") return;
        const cur = fm[key];
        const empty =
          cur === undefined ||
          cur === null ||
          (typeof cur === "string" && cur.trim() === "") ||
          (Array.isArray(cur) && cur.length === 0);
        if (empty || overwrite) fm[key] = value;
      };

      // 封面优先落盘到本地；下载失败才用图片地址
      if (localCoverName) fm[s.coverField || "cover"] = localCoverName;
      else if (remoteCover) fm[s.coverField || "cover"] = remoteCover;
      // 书名只补空，不覆盖：补全模式下选错书时别把别人的书名写进来
      if (meta.title) setIfEmpty("title", `[[${meta.title}]]`);
      if (meta.bookId) setIfEmpty("bookId", meta.bookId);
      if (meta.rating) setIfEmpty("wereadRating", meta.rating);
      if (meta.author) setIfEmpty(s.authorField || "author", [meta.author]);
      // 译者单独存属性：同一本书的不同译本靠它区分，读者在意
      const translator = (meta.translator || douban?.translator || "").trim();
      if (translator) {
        const parts = translator
          .split(/\s*[/、]\s*/)
          .map((x) => x.trim())
          .filter(Boolean);
        setIfEmpty(s.translatorField || "translator", parts);
      }
      if (meta.publisher && !isNew) setIfEmpty("publisher", meta.publisher);
      if (meta.intro) setIfEmpty("desc", meta.intro);
      else if (douban?.desc) setIfEmpty("desc", douban.desc);
      if (douban?.rating) setIfEmpty("doubanRating", douban.rating);
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
