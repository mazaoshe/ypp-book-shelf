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
}

export interface DoubanMeta {
  isbn?: string;
  pages?: number;
  yearPublished?: string;
  publisher?: string;
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
  cover: string;
  status: string;
}
