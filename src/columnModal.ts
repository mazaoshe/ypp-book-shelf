import { App, Modal, Notice } from "obsidian";
import type BookShelfPlugin from "./main";
import {
  columnLabel,
  defaultColumns,
  isBuiltinKey,
  isLocked,
  propCol,
  type ColumnConfig,
} from "./columns";
import { t } from "./i18n";

/** 「列」设置弹窗：勾选显隐、改别名、排序、增删属性列 */
export class ColumnModal extends Modal {
  private plugin: BookShelfPlugin;
  private dragIdx: number | null = null;
  private dragEl: HTMLElement | null = null;

  constructor(app: App, plugin: BookShelfPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.renderList();
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderList() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("列表显示的列") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t("勾选要显示在书架表格里的列；属性列可以改别名、调顺序。"),
    });

    const cols = this.plugin.settings.columns;
    const list = contentEl.createDiv({ cls: "bs-col-list" });
    cols.forEach((col, idx) => this.renderRow(list, col, idx, cols.length));

    const addRow = contentEl.createDiv({ cls: "bs-col-add" });
    const input = addRow.createEl("input", {
      type: "text",
      cls: "bs-col-add-input",
      attr: { placeholder: t("例如 finishedDate") },
    });
    const add = addRow.createEl("button", {
      text: t("+ 添加属性列"),
      cls: "bs-btn",
    });
    const doAdd = () => {
      const key = input.value.trim().replace(/^:+/, "");
      if (!key) return;
      if (isBuiltinKey(key) || cols.some((c) => c.key === key)) {
        new Notice(t("该列已存在：{name}", { name: key }));
        return;
      }
      cols.push({ ...propCol(key), label: key });
      void this.plugin.saveSettings();
      this.renderList();
    };
    add.onclick = doAdd;
    input.onkeydown = (e) => {
      if (e.key === "Enter") doAdd();
    };

    const foot = contentEl.createDiv({ cls: "bs-modal-row" });
    const reset = foot.createEl("button", { text: t("恢复默认列") });
    reset.onclick = () => {
      this.plugin.settings.columns = defaultColumns();
      void this.plugin.saveSettings();
      this.renderList();
    };
    const close = foot.createEl("button", {
      text: t("完成"),
      cls: "mod-cta",
    });
    close.onclick = () => this.close();
  }

  private renderRow(
    list: HTMLElement,
    col: ColumnConfig,
    idx: number,
    total: number
  ) {
    const row = list.createDiv({ cls: "bs-col-row" });
    if (col.kind === "builtin") row.addClass("bs-col-row-builtin");

    const handle = row.createSpan({
      cls: "bs-col-drag",
      text: "⠿",
      attr: { title: t("拖拽调整顺序") },
    });
    handle.draggable = true;
    handle.ondragstart = (e) => {
      this.dragIdx = idx;
      this.dragEl = row;
      row.addClass("is-dragging");
      e.dataTransfer?.setData("text/plain", String(idx));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    handle.ondragend = () => {
      this.dragIdx = null;
      this.dragEl?.removeClass("is-dragging");
      this.dragEl = null;
      list.findAll(".is-drop-target").forEach((n) => n.removeClass("is-drop-target"));
    };
    row.ondragover = (e) => {
      if (this.dragIdx === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      row.addClass("is-drop-target");
    };
    row.ondragleave = () => row.removeClass("is-drop-target");
    row.ondrop = (e) => {
      e.preventDefault();
      row.removeClass("is-drop-target");
      if (this.dragIdx === null || this.dragIdx === idx) return;
      this.moveTo(this.dragIdx, idx);
    };

    const locked = isLocked(col);
    const check = row.createEl("input", { type: "checkbox" });
    check.checked = locked ? true : col.visible;
    check.disabled = locked;
    check.onchange = () => {
      col.visible = check.checked;
      void this.plugin.saveSettings();
      if (locked) return;
      // 关闭当前排序用的列时，排序回落最近修改
      if (
        !col.visible &&
        (this.plugin.settings.sortMode === col.key ||
          this.plugin.settings.sortMode === `prop:${col.key}`)
      ) {
        this.plugin.settings.sortMode = "mtime";
      }
    };

    const label = row.createEl("input", {
      type: "text",
      cls: "bs-col-label-input",
      attr: { placeholder: columnLabel(col) },
    });
    label.value = col.label ?? "";
    const persistLabel = () => {
      const v = label.value.trim();
      col.label = v || undefined;
      label.placeholder = columnLabel(col);
      void this.plugin.saveSettings();
    };
    label.onblur = persistLabel;
    label.onkeydown = (e) => {
      if (e.key === "Enter") {
        persistLabel();
        label.blur();
      }
    };

    const key = row.createSpan({ cls: "bs-col-key" });
    key.setText(col.key);
    key.title = col.kind === "prop" ? t("frontmatter 里的属性名") : t("内置列");

    const up = row.createEl("button", { text: "↑", cls: "bs-col-icon" });
    up.title = t("上移");
    up.disabled = idx === 0;
    up.onclick = () => this.moveTo(idx, idx - 1);

    const down = row.createEl("button", { text: "↓", cls: "bs-col-icon" });
    down.title = t("下移");
    down.disabled = idx === total - 1;
    down.onclick = () => this.moveTo(idx, idx + 1);

    if (col.kind === "prop") {
      const del = row.createEl("button", { text: "×", cls: "bs-col-icon" });
      del.title = t("删除这一列");
      del.onclick = () => {
        this.plugin.settings.columns = this.plugin.settings.columns.filter(
          (c) => c !== col
        );
        void this.plugin.saveSettings();
        this.renderList();
      };
    } else {
      row.createSpan({ cls: "bs-col-icon bs-col-icon-placeholder" });
    }
  }

  private moveTo(from: number, to: number) {
    const cols = this.plugin.settings.columns;
    if (from === to || from < 0 || from >= cols.length) return;
    if (to < 0 || to >= cols.length) return;
    const [item] = cols.splice(from, 1);
    cols.splice(to, 0, item);
    void this.plugin.saveSettings();
    this.renderList();
  }
}
