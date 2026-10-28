// PDF 插图 / 表格 / 公式区域识别：纯逻辑部分。
// 思路：页面低分辨率渲染后，「有墨迹但不属于任何已翻译文字段落」的区域就是插图、表格或独立公式。
// 坐标均为 PDF 页面基准视口（scale=1）坐标。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LexiLoopPdfFigures = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEFAULTS = {
    cell: 3,            // 网格单元边长（基准像素）
    inkThreshold: 228,  // RGB 任一通道低于此值视为墨迹
    linkRadius: 4,      // 相距不超过这么多个单元的墨迹算同一区域
    mergeGap: 16,       // 区域之间小于此间距、且中间没有正文时合并（基准像素）
    minWidth: 36,
    minHeight: 9,       // 单行独立公式只有 10 来个像素高
    minArea: 900,
    minInkCells: 10,
    maxTextCoverage: 0.4 // 区域面积大半是正文（带底色的摘要框、算法框）就不当插图
  };

  // RGBA 像素 → 墨迹网格。pixelScale：渲染像素 / 基准像素。
  function buildInkGrid(data, pixelWidth, pixelHeight, pixelScale, options = {}) {
    const { cell, inkThreshold } = { ...DEFAULTS, ...options };
    const step = cell * pixelScale;
    const cols = Math.max(1, Math.ceil(pixelWidth / step));
    const rows = Math.max(1, Math.ceil(pixelHeight / step));
    const ink = new Uint8Array(cols * rows);
    for (let y = 0; y < pixelHeight; y += 1) {
      const row = Math.floor(y / step) * cols;
      const offset = y * pixelWidth * 4;
      for (let x = 0; x < pixelWidth; x += 1) {
        const index = offset + x * 4;
        if (data[index + 3] < 16) continue;
        if (data[index] < inkThreshold || data[index + 1] < inkThreshold || data[index + 2] < inkThreshold) {
          ink[row + Math.floor(x / step)] = 1;
        }
      }
    }
    return { cols, rows, cell, ink };
  }

  // 把矩形（基准像素）覆盖到的单元清掉：已翻译的文字段落、旋转水印等
  function clearRects(grid, rects) {
    const { cols, rows, cell, ink } = grid;
    for (const rect of rects || []) {
      if (!rect) continue;
      const x0 = Math.max(0, Math.floor(rect.x / cell));
      const y0 = Math.max(0, Math.floor(rect.top / cell));
      const x1 = Math.min(cols - 1, Math.floor((rect.x + rect.width) / cell));
      const y1 = Math.min(rows - 1, Math.floor((rect.top + rect.height) / cell));
      for (let y = y0; y <= y1; y += 1) ink.fill(0, y * cols + x0, y * cols + x1 + 1);
    }
    return grid;
  }

  function intersects(a, b, gap = 0) {
    return a.x - gap < b.x + b.width && b.x - gap < a.x + a.width && a.top - gap < b.top + b.height && b.top - gap < a.top + a.height;
  }

  function union(a, b) {
    const x = Math.min(a.x, b.x);
    const top = Math.min(a.top, b.top);
    return {
      x,
      top,
      width: Math.max(a.x + a.width, b.x + b.width) - x,
      height: Math.max(a.top + a.height, b.top + b.height) - top,
      inkCells: (a.inkCells || 0) + (b.inkCells || 0)
    };
  }

  // 墨迹网格 → 区域框。textRects：正文段落框，合并区域时不能跨过它们。
  function findRegions(grid, textRects = [], options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const { cols, rows, cell, ink } = grid;
    const radius = settings.linkRadius;
    const label = new Int32Array(cols * rows);
    let boxes = [];
    const queue = new Int32Array(cols * rows);
    for (let start = 0; start < ink.length; start += 1) {
      if (!ink[start] || label[start]) continue;
      const id = boxes.length + 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      label[start] = id;
      let minX = cols;
      let minY = rows;
      let maxX = 0;
      let maxY = 0;
      let count = 0;
      while (head < tail) {
        const current = queue[head++];
        const cx = current % cols;
        const cy = (current - cx) / cols;
        count += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const yStart = Math.max(0, cy - radius);
        const yEnd = Math.min(rows - 1, cy + radius);
        const xStart = Math.max(0, cx - radius);
        const xEnd = Math.min(cols - 1, cx + radius);
        for (let ny = yStart; ny <= yEnd; ny += 1) {
          for (let nx = xStart; nx <= xEnd; nx += 1) {
            const neighbor = ny * cols + nx;
            if (ink[neighbor] && !label[neighbor]) {
              label[neighbor] = id;
              queue[tail++] = neighbor;
            }
          }
        }
      }
      boxes.push({ x: minX * cell, top: minY * cell, width: (maxX - minX + 1) * cell, height: (maxY - minY + 1) * cell, inkCells: count });
    }

    // 合并相邻区域（插图的各部分、坐标轴与图例），但不跨过正文段落
    const overlapsText = (box) => textRects.some((rect) => {
      if (!intersects(box, rect)) return false;
      const width = Math.min(box.x + box.width, rect.x + rect.width) - Math.max(box.x, rect.x);
      const height = Math.min(box.top + box.height, rect.top + rect.height) - Math.max(box.top, rect.top);
      return width * height > Math.min(rect.width * rect.height, box.width * box.height) * 0.12;
    });
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          if (!intersects(boxes[i], boxes[j], settings.mergeGap)) continue;
          const combined = union(boxes[i], boxes[j]);
          if (!intersects(boxes[i], boxes[j]) && overlapsText(combined)) continue;
          boxes[i] = combined;
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }

    boxes = boxes.filter((box) => box.width >= settings.minWidth
      && box.height >= settings.minHeight
      && box.width * box.height >= settings.minArea
      && box.inkCells >= settings.minInkCells
      // 很矮的区域（单行公式）要足够宽，零星符号、页码不算
      && (box.height >= 16 || box.width >= 70)
      && textCoverage(box, textRects) <= settings.maxTextCoverage);
    return boxes
      .map((box) => {
        // 四周留一点白边，裁图时不切到笔画
        const pad = Math.max(2, cell);
        const x = Math.max(0, box.x - pad);
        const top = Math.max(0, box.top - pad);
        return {
          x,
          top,
          width: Math.min(cols * cell - x, box.width + pad * 2),
          height: Math.min(rows * cell - top, box.height + pad * 2),
          kind: classifyRegion(box)
        };
      })
      .sort((a, b) => a.top - b.top || a.x - b.x);
  }

  function overlapArea(a, b) {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    return width > 0 && height > 0 ? width * height : 0;
  }

  // 区域被正文段落覆盖的面积比例
  function textCoverage(region, rects) {
    const area = Math.max(1, region.width * region.height);
    return Math.min(1, (rects || []).reduce((sum, rect) => sum + overlapArea(region, rect), 0) / area);
  }

  // 落在插图内部的文字段落（图里的说明框、标签）：随插图一起显示，不再单独翻译。图注除外。
  function blocksInsideRegions(blocks, regions, threshold = 0.7) {
    const inside = new Set();
    (blocks || []).forEach((block, index) => {
      if (block.kind === "caption") return;
      const area = Math.max(1, block.width * block.height);
      if ((regions || []).some((region) => overlapArea(block, region) / area >= threshold)) inside.add(index);
    });
    return inside;
  }

  // 水平线（三线表的上中下线、算法框线）：某一行像素里有很长的连续墨迹，且只有一两像素厚
  function findHorizontalRules(data, width, height, pixelScale, options = {}) {
    const minLength = (options.minLength ?? 110) * pixelScale;
    const threshold = options.inkThreshold ?? DEFAULTS.inkThreshold;
    const rows = new Array(height).fill(null);
    for (let y = 0; y < height; y += 1) {
      const offset = y * width * 4;
      let best = 0;
      let bestStart = 0;
      let run = 0;
      let runStart = 0;
      for (let x = 0; x < width; x += 1) {
        const index = offset + x * 4;
        if (data[index] < threshold || data[index + 1] < threshold || data[index + 2] < threshold) {
          if (!run) runStart = x;
          run += 1;
          if (run > best) {
            best = run;
            bestStart = runStart;
          }
        } else {
          run = 0;
        }
      }
      if (best >= minLength) rows[y] = { x: bestStart, length: best };
    }
    const rules = [];
    for (let y = 0; y < height; y += 1) {
      if (!rows[y]) continue;
      let end = y;
      while (end + 1 < height && rows[end + 1] && Math.abs(rows[end + 1].x - rows[y].x) <= 3 * pixelScale) end += 1;
      // 太厚的是色块、照片，不是线
      if (end - y + 1 <= 3 * pixelScale) {
        rules.push({ x: rows[y].x / pixelScale, top: y / pixelScale, width: rows[y].length / pixelScale, height: (end - y + 1) / pixelScale });
      }
      y = end;
    }
    return rules;
  }

  const TABLE_CAPTION_PATTERN = /^(?:Table|Tab\.|Algorithm|Alg\.)\s*[\dIVX]+/i;

  // 表格：两条以上左右对齐的横线，并且紧挨着「Table N / Algorithm N」标题
  function findTableRegions(rules, blocks) {
    const groups = [];
    for (const rule of [...(rules || [])].sort((a, b) => a.top - b.top)) {
      const group = groups.find((items) => {
        const first = items[0];
        const last = items[items.length - 1];
        return Math.abs(first.x - rule.x) < 10 && Math.abs(first.width - rule.width) < 16 && rule.top - last.top < 420;
      });
      if (group) group.push(rule);
      else groups.push([rule]);
    }
    const regions = [];
    for (const group of groups) {
      if (group.length < 2) continue;
      const x = Math.min(...group.map((rule) => rule.x));
      const right = Math.max(...group.map((rule) => rule.x + rule.width));
      const top = group[0].top;
      const bottom = group[group.length - 1].top + group[group.length - 1].height;
      if (bottom - top < 12) continue;
      const captioned = (blocks || []).some((block) => TABLE_CAPTION_PATTERN.test(String(block.text || ""))
        && block.x < right && block.x + block.width > x
        && block.top + block.height >= top - 48 && block.top <= bottom + 48);
      if (!captioned) continue;
      regions.push({ x: x - 2, top: top - 3, width: right - x + 4, height: bottom - top + 6, kind: "table" });
    }
    return regions;
  }

  // 表格区域取代与它重叠的墨迹区域
  function mergeTableRegions(regions, tables) {
    if (!tables?.length) return regions;
    const kept = (regions || []).filter((region) => !tables.some((table) => {
      const area = Math.max(1, region.width * region.height);
      return overlapArea(region, table) / area > 0.3;
    }));
    return [...kept, ...tables].sort((a, b) => a.top - b.top || a.x - b.x);
  }


  function multiplyMatrix(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5]
    ];
  }

  function applyMatrix(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  // 从 PDF 操作符里取出图片的外接矩形。照片大面积是浅色，按墨迹会切成碎片；
  // 图片对象自己有完整矩形。坐标换成视口坐标（左上原点）。
  function imageRectsFromOperators(fnArray, argsArray, viewportTransform) {
    const fns = fnArray || [];
    const args = argsArray || [];
    const view = viewportTransform?.length === 6 ? viewportTransform : [1, 0, 0, 1, 0, 0];
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const rects = [];
    for (let index = 0; index < fns.length; index += 1) {
      const fn = fns[index];
      if (fn === 10) {
        stack.push(ctm);
        continue;
      }
      if (fn === 11) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        continue;
      }
      if (fn === 12) {
        const matrix = args[index];
        if (matrix && matrix.length >= 6) ctm = multiplyMatrix(ctm, matrix);
        continue;
      }
      // 85 paintImageXObject，86 paintInlineImageXObject。图片画在单位正方形上。
      if (fn !== 85 && fn !== 86) continue;
      const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => {
        const user = applyMatrix(ctm, x, y);
        return applyMatrix(view, user[0], user[1]);
      });
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const x = Math.min(...xs);
      const top = Math.min(...ys);
      const width = Math.max(...xs) - x;
      const height = Math.max(...ys) - top;
      if (width < 28 || height < 28 || width * height < 2400) continue;
      rects.push({ x, top, width, height, kind: "figure", source: "image" });
    }
    return rects;
  }

  // 把同一张图的多块照片、以及贴在图上的标签墨迹并成一块。不吞掉旁边的正文。
  function absorbImageRegions(images, inkRegions, textRects, options = {}) {
    const gap = options.gap ?? 36;
    const maxCoverage = options.maxTextCoverage ?? 0.42;
    let clusters = (images || []).map((box) => ({ ...box, kind: "figure", source: "image" }));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < clusters.length; i += 1) {
        for (let j = i + 1; j < clusters.length; j += 1) {
          if (!intersects(clusters[i], clusters[j], gap)) continue;
          const combined = { ...union(clusters[i], clusters[j]), kind: "figure", source: "image" };
          if (textCoverage(combined, textRects) > maxCoverage) continue;
          clusters[i] = combined;
          clusters.splice(j, 1);
          changed = true;
          i -= 1;
          break;
        }
      }
    }
    const used = new Set();
    clusters = clusters.map((cluster) => {
      let box = cluster;
      let grew = true;
      while (grew) {
        grew = false;
        for (let index = 0; index < (inkRegions || []).length; index += 1) {
          if (used.has(index) || !intersects(box, inkRegions[index], gap)) continue;
          const combined = { ...union(box, inkRegions[index]), kind: "figure", source: "image" };
          if (textCoverage(combined, textRects) > maxCoverage) continue;
          used.add(index);
          box = combined;
          grew = true;
        }
      }
      return box;
    });
    const rest = (inkRegions || []).filter((_, index) => !used.has(index));
    return [...clusters, ...rest].sort((a, b) => a.top - b.top || a.x - b.x);
  }

  // 扁长且不高的区域多半是独立公式，其余视为插图或表格
  function classifyRegion(box) {
    return box.height <= 64 && box.width / Math.max(1, box.height) >= 2.4 ? "equation" : "figure";
  }

  return { DEFAULTS, buildInkGrid, clearRects, findRegions, classifyRegion, textCoverage, blocksInsideRegions, findHorizontalRules, findTableRegions, mergeTableRegions, imageRectsFromOperators, absorbImageRegions };
});
