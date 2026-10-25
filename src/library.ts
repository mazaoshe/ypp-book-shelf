import { App, normalizePath } from "obsidian";
import { BookItem } from "./types";
import type { BookShelfSettings } from "./settings";

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
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return STATUS_ALIASES[s] ?? s;
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
  const folder = (s.folder || "").replace(/\/$/, "");
  const files = app.vault
    .getMarkdownFiles()
    .filter((f) => (folder ? f.path.startsWith(folder + "/") : true));

  const items: BookItem[] = [];
  for (const file of files) {
    const fm =
      app.metadataCache.getFileCache(file)?.frontmatter ?? ({} as any);
    if (s.typeValue) {
      const wanted = s.typeValue
        .split(/[,，、\s]+/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (wanted.length > 0) {
        const v = String(fm[s.typeField || "type"] ?? "");
        if (!wanted.includes(v)) continue;
      }
    }
    if (String(fm.type ?? "") === "moc") continue;
    const rawCover = fm[s.coverField || "cover"];
    let cover = "";
    if (typeof rawCover === "string" && rawCover.trim()) cover = rawCover.trim();
    else if (Array.isArray(rawCover) && rawCover.length) cover = String(rawCover[0]);

    let author = fm[s.authorField || "author"];
    if (Array.isArray(author)) author = author.join(" / ");
    if (author && String(author).startsWith("[[")) {
      author = String(author).replace(/\[\[|\]\]/g, "");
    }

    const status = normalizeStatus(fm[s.statusField || "readingStatus"]);

    items.push({
      file,
      frontmatter: fm,
      title: file.basename,
      author: author ? String(author) : "",
      cover: cover ? String(cover) : "",
      status: status ? String(status) : "",
    });
  }
  return dedupe(items, folder);
}

