import { Notice } from "obsidian";
import { t } from "./i18n";

export interface InlineOption {
  value: string;
  label: string;
}

export interface InlineEditConfig {
  kind: "date" | "select" | "text";
  value: string;
  options?: InlineOption[];
  placeholder?: string;
  ariaLabel?: string;
  onCommit: (value: string) => Promise<void>;
}

/** 把 frontmatter 里可能带时间的日期压成 yyyy-mm-dd，供 date input 使用 */
export function normalizeDateInput(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * 点一下单元格，把内容换成输入框/日期/下拉。
 * 成功后由调用方重新 render；这里只负责编辑和失败回滚。
 */
export function attachInlineEdit(cell: HTMLElement, cfg: InlineEditConfig): void {
  const originalNodes = Array.from(cell.childNodes).map((node) => node.cloneNode(true));
  cell.empty();
  cell.addClass("bs-cell-editing");
  let finished = false;

  const restore = () => {
    cell.empty();
    for (const node of originalNodes) cell.appendChild(node);
    cell.removeClass("bs-cell-editing");
  };

  const cancel = () => {
    if (finished) return;
    finished = true;
    restore();
  };

  const commit = async (value: string) => {
    if (finished) return;
    finished = true;
    try {
      await cfg.onCommit(value);
    } catch (err) {
      finished = false;
      restore();
      new Notice(t("保存失败"));
      console.error(err);
    }
  };

  if (cfg.kind === "select") {
    const select = cell.createEl("select", { cls: "bs-inline-editor" });
    select.ariaLabel = cfg.ariaLabel ?? t("点击编辑");
    const options = [...(cfg.options ?? [])];
    // 当前值不在设置里时也保留，避免一打开就把它冲掉
    if (cfg.value && !options.some((o) => o.value === cfg.value)) {
      options.unshift({ value: cfg.value, label: cfg.value });
    }
    for (const opt of [{ value: "", label: "—" }, ...options]) {
      const el = select.createEl("option", { text: opt.label });
      el.value = opt.value;
    }
    select.value = cfg.value;
    select.onchange = () => void commit(select.value);
    select.onblur = () => cancel();
    select.onclick = (e) => e.stopPropagation();
    select.focus();
    return;
  }

  const input = cell.createEl("input", {
    cls: "bs-inline-editor",
    type: cfg.kind === "date" ? "date" : "text",
  });
  input.value = cfg.kind === "date" ? normalizeDateInput(cfg.value) : cfg.value;
  input.placeholder = cfg.placeholder ?? "";
  input.ariaLabel = cfg.ariaLabel ?? t("点击编辑");
  input.onclick = (e) => e.stopPropagation();
  input.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void commit(input.value);
    }
  };
  input.onblur = () => void commit(input.value);
  if (cfg.kind === "date") {
    input.onchange = () => void commit(input.value);
  }
  input.focus();
  if (cfg.kind === "date") {
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    window.setTimeout(() => {
      try {
        picker.showPicker?.();
      } catch {
        // 浏览器不允许自动弹日历就退回手动点输入框
      }
    }, 0);
  }
}
