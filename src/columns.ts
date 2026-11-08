import type { BookItem } from "./types";
import { asStr } from "./fm";
import { t } from "./i18n";

/** 代码算出来的列，不能删，只能改名/关掉/移动 */
export type BuiltinColumnKey =
  | "cover"
  | "title"
  | "author"
  | "translator"
  | "publisher"
  | "rating"
  | "pages"
  | "status"
  | "words"
  | "desc";

export const BUILTIN_COLUMNS: BuiltinColumnKey[] = [
  "cover",
  "title",
  "author",
  "translator",
  "publisher",
  "rating",
  "pages",
  "status",
  "words",
  "desc",
];

/** 列名（中文原文即 i18n key） */
export const BUILTIN_LABELS: Record<BuiltinColumnKey, string> = {
  cover: "封面",
  title: "书名",
  author: "作者",
  translator: "译者",
  publisher: "出版社",
  rating: "评分",
  pages: "页数",
  status: "状态",
  words: "字数",
  desc: "简介",
};

/** 可以点表头排序的内置列（字数要读正文，不进排序） */
const SORTABLE_BUILTIN: BuiltinColumnKey[] = [
  "title",
  "author",
  "translator",
  "publisher",
  "rating",
  "pages",
  "status",
];

/**
 * 一列 = 一条配置。builtin 的 key 是内置列名，prop 的 key 是 frontmatter 字段名。
 * label 留空时用内置列名或属性名。
 */
export interface ColumnConfig {
  kind: "builtin" | "prop";
  key: string;
  label?: string;
  visible: boolean;
}

export function isBuiltinKey(key: string): key is BuiltinColumnKey {
  return (BUILTIN_COLUMNS as string[]).includes(key);
}

export function builtinCol(key: BuiltinColumnKey, visible = true): ColumnConfig {
  return { kind: "builtin", key, visible };
}

export function propCol(key: string, label?: string): ColumnConfig {
  return { kind: "prop", key, label, visible: true };
}

/** 默认列：内置 10 列 + 读完日期 / 阅读途径两个属性列 */
export function defaultColumns(): ColumnConfig[] {
  return [
    builtinCol("cover"),
    builtinCol("title"),
    builtinCol("author"),
    builtinCol("translator"),
    builtinCol("publisher"),
    builtinCol("rating"),
    builtinCol("pages"),
    builtinCol("status"),
    propCol("finishedDate", "读完日期"),
    propCol("readingSource", "阅读途径"),
    builtinCol("words"),
    builtinCol("desc"),
  ];
}

/** 书名列是打开笔记的唯一入口，永远保留 */
export function isLocked(col: ColumnConfig): boolean {
  return col.kind === "builtin" && col.key === "title";
}

export function isSortable(col: ColumnConfig): boolean {
  if (col.kind === "prop") return true;
  return isBuiltinKey(col.key) && SORTABLE_BUILTIN.includes(col.key);
}

/** 数字和状态默认倒序，其余正序；日期类属性列也默认倒序 */
export function defaultDesc(col: ColumnConfig): boolean {
  if (col.kind === "prop") return /date|time/i.test(col.key);
  return ["rating", "pages", "status"].includes(col.key);
}

export function columnLabel(col: ColumnConfig): string {
  const alias = (col.label ?? "").trim();
  if (alias) return t(alias);
  if (col.kind === "builtin" && isBuiltinKey(col.key)) {
    return t(BUILTIN_LABELS[col.key]);
  }
  return t(col.key);
}

/** 属性列的值：frontmatter 里的原文；读书日期/途径用 BookItem 里算好的值 */
export function propValue(book: BookItem, key: string): string {
  if (key === "finishedDate") return book.finishedDate;
  if (key === "readingSource") return book.source;
  return asStr(book.frontmatter[key]);
}

/** 排序键：属性列直接取原值，内置列用 BookItem 里算好的字段 */
export function sortValue(book: BookItem, col: ColumnConfig): string {
  if (col.kind === "prop") return propValue(book, col.key);
  switch (col.key as BuiltinColumnKey) {
    case "title":
      return book.title;
    case "author":
      return book.author;
    case "translator":
      return book.translator;
    case "publisher":
      return book.publisher;
    case "rating":
      return book.score;
    case "pages":
      return book.pages ? String(book.pages) : "";
    case "status":
      return book.status;
    case "desc":
      return book.desc;
    default:
      return "";
  }
}

/** 属性列的排序键带前缀，避免和内置列重名 */
export function sortModeFor(col: ColumnConfig): string {
  return col.kind === "prop" ? `prop:${col.key}` : col.key;
}

export function parseSortMode(
  mode: string
): { kind: "builtin" | "prop"; key: string } | null {
  if (mode.startsWith("prop:")) return { kind: "prop", key: mode.slice(5) };
  return isBuiltinKey(mode) ? { kind: "builtin", key: mode } : null;
}

/**
 * 清洗设置里读出来的列配置：丢掉无效项、去重、补回书名列。
 * 传进来的不是数组时回落到默认列。
 */
export function normalizeColumns(raw: unknown): ColumnConfig[] {
  if (!Array.isArray(raw)) return defaultColumns();
  const out: ColumnConfig[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind === "prop" ? "prop" : rec.kind === "builtin" ? "builtin" : null;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (!kind || !key) continue;
    if (kind === "builtin" && !isBuiltinKey(key)) continue;
    const id = `${kind}:${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      kind,
      key,
      label: typeof rec.label === "string" ? rec.label.trim() : "",
      visible: rec.visible !== false,
    });
  }
  if (!out.some((c) => c.kind === "builtin" && c.key === "title")) {
    out.splice(Math.min(1, out.length), 0, builtinCol("title"));
  }
  return out.length ? out : defaultColumns();
}
