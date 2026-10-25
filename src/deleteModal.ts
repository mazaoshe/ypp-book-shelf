import { App, Modal, Notice, TFile, TFolder } from "obsidian";

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
    contentEl.createEl("h3", { text: `删除《${this.file.basename}》` });
    contentEl.createEl("p", {
      text: "会移到系统废纸篓（Obsidian 的删除设置决定是否永久删除），可以从废纸篓找回。",
    });

    const parentPath = this.file.parent?.path ?? "";
    const label = contentEl.createEl("label", { cls: "bs-modal-opts" });
    const cb = label.createEl("input", { type: "checkbox" });
    cb.checked = this.withFolder;
    cb.onchange = () => (this.withFolder = cb.checked);
    label.appendText(` 连同目录 ${parentPath}/ 一起删除（含封面图片和同目录其他副本）`);

    if (!this.folderHasOnlyThis) {
      contentEl.createEl("p", {
        text: "注意：这个目录里还有其他笔记，勾选会一起删掉。",
        cls: "bs-modal-status",
      });
    }

    const row = contentEl.createDiv({ cls: "bs-modal-row" });
    const cancel = row.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();
    const del = row.createEl("button", { text: "删除", cls: "mod-warning" });
    del.onclick = async () => {
      del.disabled = true;
      try {
        const target = this.withFolder ? this.file.parent : this.file;
        if (target instanceof TFolder) await this.app.vault.trash(target, true);
        else await this.app.vault.trash(this.file, true);
        new Notice(`已删除《${this.file.basename}》`);
        this.close();
        this.onDeleted();
      } catch (e) {
        new Notice(`删除失败：${(e as Error).message}`);
        del.disabled = false;
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
