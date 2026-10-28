#!/usr/bin/env node
// 从真实阅读器页面 pdf-reader.html 派生自动化预览页 tests/pdf-reader-preview.html。
// 预览页长期手工维护会和产品结构漂移（缺按钮、缺脚本、旧顶栏），所以这里只做确定性改写：
//   1. 本地资源路径加 ../（预览页在 tests/ 下）
//   2. 所有脚本与样式加同一个版本号，绕开浏览器缓存
//   3. 在第一个脚本前插入 chrome 预览桩
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "pdf-reader.html"), "utf8");
const stamp = String(Date.now()).slice(-9);

let html = source
  .replace(/(src|href)="(?!https?:|data:|#|\/)([^"?]+)(\?[^"]*)?"/g, (_, attr, target, query) => {
    const version = /\.(?:js|css)$/.test(target) ? `?v=${stamp}` : query || "";
    return `${attr}="../${target}${version}"`;
  });

const mockTag = `  <script src="pdf-reader-preview-mocks.js?v=${stamp}"></script>\n`;
const firstScript = html.indexOf("  <script src=\"../");
if (firstScript < 0) throw new Error("reading page has no local script tag");
html = html.slice(0, firstScript) + mockTag + html.slice(firstScript);

// 预览页自己的提示：说明它由生成脚本产出，不要手改
html = html.replace(
  "<body",
  "<body data-preview-generated=\"scripts/build-reader-preview.cjs\""
);

fs.writeFileSync(path.join(root, "tests", "pdf-reader-preview.html"), html);
console.log(`preview rebuilt: ${html.length} bytes, v=${stamp}`);
