import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "dist/**",
      "images/**",
      "deploy.mjs",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["esbuild.config.mjs"],
    rules: {
      // 构建脚本跑在 Node 里，不随插件分发到移动端
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.*",
            "esbuild.config.mjs",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "obsidianmd/sample-names": "off",
    },
  },
]);
