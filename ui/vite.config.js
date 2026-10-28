import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// 产物固定文件名、输出到项目根的 ui-dist/，根目录的 manifest.json 与加载路径不变，
// 扩展 ID 因此保持不变（chrome.storage 与 IndexedDB 里的数据不受影响）。
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: resolve(here, "..", "ui-dist"),
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
    rollupOptions: {
      input: { app: resolve(here, "index.html") },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});