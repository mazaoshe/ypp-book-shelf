import type { BookItem } from "./types";

/** ISO date or timestamp; invalid calendar dates stay in the unknown bucket. */
export function readingYear(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value.trim());
  if (!m || (value.includes("T") && !Number.isFinite(Date.parse(value)))) return "";
  const [y, month, day] = m.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, month - 1, day);
  return y > 0 && date.getUTCFullYear() === y && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? m[1] : "";
}

export function matchesReadingYear(book: Pick<BookItem, "finishedDate">, year: string): boolean {
  return year === "all" || (readingYear(book.finishedDate) || "unknown") === year;
}

export function readingSummary(books: Pick<BookItem, "status" | "finishedDate" | "source">[]) {
  const years = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const book of books) {
    if (book.status !== "读完") continue;
    const year = readingYear(book.finishedDate) || "unknown";
    const source = book.source.trim() || "";
    years.set(year, (years.get(year) ?? 0) + 1);
    sources.set(source, (sources.get(source) ?? 0) + 1);
  }
  return { years, sources };
}

export function matchesShelfFilters(book: Pick<BookItem, "finishedDate" | "title" | "author" | "status" | "categories">, query: string, status: string, category: string, year: string): boolean {
  const q = query.trim().toLowerCase();
  return matchesReadingYear(book, year)
    && (status === "全部" || book.status === status)
    && (category === "全部" || book.categories.includes(category))
    && (!q || book.title.toLowerCase().includes(q) || book.author.toLowerCase().includes(q));
}
