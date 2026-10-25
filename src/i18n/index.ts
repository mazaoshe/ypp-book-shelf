import { EN } from "./en";

export type Lang = "zh" | "en";

let cached: Lang | null = null;

/** 跟随 Obsidian 的语言设置（默认跟随系统），拿不到就看系统语言 */
export function currentLang(): Lang {
  if (cached) return cached;
  let raw = "";
  try {
    raw = (window.localStorage.getItem("language") || "").trim();
  } catch {
    raw = "";
  }
  if (!raw) raw = navigator.language || "zh";
  raw = raw.toLowerCase();
  cached = raw.startsWith("zh") ? "zh" : "en";
  return cached;
}

/**
 * 取文案：中文原文当 key，英文查表，查不到回退中文。
 * 用法：t("共 {n} 本", { n: 12 })
 */
export function t(zh: string, vars?: Record<string, string | number>): string {
  const table = currentLang() === "en" ? EN : null;
  let s = (table && table[zh]) || zh;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** 语言相关的小工具：列表分隔符 */
export function listSep(): string {
  return currentLang() === "en" ? ", " : "、";
}
