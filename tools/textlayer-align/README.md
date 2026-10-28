# 文字层对齐测量

用 PyMuPDF 取每个字符的真实位置，和阅读器文字层里每个字符的 Range 位置比，得到逐字符偏差（CSS 像素）。

1. `python3 chars.py paper.pdf 1,2,3 > chars-paper.json`，和 PDF 放在同一个本机 http 目录（如 `python3 -m http.server 8765`）。
2. 阅读器打开 `pdf-reader.html?url=http://127.0.0.1:8765/paper.pdf`。
3. 在阅读器页面里把 `align.js` 包成 `(async (args) => { ... })({pdf: "paper", pages: [1,2,3]})` 执行（DevTools 控制台或 CDP）。

输出每页的中位数、p90、p99、最大偏差和超过 3px 的字符数。
