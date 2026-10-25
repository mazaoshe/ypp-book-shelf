import { App, TFile, TFolder } from "obsidian";

/**
 * 只在指定目录里找文件，不去枚举整个库。
 * 目录留空时退回库根目录（等同以前的“全库”，但依然从 children 逐层走）。
 */
export function resolveFolder(app: App, dir: string): TFolder | null {
  const path = (dir || "").replace(/\/$/, "");
  if (!path) return app.vault.getRoot();
  const target = app.vault.getAbstractFileByPath(path);
  return target instanceof TFolder ? target : null;
}

function walk(folder: TFolder, visit: (file: TFile) => void) {
  for (const child of folder.children) {
    if (child instanceof TFolder) walk(child, visit);
    else if (child instanceof TFile) visit(child);
  }
}

/** 目录下所有 Markdown 笔记（递归） */
export function markdownIn(app: App, dir: string): TFile[] {
  const root = resolveFolder(app, dir);
  if (!root) return [];
  const out: TFile[] = [];
  walk(root, (f) => {
    if (f.extension === "md") out.push(f);
  });
  return out;
}

/** 目录下所有文件（递归，含图片） */
export function filesIn(app: App, dir: string): TFile[] {
  const root = resolveFolder(app, dir);
  if (!root) return [];
  const out: TFile[] = [];
  walk(root, (f) => out.push(f));
  return out;
}

/** 直接子文件（不递归） */
export function childFiles(folder: TFolder): TFile[] {
  return folder.children.filter((c): c is TFile => c instanceof TFile);
}

/** 库内所有目录路径，供目录输入框补全用 */
export function folderPaths(app: App): string[] {
  const out: string[] = [];
  const walkFolder = (f: TFolder) => {
    if (f.path && f.path !== "/") out.push(f.path);
    for (const child of f.children) {
      if (child instanceof TFolder) walkFolder(child);
    }
  };
  walkFolder(app.vault.getRoot());
  return out;
}
