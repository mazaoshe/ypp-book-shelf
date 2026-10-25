import { App, TFile } from "obsidian";

/** frontmatter 统一按 Record<string, unknown> 处理，避免 any 一路传播 */
export type Fm = Record<string, unknown>;

/** 从 metadataCache 取 frontmatter；取不到或不是对象时返回空对象 */
export function getFm(app: App, file: TFile): Fm {
  const cache = app.metadataCache.getFileCache(file);
  const fm: unknown = cache?.frontmatter;
  if (fm && typeof fm === "object" && !Array.isArray(fm)) {
    return fm as Record<string, unknown>;
  }
  return {};
}

/** 任意 frontmatter 值转字符串：字符串 trim，数字/布尔转字符串，数组用 ", " 连接 */
export function asStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === "string"
          ? v.trim()
          : typeof v === "number"
            ? String(v)
            : ""
      )
      .filter((v) => v !== "")
      .join(", ");
  }
  return "";
}

export function fmStr(fm: Fm, key: string): string {
  return asStr(fm[key]);
}

/** 取数字字段；取不到或不是数字时用 fallback */
export function fmNum(fm: Fm, key: string, fallback: number): number {
  const v = fm[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
