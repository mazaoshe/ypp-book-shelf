import { requestUrl } from "obsidian";
import { BookMeta, DoubanMeta } from "./types";
import { t } from "./i18n";

const WEREAD_SEARCH = "https://weread.qq.com/web/search/global";
const DOUBAN_SUGGEST = "https://book.douban.com/j/subject_suggest";
const DOUBAN_REFERER = "https://book.douban.com/";

/** 微信读书搜索接口里用到的字段（只声明用到的，避免 any 传播） */
interface WereadBookInfo {
  bookId?: string;
  title?: string;
  author?: string;
  translator?: string;
  publisher?: string;
  intro?: string;
  cover?: string;
  newRating?: number;
  newRatingCount?: number;
  deepLink?: string;
}

interface WereadResponse {
  books?: { bookInfo?: WereadBookInfo }[];
}

/** 豆瓣 subject_suggest 返回的列表项 */
interface DoubanSuggestItem {
  type?: string;
  url?: string;
  id?: string;
  title?: string;
  pic?: string;
  year?: string;
  author_name?: string;
}

/** 微信读书封面小图地址 → 大图地址 */
function upgradeWereadCover(url: string): string {
  if (!url) return url;
  return url.replace("/s_", "/t9_");
}

/**
 * 用微信读书的公开搜索接口查书。
 * 返回书名、作者、译者、出版社、简介、封面、评分，没有 ISBN 和页数。
 */
