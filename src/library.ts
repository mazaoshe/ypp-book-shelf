import { App, TFile, normalizePath } from "obsidian";
import { BookItem, MissingKey } from "./types";
import { asStr, fmNum, getFm } from "./fm";
import type { BookShelfSettings } from "./settings";
import { markdownIn } from "./vaultScope";

export const STATUS_ALIASES: Record<string, string> = {
  在读: "在读",
  在读中: "在读",
  阅读中: "在读",
  想读: "想读",
  待读: "想读",
  未读: "想读",
  读完: "读完",
  读过: "读完",
  已读: "读完",
  弃读: "弃读",
  放弃: "弃读",
};

export function normalizeStatus(raw: unknown): string {
  // 数组状态沿用旧的 join(",") 语义，避免筛选时的字符串比较变化
  const s = Array.isArray(raw) ? raw.map((v) => asStr(v)).filter(Boolean).join(",") : asStr(raw);
  if (!s) return "";
  return STATUS_ALIASES[s] ?? s;
}

/** 同目录下是否有本地封面文件（cover.jpg / png / jpeg / webp） */
function hasLocalCover(app: App, file: TFile, s: BookShelfSettings): boolean {
  if (!file.parent) return false;
  const base = s.coverFileName || "cover.jpg";
  const stem = base.replace(/\.[^.]+$/, "");
  const names = [base, `${stem}.png`, `${stem}.jpeg`, `${stem}.webp`];
  const dir = file.parent.path;
  for (const n of names) {
    const p = dir === "/" ? n : `${dir}/${n}`;
    if (app.vault.getAbstractFileByPath(normalizePath(p)) instanceof TFile) return true;
  }
  return false;
}

/** 封面字段到底有没有东西：本地文件、远程链接、库内路径都算有 */
function coverExists(
  app: App,
  file: TFile,
  s: BookShelfSettings,
  raw: string
): boolean {
  if (hasLocalCover(app, file, s)) return true;
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  const clean = raw.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
  if (!clean) return false;
  const candidates = [clean];
  if (file.parent && file.parent.path !== "/") {
    candidates.push(`${file.parent.path}/${clean}`);
  }
  return candidates.some(
    (c) => app.vault.getAbstractFileByPath(normalizePath(c)) instanceof TFile
  );
}

