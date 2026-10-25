import { BookMeta } from "./types";

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

export interface DoubanLite {
  isbn?: string;
  pages?: number;
  yearPublished?: string;
  publisher?: string;
  subjectId?: string;
  rating?: number;
  cover?: string;
}

export interface TemplateOpts {
  /** 本地封面相对路径（同目录 cover.jpg），没有则用网络地址 */
  hasLocalCover?: boolean;
  /** 额外属性行，如 "genre: non-fiction" */
  extraLines?: string[];
  /** 写入 type 字段的值，留空则不写 */
  typeValue?: string;
}

/** 生成新书籍笔记：bookinfo 卡片 + 简介 callout + 标准属性 */
export function buildBookNote(
  meta: BookMeta,
  douban: DoubanLite | null,
  title: string,
  opts: TemplateOpts = {}
): string {
  const cover = meta.cover || douban?.cover || "";
  const coverRef = opts.hasLocalCover ? "cover.jpg" : cover;
  const author = meta.author ? [meta.author] : [];
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
    ["author", ""]
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
    ["readingStatus", "想读"],
  ];

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
