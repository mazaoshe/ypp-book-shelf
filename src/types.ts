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
  author?: string;
  translator?: string;
  cover?: string;
  rating?: string;
  desc?: string;
  subjectId?: string;
  title?: string;
}

/** 缺字段的稳定 key，显示时再翻译成文案 */
export type MissingKey = "cover" | "author" | "desc";

export interface BookItem {
  file: TFile;
  frontmatter: Fm;
  title: string;
  author: string;
  /** 译者，多人用 / 拼起来；没译者时为空串 */
  translator: string;
  /** 出版社，列表视图的一列 */
  publisher: string;
  cover: string;
  status: string;
  /** ISBN，列表视图当书名副标题 */
  isbn: string;
  /** 页数，0 表示没填（只来自豆瓣详情页） */
  pages: number;
  /** 评分：豆瓣优先，其次微信读书；都没有则为空 */
  score: string;
  /** 简介原文，列表只显示缩略，悬停看完整 */
  desc: string;
  /** 分类（category / genre，微信读书那种「个人成长-励志成长」取大类） */
  categories: string[];
  /** 缺哪些关键字段，顺序固定：封面、作者、简介 */
  missing: MissingKey[];
}