/** 分类字段：数组/字符串都认，微信读书的「个人成长-励志成长」取「-」前的大类（跟统计雷达一致） */
function parseCategories(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map((v) => asStr(v)) : [asStr(raw)];
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    for (const g of p.split(/[,，、;；]+/)) {
      const k = g.split("-")[0].trim();
      if (k && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** 去掉 YAML frontmatter，只留正文 */
function stripFrontmatter(text: string): string {
  if (!/^---\r?\n/.test(text)) return text;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return text;
  const rest = text.slice(end + 4);
  const nl = rest.indexOf("\n");
  return nl < 0 ? "" : rest.slice(nl + 1);
}

/**
 * 正文字数：中文按字，英文/数字按词。
 * 排除：frontmatter、`> [!bookinfo]`（书籍信息/封面）、`> [!abstract]`（内容简介）、
 * Markdown 表格行、图片行、链接里的 URL。剩下的才是「笔记」本身。
 */
export function countWords(text: string): number {
  const kept: string[] = [];
  let skipCallout = false;
  for (const line of stripFrontmatter(text).split("\n")) {
    if (/^\s{0,3}>/.test(line)) {
      const head = /^\s{0,3}>\s*\[!([\w-]+)/.exec(line);
      if (head) {
        const type = head[1].toLowerCase();
        skipCallout = type === "bookinfo" || type === "abstract";
        continue;
      }
      if (skipCallout) continue;
      kept.push(line.replace(/^\s{0,3}>\s?/, ""));
      continue;
    }
    skipCallout = false;
    // 书籍信息表格（常被写在 callout 外面）、图片、分隔线都不算字
    if (/^\s*\|/.test(line) || /^\s*!\[/.test(line) || /^\s*-{3,}\s*$/.test(line)) {
      continue;
    }
    kept.push(line);
  }
  const plain = kept.join("\n").replace(/\(\s*https?:\/\/[^)]*\)/g, " ");
  const cjk = (plain.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length;
  const words = (plain.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + words;
}

function dedupe(items: BookItem[], root: string): BookItem[] {
  const groups = new Map<string, BookItem[]>();
  const out: BookItem[] = [];
  for (const it of items) {
    const parent = it.file.parent?.path ?? "";
    if (parent === root || parent === "/") {
      out.push(it);
      continue;
    }
    const arr = groups.get(parent) ?? [];
    arr.push(it);
    groups.set(parent, arr);
  }
  const score = (it: BookItem) => {
    const name = it.file.basename;
    const folder = it.file.parent?.name ?? "";
    let s = name.length;
    if (it.frontmatter["shelfPrimary"] === true || it.frontmatter["shelfPrimary"] === "true") s -= 2000;
    if (name === folder) s -= 1000;
    if (/-豆瓣|-CB_|-Z_Library|Z-Library/i.test(name)) s += 100;
    return s;
  };
  for (const arr of groups.values()) {
    arr.sort((a, b) => score(a) - score(b));
    out.push(arr[0]);
  }
  return out;
}


export function collectBooks(app: App, s: BookShelfSettings) {
  const files = markdownIn(app, s.folder || "");

  const items: BookItem[] = [];
  for (const file of files) {
    const fm = getFm(app, file);
    if (s.typeValue) {
      const wanted = s.typeValue
        .split(/[,，、\s]+/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (wanted.length > 0) {
        const v = asStr(fm[s.typeField || "type"]);
        if (!wanted.includes(v)) continue;
      }
    }
    if (asStr(fm["type"]) === "moc") continue;
    const rawCover = fm[s.coverField || "cover"];
    let cover = "";
    if (typeof rawCover === "string" && rawCover.trim()) cover = rawCover.trim();
    else if (Array.isArray(rawCover) && rawCover.length) cover = asStr(rawCover[0]);

    const rawAuthor = fm[s.authorField || "author"];
    let author = Array.isArray(rawAuthor)
      ? rawAuthor.map((v) => asStr(v)).filter(Boolean).join(" / ")
      : asStr(rawAuthor);
    if (author.startsWith("[[")) {
      author = author.replace(/\[\[|\]\]/g, "");
    }

    const rawTranslator = fm[s.translatorField || "translator"];
    let translator = Array.isArray(rawTranslator)
      ? rawTranslator.map((v) => asStr(v)).filter(Boolean).join(" / ")
      : asStr(rawTranslator);
    if (translator.startsWith("[[")) {
      translator = translator.replace(/\[\[|\]\]/g, "");
    }

    const status = normalizeStatus(fm[s.statusField || "readingStatus"]);

    const isbn = asStr(fm["isbn"]);
    const pages = fmNum(fm, "pages", 0);
    const publisher = asStr(fm["publisher"]);
    // 豆瓣详情页的评分优先；微信读书的 wereadRating 形如「89.0%16921人」，只留百分比，不留人数
    const score = (asStr(fm["doubanRating"]) || asStr(fm["wereadRating"]))
      .replace(/\d+\s*人\s*$/, "")
      .trim();
    const desc = asStr(fm["desc"]);
    const categories = parseCategories(fm["category"] ?? fm["genre"]);

    const missing: MissingKey[] = [];
    if (!coverExists(app, file, s, cover)) missing.push("cover");
    if (!author) missing.push("author");
    const isWeread = asStr(fm["doc_type"]).startsWith("weread");
    if (s.requireDesc && !isWeread && !desc) missing.push("desc");

    items.push({
      file,
      frontmatter: fm,
      title: file.basename,
      author,
      translator,
      publisher,
      cover,
      status,
      isbn,
      pages,
      score,
      desc,
      categories,
      missing,
    });
  }
  return dedupe(items, (s.folder || "").replace(/\/$/, ""));
}

