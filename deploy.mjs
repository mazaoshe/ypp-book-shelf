import { copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const VAULT =
  process.env.BOOK_SHELF_VAULT ??
  "/Volumes/KeSilentA/Other/Nutstore/KeSilent";
const PLUGIN_ID = "ypp-book-shelf";
const DEST = path.join(VAULT, ".obsidian", "plugins", PLUGIN_ID);

if (!existsSync(VAULT)) {
  console.error(`找不到 vault：${VAULT}（可用 BOOK_SHELF_VAULT 覆盖）`);
  process.exit(1);
}

await mkdir(DEST, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(f, path.join(DEST, f));
  console.log(`copied ${f}`);
}
// 赞赏码图（有就带上，没有不影响插件运行）
const reward = path.join("images", "wx-reward.png");
if (existsSync(reward)) {
  await mkdir(path.join(DEST, "images"), { recursive: true });
  await copyFile(reward, path.join(DEST, "images", "wx-reward.png"));
  console.log("copied images/wx-reward.png");
}
console.log(`→ ${DEST}`);
console.log("在 Obsidian 设置 → 第三方插件 中启用 YPP Book Shelf（已启用则重启插件）。");
