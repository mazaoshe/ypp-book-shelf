import type { TFile } from "obsidian";
import type { Fm } from "./fm";

export interface BookMeta {
  title?: string;
  author?: string;
  translator?: string;
  publisher?: string;
  cover?: string;
  intro?: string;
  isbn?: string;
  pages?: number;
  yearPublished?: string;
  rating?: string;
  sourceUrl?: string;
  bookId?: string;
  /** 豆瓣 subject id，用于直接抓详情页 */
  subjectId?: string;
  /** 主要来源（决定详情页怎么取） */
  origin?: "weread" | "douban";
  /** 这条结果由哪些源提供 */
  sources?: ("weread" | "douban")[];
}

export interface DoubanMeta {
  isbn?: string;
  pages?: number;
  yearPublished?: string;
  publisher?: string;
  translator?: string;
  rating?: string;
  desc?: string;
  subjectId?: string;
  title?: string;
}

export interface BookItem {
  file: TFile;
  frontmatter: Fm;
  title: string;
  author: string;
  /** 译者，多人用 / 拼起来；没译者时为空串 */
  translator: string;
  cover: string;
  status: string;
}
