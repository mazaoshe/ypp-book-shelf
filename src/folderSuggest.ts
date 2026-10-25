import { AbstractInputSuggest, App, TFolder } from "obsidian";

/** 目录输入框的自动补全：列出库里所有目录，输入片段过滤 */
export class FolderSuggest extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;
  private onPick: (value: string) => void;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onPick: (value: string) => void
  ) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.onPick = onPick;
  }

  getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    const all = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => f.path)
      .filter((p) => p !== "/");
    const hit = q ? all.filter((p) => p.toLowerCase().includes(q)) : all;
    return hit.sort((a, b) => a.localeCompare(b)).slice(0, 100);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.inputEl.value = value;
    this.inputEl.dispatchEvent(new Event("input"));
    this.onPick(value);
    this.close();
  }
}
