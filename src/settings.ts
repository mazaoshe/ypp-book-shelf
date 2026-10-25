import { App, PluginSettingTab, Setting } from "obsidian";
import type BookShelfPlugin from "./main";
import { ActivityStore } from "./activity";
import { FolderSuggest } from "./folderSuggest";

export interface BookShelfSettings {
  folder: string;
  typeField: string;
  typeValue: string;
  statusField: string;
  coverField: string;
  authorField: string;
  enableDouban: boolean;
  coverFileName: string;
  requireDesc: boolean;
  defaultFrontmatter: string;
  /** 阅读活动记录（按天累计，插件自动维护） */
  activity: ActivityStore;
  /** 批量同步写入不计入阅读记录 */
  skipBatchSync: boolean;
  /** 统计目录，留空 = 用书架目录 */
  trackFolder: string;
  /** 统计只认这个字段（留空 = 只按目录） */
  trackTypeField: string;
  /** 统计只认这些值，逗号分隔 */
  trackTypeValue: string;
  /** 新建书籍时写入 type 的值，留空则不写 */
  newNoteType: string;
}

export const DEFAULT_SETTINGS: BookShelfSettings = {
  folder: "Books",
  typeField: "type",
  typeValue: "",
  statusField: "readingStatus",
  coverField: "cover",
  authorField: "author",
  enableDouban: true,
  coverFileName: "cover.jpg",
  requireDesc: false,
  defaultFrontmatter: "",
  /** 新建书籍时写入 type 的值，留空则不写 */
  newNoteType: "",
  activity: { days: {}, since: 0 },
  skipBatchSync: true,
  trackFolder: "",
  trackTypeField: "",
  trackTypeValue: "",
};

export class BookShelfSettingTab extends PluginSettingTab {
  plugin: BookShelfPlugin;

  constructor(app: App, plugin: BookShelfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("书籍目录")
      .setDesc("只扫描这个目录下的笔记（库内相对路径）")
      .addText((t) => {
        t.setPlaceholder("Books")
          .setValue(this.plugin.settings.folder)
          .onChange(async (v) => {
            this.plugin.settings.folder = v.trim();
            await this.plugin.saveSettings();
          });
        new FolderSuggest(this.app, t.inputEl, async (v) => {
          this.plugin.settings.folder = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("类型字段 / 值")
      .setDesc(
        "frontmatter 里该字段等于任一值的笔记才算一本书。多个值用逗号分隔（如 books-summary, book）；留空则目录下所有笔记都算"
      )
      .addText((t) =>
        t
          .setPlaceholder("type")
          .setValue(this.plugin.settings.typeField)
          .onChange(async (v) => {
            this.plugin.settings.typeField = v.trim();
            await this.plugin.saveSettings();
          })
      )
      .addText((t) =>
        t
          .setPlaceholder("留空 = 不过滤；多个用逗号分隔")
          .setValue(this.plugin.settings.typeValue)
          .onChange(async (v) => {
            this.plugin.settings.typeValue = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("阅读状态字段")
      .setDesc(
        "书架的状态标签、筛选，以及统计里的「读完 / 在读数」都按这个字段判断。识别 想读 / 在读 / 读完 / 弃读（也认 读过、已读、阅读中等别名）。新建书籍默认写「想读」"
      )
      .addText((t) =>
        t
          .setValue(this.plugin.settings.statusField)
          .onChange(async (v) => {
            this.plugin.settings.statusField = v.trim() || "readingStatus";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("封面字段")
      .setDesc("默认 cover，值可以是远程 URL 或库内路径")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.coverField)
          .onChange(async (v) => {
            this.plugin.settings.coverField = v.trim() || "cover";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("作者字段")
      .setDesc("默认 author")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.authorField)
          .onChange(async (v) => {
            this.plugin.settings.authorField = v.trim() || "author";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("封面文件名")
      .setDesc("同目录下这个文件优先作为封面，不依赖 frontmatter 的 cover")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.coverFileName)
          .onChange(async (v) => {
            this.plugin.settings.coverFileName = v.trim() || "cover.jpg";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("把简介算作缺项")
      .setDesc(
        "关闭时只有缺封面或缺作者才显示「补全」。微信读书笔记一般不带简介，建议关闭"
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.requireDesc).onChange(async (v) => {
          this.plugin.settings.requireDesc = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("新建书籍的默认属性")
      .setDesc(
        "每行一个 key: value，新建书籍时写进 frontmatter。不需要就留空"
      )
      .addTextArea((t) =>
        t
          .setPlaceholder("type: book")
          .setValue(this.plugin.settings.defaultFrontmatter)
          .onChange(async (v) => {
            this.plugin.settings.defaultFrontmatter = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("新建书籍的类型值")
      .setDesc(
        "新建时写进 type 字段的值，例如 book。留空则不写这个字段（配合上面的「类型字段 / 值」做筛选）"
      )
      .addText((t) =>
        t
          .setPlaceholder("book")
          .setValue(this.plugin.settings.newNoteType)
          .onChange(async (v) => {
            this.plugin.settings.newNoteType = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("用豆瓣补 ISBN / 页数 / 出版年")
      .setDesc("微信读书没有这几个字段。豆瓣网页接口需要 Referer，失败不影响封面和简介")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableDouban).onChange(async (v) => {
          this.plugin.settings.enableDouban = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("阅读统计").setHeading();

    new Setting(containerEl)
      .setName("统计目录")
      .setDesc(
        "留空 = 跟上面「书籍目录」一致（统计读书）。想统计写作就把这里填成 Content，热力图会变成“今天写了东西没有”"
      )
      .addText((t) => {
        t.setPlaceholder("留空 = 书架目录")
          .setValue(this.plugin.settings.trackFolder)
          .onChange(async (v) => {
            this.plugin.settings.trackFolder = v.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshStats();
          });
        new FolderSuggest(this.app, t.inputEl, async (v) => {
          this.plugin.settings.trackFolder = v;
          await this.plugin.saveSettings();
          this.plugin.refreshStats();
        });
      });

    new Setting(containerEl)
      .setName("统计的类型字段 / 值")
      .setDesc(
        "只想统计特定类型的笔记时填，例如字段 type、值 books-summary, book。留空 = 目录下所有笔记都算"
      )
      .addText((t) =>
        t
          .setPlaceholder("留空 = 不过滤")
          .setValue(this.plugin.settings.trackTypeField)
          .onChange(async (v) => {
            this.plugin.settings.trackTypeField = v.trim();
            await this.plugin.saveSettings();
          })
      )
      .addText((t) =>
        t
          .setPlaceholder("留空 = 不过滤")
          .setValue(this.plugin.settings.trackTypeValue)
          .onChange(async (v) => {
            this.plugin.settings.trackTypeValue = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("批量同步不计入")
      .setDesc("2 秒内 5 个以上文件同时变更，判定为同步任务写入，不记为阅读")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.skipBatchSync).onChange(async (v) => {
          this.plugin.settings.skipBatchSync = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
