import { App, Modal, Notice, TFile, TFolder } from "obsidian";
import { t } from "./i18n";

export class DeleteBookModal extends Modal {
  private file: TFile;
  private onDeleted: () => void;
  private withFolder: boolean;
  private folderHasOnlyThis: boolean;

  constructor(app: App, file: TFile, onDeleted: () => void) {
    super(app);
    this.file = file;
    this.onDeleted = onDeleted;

    const parent = file.parent;
    const mdInFolder =
      parent?.children?.filter((c) => c instanceof TFile && c.extension === "md")
        .length ?? 0;
    this.folderHasOnlyThis = mdInFolder <= 1;
    // 目录里只有这一本书时，默认连目录一起删
    this.withFolder = this.folderHasOnlyThis && parent?.path !== "/";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("删除《{name}》", { name: this.file.basename }) });
    contentEl.createEl("p", {
      text: t("会移到系统废纸篓（Obsidian 的删除设置决定是否永久删除），可以从废纸篓找回。"),
    });

    const parentPath = this.file.parent?.path ?? "";
    const label = contentEl.createEl("label", { cls: "bs-modal-opts" });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = this.withFolder;
    cb.onchange = () => (this.withFolder = cb.checked);
    label.appendText(t(" 连同目录 {dir}/ 一起删除（含封面图片和同目录其他副本）", { dir: parentPath }));

    if (!this.folderHasOnlyThis) {
      contentEl.createEl("p", {
        text: t("注意：这个目录里还有其他笔记，勾选会一起删掉。"),
        cls: "bs-modal-status",
      });
    }

    const row = contentEl.createDiv({ cls: "bs-modal-row" });
    const cancel = row.createEl("button", { text: t("取消") });
    cancel.onclick = () => this.close();
    const del = row.createEl("button", { text: t("删除"), cls: "mod-warning" });
    del.onclick = async () => {
      del.disabled = true;
      try {
        const target = this.withFolder ? this.file.parent : this.file;
        if (target instanceof TFolder) await this.app.fileManager.trashFile(target);
        else await this.app.fileManager.trashFile(this.file);
        new Notice(t("已删除《{name}》", { name: this.file.basename }));
        this.close();
        this.onDeleted();
      } catch (e) {
        new Notice(t("删除失败：{msg}", { msg: (e as Error).message }));
        del.disabled = false;
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
