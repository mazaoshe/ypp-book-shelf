import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type BookShelfPlugin from "./main";
import { ActivityStore } from "./activity";
import { FolderSuggest } from "./folderSuggest";
import { t } from "./i18n";

export interface BookShelfSettings {
  folder: string;
  typeField: string;
  typeValue: string;
  statusField: string;
  coverField: string;
  authorField: string;
  translatorField: string;
  enableDouban: boolean;
  enableWeread: boolean;
  coverFileName: string;
  /** 补全时把远程封面下载到书籍目录；关闭则保留在线链接 */
  downloadCover: boolean;
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
  translatorField: "translator",
  enableDouban: true,
  enableWeread: true,
  coverFileName: "cover.jpg",
  downloadCover: false,
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

// 这些是 frontmatter 字段名/值的示例，必须保持小写，故用常量绕开 UI 文案大小写规则
const PLACEHOLDER_TYPE_FIELD = "type";
const PLACEHOLDER_DEFAULT_FM = "type: book";
const PLACEHOLDER_NEW_TYPE = "book";

export class BookShelfSettingTab extends PluginSettingTab {
  plugin: BookShelfPlugin;

  constructor(app: App, plugin: BookShelfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Obsidian 1.13+ 的声明式设置 API。返回空数组表示仍由 display() 渲染，
   * 旧版本不会调用这个方法，行为不变。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("书籍目录"))
      .setDesc(t("只扫描这个目录下的笔记（库内相对路径）"))
      .addText((tc) => {
        tc.setPlaceholder("Books")
          .setValue(this.plugin.settings.folder)
          .onChange(async (v) => {
            this.plugin.settings.folder = v.trim();
            await this.plugin.saveSettings();
          });
        new FolderSuggest(this.app, tc.inputEl, (v) => {
          this.plugin.settings.folder = v;
          void this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("类型字段 / 值"))
      .setDesc(
        t("frontmatter 里该字段等于任一值的笔记才算一本书。多个值用逗号分隔（如 books-summary, book）；留空则目录下所有笔记都算")
      )
      .addText((tc) =>
        tc
          // frontmatter 字段名示例，保持小写
          .setPlaceholder(PLACEHOLDER_TYPE_FIELD)
          .setValue(this.plugin.settings.typeField)
          .onChange(async (v) => {
            this.plugin.settings.typeField = v.trim();
            await this.plugin.saveSettings();
          })
      )
      .addText((tc) =>
        tc
          .setPlaceholder(t("留空 = 不过滤；多个用逗号分隔"))
          .setValue(this.plugin.settings.typeValue)
          .onChange(async (v) => {
            this.plugin.settings.typeValue = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("阅读状态字段"))
      .setDesc(
        t("书架的状态标签、筛选，以及统计里的「读完 / 在读」都按这个字段判断。识别 想读 / 在读 / 读完 / 弃读（也认 读过、已读、阅读中等别名）。新建书籍默认写「想读」")
      )
      .addText((tc) =>
        tc
          .setValue(this.plugin.settings.statusField)
          .onChange(async (v) => {
            this.plugin.settings.statusField = v.trim() || "readingStatus";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("封面字段"))
      .setDesc(t("默认 cover，值可以是远程 URL 或库内路径"))
      .addText((tc) =>
        tc
          .setValue(this.plugin.settings.coverField)
          .onChange(async (v) => {
            this.plugin.settings.coverField = v.trim() || "cover";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("作者字段"))
      .setDesc(t("默认 author"))
      .addText((tc) =>
        tc
          .setValue(this.plugin.settings.authorField)
          .onChange(async (v) => {
            this.plugin.settings.authorField = v.trim() || "author";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("译者字段"))
      .setDesc(t("默认 translator，存成数组；没译者时不写这个键"))
      .addText((tc) =>
        tc
          .setValue(this.plugin.settings.translatorField)
          .onChange(async (v) => {
            this.plugin.settings.translatorField = v.trim() || "translator";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("封面文件名"))
      .setDesc(t("同目录下这个文件优先作为封面，不依赖 frontmatter 的 cover"))
      .addText((tc) =>
        tc
          .setValue(this.plugin.settings.coverFileName)
          .onChange(async (v) => {
            this.plugin.settings.coverFileName = v.trim() || "cover.jpg";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("下载封面到书籍目录"))
      .setDesc(
        t(
          "关闭时只记图片链接，目录更干净；开启后把封面存成同目录的 cover 文件，断网也能显示"
        )
      )
      .addToggle((tc) =>
        tc
          .setValue(this.plugin.settings.downloadCover === true)
          .onChange(async (v) => {
            this.plugin.settings.downloadCover = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("把简介算作缺项"))
      .setDesc(
        t("关闭时只有缺封面或缺作者才显示「补全」。微信读书笔记一般不带简介，建议关闭")
      )
      .addToggle((tc) =>
        tc.setValue(this.plugin.settings.requireDesc).onChange(async (v) => {
          this.plugin.settings.requireDesc = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("新建书籍的默认属性"))
      .setDesc(
        t("每行一个 key: value，新建书籍时写进 frontmatter。不需要就留空")
      )
      .addTextArea((tc) =>
        tc
          // frontmatter 示例，保持小写
          .setPlaceholder(PLACEHOLDER_DEFAULT_FM)
          .setValue(this.plugin.settings.defaultFrontmatter)
          .onChange(async (v) => {
            this.plugin.settings.defaultFrontmatter = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("新建书籍的类型值"))
      .setDesc(
        t("新建时写进 type 字段的值，例如 book。留空则不写这个字段（配合上面的「类型字段 / 值」做筛选）")
      )
      .addText((tc) =>
        tc
          // 字段值示例，保持小写
          .setPlaceholder(PLACEHOLDER_NEW_TYPE)
          .setValue(this.plugin.settings.newNoteType)
          .onChange(async (v) => {
            this.plugin.settings.newNoteType = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("搜书用微信读书"))
      .setDesc(t("中文书的封面、简介、评分比较全。关掉后只用其它源"))
      .addToggle((tc) =>
        tc.setValue(this.plugin.settings.enableWeread).onChange(async (v) => {
          this.plugin.settings.enableWeread = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("搜书用豆瓣"))
      .setDesc(
        t("英文书和冷门书靠它，还能补 ISBN / 页数 / 出版年。两个开关都关掉就搜不到东西")
      )
      .addToggle((tc) =>
        tc.setValue(this.plugin.settings.enableDouban).onChange(async (v) => {
          this.plugin.settings.enableDouban = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName(t("阅读统计")).setHeading();

    new Setting(containerEl)
      .setName(t("统计目录"))
      .setDesc(
        t("留空 = 跟上面「书籍目录」一致（统计读书）。想统计写作就把这里填成 Content，热力图会变成“今天写了东西没有”")
      )
      .addText((tc) => {
        tc.setPlaceholder(t("留空 = 书架目录"))
          .setValue(this.plugin.settings.trackFolder)
          .onChange(async (v) => {
            this.plugin.settings.trackFolder = v.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshStats();
          });
        new FolderSuggest(this.app, tc.inputEl, (v) => {
          this.plugin.settings.trackFolder = v;
          void this.plugin.saveSettings().then(() => this.plugin.refreshStats());
        });
      });

    new Setting(containerEl)
      .setName(t("统计的类型字段 / 值"))
      .setDesc(
        t("只想统计特定类型的笔记时填，例如字段 type、值 books-summary, book。留空 = 目录下所有笔记都算")
      )
      .addText((tc) =>
        tc
          .setPlaceholder(t("留空 = 不过滤"))
          .setValue(this.plugin.settings.trackTypeField)
          .onChange(async (v) => {
            this.plugin.settings.trackTypeField = v.trim();
            await this.plugin.saveSettings();
          })
      )
      .addText((tc) =>
        tc
          .setPlaceholder(t("留空 = 不过滤"))
          .setValue(this.plugin.settings.trackTypeValue)
          .onChange(async (v) => {
            this.plugin.settings.trackTypeValue = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("批量同步不计入"))
      .setDesc(t("2 秒内 5 个以上文件同时变更，判定为同步任务写入，不记为阅读"))
      .addToggle((tc) =>
        tc.setValue(this.plugin.settings.skipBatchSync).onChange(async (v) => {
          this.plugin.settings.skipBatchSync = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
