import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
  BookShelfSettings,
  DEFAULT_SETTINGS,
  BookShelfSettingTab,
} from "./settings";
import { BookShelfView, VIEW_TYPE_BOOK_SHELF } from "./view";
import { BookStatsView, VIEW_TYPE_BOOK_STATS } from "./statsView";
import { ActivityTracker, dayKey, emptyActivity } from "./activity";
import { collectBooks } from "./library";
import { BookItem } from "./types";
import { asStr, getFm } from "./fm";
import { t } from "./i18n";

export default class BookShelfPlugin extends Plugin {
  settings: BookShelfSettings;
  private tracker: ActivityTracker | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_BOOK_SHELF,
      (leaf: WorkspaceLeaf) => new BookShelfView(leaf, this)
    );

    this.registerView(
      VIEW_TYPE_BOOK_STATS,
      (leaf: WorkspaceLeaf) => new BookStatsView(leaf, this)
    );

    this.addRibbonIcon("library-big", t("我的书架"), () => this.activateView());
    this.addRibbonIcon("bar-chart-3", t("阅读统计"), () => this.activateStatsView());

    this.addCommand({
      id: "open-book-shelf",
      name: t("打开书架"),
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "open-reading-stats",
      name: t("打开阅读统计"),
      callback: () => this.activateStatsView(),
    });

    this.startTracking();

    this.addSettingTab(new BookShelfSettingTab(this.app, this));
  }

  /** 书架目录里的书籍笔记（供统计视图复用） */
  collectBooks(): BookItem[] {
    return collectBooks(this.app, this.settings);
  }

  private startTracking() {
    if (!this.settings.activity) this.settings.activity = emptyActivity();
    if (!this.settings.activity.since) {
      this.settings.activity.since = Date.now();
      void this.saveData(this.settings);
    }
    this.tracker = new ActivityTracker(
      this.app,
      this,
      this.settings.activity,
      (path) => this.shouldTrack(path),
      this.settings.skipBatchSync,
      async () => {
        this.settings.activity.days[dayKey(new Date())] ??= {};
        await this.saveData(this.settings);
        this.refreshStats();
      }
    );
    this.tracker.start();
  }

  /**
   * 是否算“读了一本书”：
   * - 必须在书架目录下
   * - 设置里指定了类型字段/值时，只认匹配的笔记；留空则目录下全部笔记都算
   */
  /** 统计目录：设置里没填就跟书架目录一致 */
  get trackFolder(): string {
    return (this.settings.trackFolder || this.settings.folder || "").replace(
      /\/$/,
      ""
    );
  }

  /** 统计的是否为书籍目录（决定面板里显不显示书籍相关卡片） */
  get trackingBooks(): boolean {
    return this.trackFolder === (this.settings.folder || "").replace(/\/$/, "");
  }

  shouldTrack(path: string): boolean {
    const folder = this.trackFolder;
    if (folder && !path.startsWith(folder + "/")) return false;
    const wanted = (this.settings.trackTypeValue || "")
      .split(/[,，、\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (wanted.length === 0) return true;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const fm = getFm(this.app, file);
    const value = asStr(
      fm[this.settings.trackTypeField || this.settings.typeField || "type"]
    );
    return wanted.includes(value);
  }

  refreshStats() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOK_STATS)) {
      const view = leaf.view;
      if (view instanceof BookStatsView) view.render();
    }
  }

  async activateStatsView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_BOOK_STATS);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_BOOK_STATS, active: true });
    }
    if (leaf) void workspace.revealLeaf(leaf);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_BOOK_SHELF);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_BOOK_SHELF, active: true });
    }
    if (leaf) void workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    const data = (await this.loadData()) as unknown;
    const stored =
      data && typeof data === "object" ? (data as Partial<BookShelfSettings>) : {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    // 旧版默认按 type=books-summary 过滤，导致大量书漏掉；作废
    if (this.settings.typeValue === "books-summary") {
      this.settings.typeValue = "";
      await this.saveData(this.settings);
    }
    // 早期默认给新建书籍写 doc_type，改成 type: book
    if (
      this.settings.defaultFrontmatter === "doc_type: weread-highlights-reviews" ||
      this.settings.defaultFrontmatter === "type: book"
    ) {
      this.settings.defaultFrontmatter = DEFAULT_SETTINGS.defaultFrontmatter;
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshViews();
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOK_SHELF)) {
      const view = leaf.view;
      if (view instanceof BookShelfView) view.render();
    }
  }
}

export function toast(msg: string) {
  new Notice(msg, 4000);
}
