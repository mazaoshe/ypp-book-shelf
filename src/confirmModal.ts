import { App, Modal } from "obsidian";
import { t } from "./i18n";

/** 通用二次确认框：确定返回 true，取消/关闭返回 false */
export class ConfirmModal extends Modal {
  private title: string;
  private lines: string[];
  private okText: string;
  private cancelText: string;
  private resolve: (v: boolean) => void;
  private done = false;

  constructor(
    app: App,
    opts: {
      title: string;
      lines: string[];
      okText?: string;
      cancelText?: string;
      resolve: (v: boolean) => void;
    }
  ) {
    super(app);
    this.title = opts.title;
    this.lines = opts.lines;
    this.okText = opts.okText ?? t("确定");
    this.cancelText = opts.cancelText ?? t("取消");
    this.resolve = opts.resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    for (const line of this.lines) contentEl.createEl("p", { text: line });

    const row = contentEl.createDiv({ cls: "bs-modal-row" });
    const cancel = row.createEl("button", { text: this.cancelText });
    cancel.onclick = () => this.finish(false);
    const ok = row.createEl("button", { text: this.okText, cls: "mod-warning" });
    ok.onclick = () => this.finish(true);
  }

  onClose() {
    this.contentEl.empty();
    // 直接点右上角关闭，等同取消
    if (!this.done) {
      this.done = true;
      this.resolve(false);
    }
  }

  private finish(v: boolean) {
    this.done = true;
    this.resolve(v);
    this.close();
  }
}

/** Promise 化的二次确认，默认焦点在「取消」那侧（返回 false） */
export function confirmDialog(
  app: App,
  opts: { title: string; lines: string[]; okText?: string; cancelText?: string }
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, { ...opts, resolve }).open();
  });
}
