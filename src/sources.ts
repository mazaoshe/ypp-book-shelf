import { requestUrl } from "obsidian";
import { BookMeta, DoubanMeta } from "./types";
import { t } from "./i18n";

const WEREAD_SEARCH = "https://weread.qq.com/web/search/global";
const DOUBAN_SUGGEST = "https://book.douban.com/j/subject_suggest";
const DOUBAN_REFERER = "https://book.douban.com/";

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
  let data: any;
  try {
    data = res.json;
  } catch (e) {
    throw new Error(t("微信读书返回内容无法解析"));
  }
  const books: any[] = data?.books ?? [];
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

/**
 * 豆瓣网页接口：先 suggest 搜索，再抓详情页拿 ISBN / 页数 / 出版年。
 * 豆瓣详情页需要带 Referer，纯请求会 418。
 */
export async function fetchDouban(
  keyword: string,
  expectAuthor?: string
): Promise<DoubanMeta | null> {
  const sres = await requestUrl({
    url: `${DOUBAN_SUGGEST}?q=${encodeURIComponent(keyword)}`,
    method: "GET",
    headers: { Referer: DOUBAN_REFERER },
    throw: false,
  });
  if (sres.status !== 200) return null;

  let list: any[] = [];
  try {
    list = JSON.parse(sres.text);
  } catch (e) {
    return null;
  }
  const books = (Array.isArray(list) ? list : []).filter(
    (x) => x && x.type === "b" && x.url
  );
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
    isbn: pick(html, /ISBN:?<\/span>\s*([0-9Xx\-]+)/),
    pages: pagesRaw ? Number(pagesRaw) : undefined,
    yearPublished: pick(html, /出版年:?<\/span>\s*([^<]+)/),
    publisher: pick(html, /出版社:?<\/span>\s*([^<]+)/),
    rating: pick(html, /property="v:average">([0-9.]+)</),
    desc: "",
  };
  const introMatch = html.match(/<div class="intro">([\s\S]*?)<\/div>/);
  if (introMatch) meta.desc = stripTags(introMatch[1]).slice(0, 600);
  return meta;
}

/** 下载远程图片为二进制 */
export async function downloadImage(url: string): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = {};
  if (url.includes("doubanio.com")) headers.Referer = DOUBAN_REFERER;
  const res = await requestUrl({ url, method: "GET", headers, throw: false });
  if (res.status !== 200) return null;
  return res.arrayBuffer;
}