export async function searchWeread(keyword: string): Promise<BookMeta[]> {
  const url = `${WEREAD_SEARCH}?keyword=${encodeURIComponent(keyword)}`;
  const res = await requestUrl({ url, method: "GET", throw: false });
  if (res.status !== 200) {
    throw new Error(t("微信读书搜索失败（HTTP {status}）", { status: res.status }));
  }
  let data: WereadResponse;
  try {
    data = res.json as WereadResponse;
  } catch {
    throw new Error(t("微信读书返回内容无法解析"));
  }
  const books = data?.books ?? [];
  const out: BookMeta[] = [];
  for (const item of books) {
    const info = item?.bookInfo;
    if (!info || !info.title) continue;
    out.push({
      bookId: info.bookId,
      title: info.title,
      author: info.author ?? "",
      translator: info.translator ?? "",
      publisher: info.publisher ?? "",
      intro: (info.intro ?? "").replace(/\s+/g, " ").trim(),
      cover: upgradeWereadCover(info.cover ?? ""),
      rating:
        typeof info.newRating === "number"
          ? `${(info.newRating / 10).toFixed(1)}%${
              info.newRatingCount ? `${info.newRatingCount}${t("人")}` : ""
            }`
          : "",
      sourceUrl: info.deepLink ?? "",
      origin: "weread",
      sources: ["weread"],
    });
  }
  return out;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function pick(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? stripTags(m[1]).trim() : "";
}

async function suggestDouban(keyword: string): Promise<DoubanSuggestItem[]> {
  const sres = await requestUrl({
    url: `${DOUBAN_SUGGEST}?q=${encodeURIComponent(keyword)}`,
    method: "GET",
    headers: { Referer: DOUBAN_REFERER },
    throw: false,
  });
  if (sres.status !== 200) {
    throw new Error(t("豆瓣搜索失败（HTTP {status}）", { status: sres.status }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sres.text);
  } catch {
    throw new Error(t("豆瓣返回内容无法解析"));
  }
  const list = Array.isArray(parsed) ? (parsed as DoubanSuggestItem[]) : [];
  return list.filter((x) => x && x.type === "b" && x.url);
}

/**
 * 用豆瓣的 suggest 接口搜索，返回书名、作者、封面、出版年。
 * 没有简介和评分，需要的话再抓详情页。
 */
export async function searchDouban(keyword: string): Promise<BookMeta[]> {
  const books = await suggestDouban(keyword);
  return books.map((b) => {
    const subjectId = String(b.url ?? "").match(/subject\/(\d+)/)?.[1] ?? "";
    return {
      title: b.title ?? "",
      author: b.author_name ?? "",
      cover: b.pic ?? "",
      yearPublished: b.year ?? "",
      sourceUrl: b.url ?? "",
      subjectId,
      origin: "douban" as const,
      sources: ["douban" as const],
    };
  });
}

/**
 * 豆瓣网页接口：先 suggest 搜索，再抓详情页拿 ISBN / 页数 / 出版年。
 * 豆瓣详情页需要带 Referer，纯请求会 418。
 */
export async function fetchDouban(
  keyword: string,
  expectAuthor?: string
): Promise<DoubanMeta | null> {
  let books: DoubanSuggestItem[] = [];
  try {
    books = await suggestDouban(keyword);
  } catch {
    return null;
  }
  if (books.length === 0) return null;

  // 优先挑作者能对上的那条，都没有就用第一条
  let chosen = books[0];
  if (expectAuthor) {
    const key = expectAuthor.replace(/\s/g, "").slice(0, 4);
    const hit = books.find((b) =>
      String(b.author_name ?? "").replace(/\s/g, "").includes(key)
    );
    if (hit) chosen = hit;
  }

  const subjectId = String(chosen.url).match(/subject\/(\d+)/)?.[1] ?? "";
  if (!subjectId) return null;
  return fetchDoubanById(subjectId);
}

/** ISBN 归一化：只留数字和 X */
function isbnKeyOf(raw: string): string {
  return (raw ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

/**
 * 从 `window.__DATA__ = {...}` 这类行内脚本里取出第一个完整 JSON 对象。
 * 正则截取会在遇到后续脚本时抾“Extra data”报错，所以用括号计数扫描。
 */
function extractFirstJsonObject(text: string, fromIndex: number): unknown {
  const start = text.indexOf("{", fromIndex);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * 按 ISBN 精准查豆瓣。suggest 接口不认 ISBN（实测全返回 `[]`），
 * 得走 `search.douban.com/book/subject_search` 页面里的 `window.__DATA__`，
 * 拿到 subject id 后再抓详情页，最后校验 ISBN 对得上才返回。
 */
export async function fetchDoubanByIsbn(isbn: string): Promise<DoubanMeta | null> {
  const key = isbnKeyOf(isbn);
  if (!key) return null;

  const res = await requestUrl({
    url: `https://search.douban.com/book/subject_search?search_text=${key}&cat=1001`,
    method: "GET",
    headers: { Referer: DOUBAN_REFERER },
    throw: false,
  });
  if (res.status !== 200) return null;

  const marker = res.text.indexOf("window.__DATA__");
  if (marker < 0) return null;
  const data = extractFirstJsonObject(res.text, marker) as {
    items?: { url?: string }[];
  } | null;
  const items = data?.items ?? [];

  for (const item of items) {
    const subjectId = String(item?.url ?? "").match(/subject\/(\d+)/)?.[1] ?? "";
    if (!subjectId) continue;
    const meta = await fetchDoubanById(subjectId);
    if (!meta) continue;
    // ISBN 对不上就换下一条，宁可不补也不写错
    const got = isbnKeyOf(meta.isbn ?? "");
    if (got && got !== key) continue;
    return meta;
  }
  return null;
}

/** 关键词是不是 ISBN（10 位或 13 位，允许带连字符） */
export function looksLikeIsbn(keyword: string): boolean {
  const k = (keyword ?? "").replace(/[^0-9Xx]/g, "");
  return k.length === 13 || k.length === 10;
}

/**
 * 新建书籍时直接用 ISBN 搜：返回豆瓣那一条结果（带封面），
 * 搜不到就返回空数组，让上层提示没结果。
 */
export async function searchDoubanByIsbn(isbn: string): Promise<BookMeta[]> {
  const meta = await fetchDoubanByIsbn(isbn);
  if (!meta || !meta.title) return [];
  return [
    {
      title: meta.title,
      author: meta.author ?? "",
      translator: meta.translator ?? "",
      publisher: meta.publisher ?? "",
      cover: meta.cover ?? "",
      intro: meta.desc ?? "",
      isbn: meta.isbn ?? "",
      pages: meta.pages,
      yearPublished: meta.yearPublished ?? "",
      rating: meta.rating ?? "",
      subjectId: meta.subjectId ?? "",
      sourceUrl: meta.subjectId
        ? `https://book.douban.com/subject/${meta.subjectId}/`
        : "",
      origin: "douban" as const,
      sources: ["douban" as const],
    },
  ];
}

/** 直接抓豆瓣详情页（已知 subject id 时用，省一次 suggest 请求） */
export async function fetchDoubanById(subjectId: string): Promise<DoubanMeta | null> {
  if (!subjectId) return null;

  const dres = await requestUrl({
    url: `https://book.douban.com/subject/${subjectId}/`,
    method: "GET",
    headers: { Referer: DOUBAN_REFERER },
    throw: false,
  });
  if (dres.status !== 200) return null;
  const html = dres.text;

  const pagesRaw = pick(html, /页数:?<\/span>\s*([0-9]+)/);
  const meta: DoubanMeta = {
    subjectId,
    title: pick(html, /property="v:itemreviewed">([^<]+)</),
    isbn: pick(html, /ISBN:?<\/span>\s*([0-9Xx-]+)/),
    pages: pagesRaw ? Number(pagesRaw) : undefined,
    yearPublished: pick(html, /出版年:?<\/span>\s*([^<]+)/),
    // 出版社在详情页里是 <a> 包着的，直接取 [^<]+ 会拿到空白
    publisher: pick(html, /出版社:?<\/span>\s*(?:<a[^>]*>)?([^<]+)/),
    author: pickLinkedField(html, "作者"),
    translator: pickLinkedField(html, "译者"),
    cover: pick(html, /<div id="mainpic"[\s\S]{0,600}?<img src="([^"]+)"/),
    // 评分那行形如 <strong property="v:average"> 9.1 </strong>，两头都有空白
    rating: pick(html, /property="v:average">\s*([0-9.]+)\s*</),
    desc: "",
  };
  const introMatch = html.match(/<div class="intro">([\s\S]*?)<\/div>/);
  if (introMatch) meta.desc = stripTags(introMatch[1]).slice(0, 600);
  return meta;
}

/**
 * 豆瓣详情页里「作者」「译者」是一个个 <a>，可能多人合著/合译（用 / 分隔），全部取出。
 * 形如 `<span class="pl"> 译者</span>: <a href="/author/4617349">马振骋</a>`
 */
function pickLinkedField(html: string, label: string): string {
  const block = html.match(new RegExp(`${label}</span>([\\s\\S]{0,400}?)</span>`));
  if (!block) return "";
  const names = [...block[1].matchAll(/>([^<>]+)<\/a>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return [...new Set(names)].join(" / ");
}

/** 下载远程图片为二进制 */
export async function downloadImage(url: string): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = {};
  if (url.includes("doubanio.com")) headers.Referer = DOUBAN_REFERER;
  const res = await requestUrl({ url, method: "GET", headers, throw: false });
  if (res.status !== 200) return null;
  return res.arrayBuffer;
}

/**
 * 根据图片地址猜一个本地文件名：同目录的 cover 系列。
 * view.ts 的 localCover() 依次找 cover.jpg / .png / .jpeg / .webp，所以扩展名要跟原图对上。
 */
export function coverFileNameFor(url: string, base = "cover.jpg"): string {
  const stem = base.replace(/\.[^.]+$/, "") || "cover";
  const path = url.split("?")[0].split("#")[0];
  const m = path.match(/\.(jpe?g|png|webp|gif)$/i);
  const fromUrl = m ? m[1].toLowerCase().replace("jpeg", "jpg") : "";
  const fromBase = (base.match(/\.[^.]+$/)?.[0] ?? ".jpg").slice(1).toLowerCase();
  const ext = fromUrl || (fromBase === "jpeg" ? "jpg" : fromBase);
  return `${stem}.${ext}`;
}
