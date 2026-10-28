#!/usr/bin/env node
// 从真实侧边栏页面 sidepanel.html 派生自动化预览页 tests/preview.html。
// 手工维护预览页会和产品结构漂移（缺按钮、旧顶栏），所以这里只做确定性改写：
//   1. 本地资源路径加 ../（预览页在 tests/ 下）
//   2. 所有脚本与样式加同一个版本号，绕开浏览器缓存
//   3. 在 head 里插入主题参数脚本，在业务脚本前插入 chrome 预览桩
//   4. body 末尾追加 tab / settings / menu 参数脚本
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = path.join(root, "sidepanel.html");
const target = path.join(root, "tests", "preview.html");

const version = String(Date.now());
let html = fs.readFileSync(source, "utf8");

const themeScript = `<script>{const t=new URLSearchParams(location.search).get("theme");if(t)localStorage.setItem("lexiloopReaderTheme",t);}</script>`;
html = html.replace(/(<title>[^<]*<\/title>)/, `$1\n  ${themeScript}`);

// 脚本在解析期就抛错时，页面表象只是「初始化没跑」，所以先挂错误收集，验收时直接读 window.__previewErrors
const errorScript = `<script>window.__previewErrors=[];window.addEventListener("error",(e)=>window.__previewErrors.push(String(e.message||e.error)));window.addEventListener("unhandledrejection",(e)=>window.__previewErrors.push("reject: "+String(e.reason&&e.reason.message||e.reason)));</script>`;
html = html.replace(/<head>/, `<head>\n  ${errorScript}`);

html = html.replace(/(href|src)="(?!https?:|\/\/|data:|#)([A-Za-z0-9_.\-/]+\.(?:css|js))"/g, (match, attribute, file) => (
  file.startsWith("tests/") ? match : `${attribute}="../${file}?v=${version}"`
));

const firstBusinessScript = '  <script src="../pdf-library.js';
if (!html.includes(firstBusinessScript)) throw new Error("找不到第一个业务脚本，预览页结构与真实页不一致");
html = html.replace(
  firstBusinessScript,
  `  <script src="preview-mocks.js?v=${version}"></script>\n${firstBusinessScript}`
);

const paramsScript = `  <script>{const p=new URLSearchParams(location.search);const tab=p.get("tab");if(tab)setTimeout(()=>document.querySelector(\`[data-tab="\${tab}"]\`)?.click(),300);if(p.has("settings"))setTimeout(()=>document.getElementById("shortcutSettingsButton").click(),500);if(p.has("provider"))setTimeout(()=>document.getElementById("shortcutSettingsButton").click(),500);if(p.has("addConnection"))setTimeout(()=>document.getElementById("addConnectionButton").click(),600);if(p.has("menu"))setTimeout(()=>{const d=document.querySelector("details.paper-more");if(d)d.open=true;},700);if(p.has("reveal"))setTimeout(()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true})),700);}</script>`;
html = html.replace("</body>", `${paramsScript}\n</body>`);

fs.writeFileSync(target, html);
console.log(`preview rebuilt: ${Buffer.byteLength(html)} bytes, v=${version}`);
