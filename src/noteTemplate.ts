import { BookMeta } from "./types";

function yamlStr(s: string): string {
  if (!/[:#"{}&*!|>'"%@`[\]]|^- |^\d+:/.test(s)) return s;
  return JSON.stringify(s);
}

function quoteLines(s: string): string {
  return s
    .split("\n")
    .map((l) => (l.trim() ? `> ${l}` : ">"))
    .join("\n");
}

export interface DoubanLite {
  isbn?: string;
  pages?: number;
  yearPublished?: string;
  publisher?: string;
  translator?: string;
  subjectId?: string;
  rating?: string;
  cover?: string;
}

export interface TemplateOpts {
  /** 本地封面相对路径（同目录 cover.jpg），没有则用网络地址 */
  hasLocalCover?: boolean;
  /** 额外属性行，如 "genre: non-fiction" */
  extraLines?: string[];
  /** 写入 type 字段的值，留空则不写 */
  typeValue?: string;
  /** 阅读状态字段名，如 readingStatus；留空则不写 */
  statusField?: string;
  /** 新建时的初始状态值，如 想读 */
  statusValue?: string;
}

/** Values actually retained in frontmatter after completion, not raw search results. */
export interface BookInfoPatch {
  isbn?: string;
  author?: string;
  translator?: string;
  year?: string;
  publisher?: string;
  title?: string;
  subjectId?: string;
  rating?: string;
  cover?: string;
  intro?: string;
}

/** Update only the existing generated card. Never create a layout in old notes. */
export function patchBookInfo(text: string, info: BookInfoPatch): string {
  const lines = text.split("\n");
  const plain = (line: string) => line.replace(/\r$/, "");
  const quoted = (line: string) => /^ {0,3}>/.test(line);
  const callout = (line: string) => /^ {0,3}>\s*\[!/.test(plain(line));
  let fence = "";
  let fenceSize = 0;
  let frontmatter = plain(lines[0] ?? "").replace(/^\uFEFF/, "") === "---";
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = plain(lines[i]);
    if (frontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
      continue;
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) {
        fence = marker[1][0];
        fenceSize = marker[1].length;
      } else if (marker[1][0] === fence && marker[1].length >= fenceSize && /^\s*$/.test(line.slice(marker[0].length))) {
        fence = "";
      }
      continue;
    }
    if (!fence && /^ {0,3}>\s*\[!bookinfo\](?:[+-])?(?:\s|$)/i.test(line)) {
      start = i;
      break;
    }
  }
  if (start < 0) return text;

  let end = start + 1;
  while (end < lines.length && quoted(lines[end]) && !callout(lines[end])) end++;
  // Older buildBookNote versions put the generated table immediately outside >.
  let table = end;
  while (table < lines.length && !plain(lines[table]).trim()) table++;
  if (/^\|\s*属性\s*\|\s*内容\s*\|\s*$/.test(plain(lines[table] ?? ""))) {
    end = table;
    while (end < lines.length && /^\|/.test(lines[end])) end++;
  }

  const cell = (value: string) => value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  const title = (info.title || "书籍").replace(/[\\[\]]/g, "\\$&");
  const source = info.subjectId && /^\d+$/.test(info.subjectId)
    ? `[${title}](https://book.douban.com/subject/${info.subjectId}/)`
    : "";
  const values: Record<string, string | undefined> = {
    ISBN: info.isbn,
    作者: info.author ? `- ${info.author}` : "",
    译者: info.translator ? `- ${info.translator}` : "",
    出版年: info.year,
    出版社: info.publisher,
    来源: source,
    评分: info.rating,
  };
  let coverDone = false;
  let codeFence = "";
  for (let i = start + 1; i < end; i++) {
    const line = plain(lines[i]);
    const suffix = lines[i].endsWith("\r") ? "\r" : "";
    const content = line.replace(/^ {0,3}> ?/, "");
    const marker = content.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!codeFence) codeFence = marker[1];
      else if (marker[1][0] === codeFence[0] && marker[1].length >= codeFence.length && /^\s*$/.test(content.slice(marker[0].length))) codeFence = "";
      continue;
    }
    if (codeFence) continue;
    const row = line.match(/^((?: {0,3}> ?)?\|[ \t]*(ISBN|作者|译者|出版年|出版社|来源|评分)[ \t]*\|[ \t]*)(.*?)([ \t]*\|[ \t]*)$/);
    const value = row && values[row[2]];
    if (row && value?.trim()) lines[i] = `${row[1]}${cell(value)}${row[4]}${suffix}`;
    const image = line.match(/^( {0,3}>\s*!\[bookcover(?:\|[^\]]*)?\]\()(.*)(\)[ \t]*)$/);
    if (!coverDone && image && info.cover?.trim()) {
      let ref = info.cover.trim().replace(/[\r\n]/g, "");
      if (/[\s()<>]/.test(ref)) ref = `<${ref.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
      lines[i] = `${image[1]}${ref}${image[3]}${suffix}`;
      coverDone = true;
    }
  }

  // Only the adjacent generated description belongs to this card, not later notes.
  let abstract = end;
  while (abstract < lines.length && !plain(lines[abstract]).trim()) abstract++;
  if (info.intro?.trim() && /^ {0,3}>\s*\[!abstract\](?:[+-])?(?:\s|$)/i.test(plain(lines[abstract] ?? ""))) {
    let after = abstract + 1;
    while (after < lines.length && quoted(lines[after]) && !callout(lines[after])) after++;
    const existing = lines.slice(abstract + 1, after)
      .map((line) => plain(line).replace(/^ {0,3}> ?/, "")).join("\n").trim();
    if (!existing || existing === "（暂无简介）") {
      const prefix = plain(lines[abstract]).match(/^( {0,3}> ?)/)?.[1] ?? "> ";
      const cr = lines[abstract].endsWith("\r") ? "\r" : "";
      const intro = info.intro.trim().split(/\r?\n/).map((line) => `${prefix}${line}${cr}`);
      lines.splice(abstract + 1, after - abstract - 1, ...intro);
    }
  }
  return lines.join("\n");
}

/** 生成新书籍笔记：bookinfo 卡片 + 简介 callout + 标准属性 */
export function buildBookNote(
  meta: BookMeta,
  douban: DoubanLite | null,
  title: string,
  opts: TemplateOpts = {}
): string {
  const cover = meta.cover || douban?.cover || "";
  const coverRef = opts.hasLocalCover || !cover ? "cover.jpg" : cover;
  const author = meta.author ? [meta.author] : [];
  // 译者可能多人合译，豆瓣/微信读书都用 / 分隔，拆成数组存
  const translatorRaw = (meta.translator || douban?.translator || "").trim();
  const translators = translatorRaw
    ? translatorRaw
        .split(/\s*[/、]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const isbn = meta.isbn || douban?.isbn || "";
  const year = douban?.yearPublished
    ? String(parseInt(String(douban.yearPublished).slice(0, 4), 10) || "")
    : "";
  const desc = (meta.intro || "").replace(/\s+/g, " ").trim();

  const typeValue = (opts.typeValue ?? "").trim();
  const rows: [string, string][] = [];
  if (typeValue) rows.push(["type", yamlStr(typeValue)]);
  rows.push(
    ["title", `"[[${title}]]"`],
    ["tags", ""],
    ["cover", cover ? yamlStr(cover) : ""],
    ["author", ""],
    ["translator", ""]
  );
  const rest: [string, string][] = [
    ["isbn", isbn],
    ["pages", douban?.pages ? String(douban.pages) : ""],
    ["yearPublished", year],
    ["desc", desc ? yamlStr(desc) : ""],
    ["rating", ""],
    ["myRating", ""],
    ["readDate", ""],
    ["genre", ""],
  ];
  const statusField = (opts.statusField || "").trim();
  if (statusField) rest.push([statusField, opts.statusValue || "想读"]);

  const extra = (opts.extraLines ?? []).filter(
    (l) => l && ![...rows, ...rest].some(([k]) => l.startsWith(`${k}:`))
  );

  const lines: string[] = ["---"];
  for (const [k, v] of [...rows, ...rest]) {
    if (k === "author") {
      lines.push("author:");
      for (const a of author) lines.push(`  - ${yamlStr(a)}`);
      continue;
    }
    if (k === "translator") {
      // 没译者时不写这个键，避免每本书都留一行空 translator:
      if (translators.length === 0) continue;
      lines.push("translator:");
      for (const a of translators) lines.push(`  - ${yamlStr(a)}`);
      continue;
    }
    lines.push(v === "" ? `${k}:` : `${k}: ${v}`);
  }
  lines.push(...extra, "---", "");

  const source = douban?.subjectId
    ? `[${title}](https://book.douban.com/subject/${douban.subjectId}/)`
    : "";
  const row = (k: string, v: string) => `| ${k} | ${v} |`;

  const body = [
    `> [!bookinfo]+ **《${title}》**`,
    `> ![bookcover|200](${coverRef})`,
    ">",
    "| 属性   | 内容 |",
    "|:------ |:------------------------------------------ |",
    row("ISBN   ", isbn),
    row("作者   ", author.length ? `- ${author.join(" / ")}` : ""),
    row("译者   ", translators.length ? `- ${translators.join(" / ")}` : ""),
    row("出版年 ", year),
    row("出版社 ", douban?.publisher || ""),
    row("来源   ", source),
    row("评分   ", douban?.rating ? String(douban.rating) : ""),
    "",
    "> [!abstract]- **内容简介**",
    quoteLines(desc || "（暂无简介）"),
    "",
  ];

  return `${lines.join("\n")}${body.join("\n")}`;
}
