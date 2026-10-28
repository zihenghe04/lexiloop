// 触控板捏合缩放的纯计算部分（不碰 DOM，可在 Node 里测）。
// Chrome 在 macOS 上把双指捏合报告成带 ctrlKey 的 wheel 事件，deltaY = -100 × ln(这一帧的手势比例)，
// 所以 exp(-deltaY / 100) 恰好还原手势比例：手指张开一倍，页面也放大一倍。
// 鼠标 Ctrl/⌘ + 滚轮一格的 deltaY 约 100（按同一公式是 2.7 倍），单个事件限制在 MAX_STEP 以内。
(function (root, factory) {
  const api = factory();
  root.LexiLoopPdfZoom = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_STEP = 1.25;

  function wheelZoomFactor({ deltaY, deltaMode = 0, pageHeight = 800 } = {}) {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
    const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, pageHeight) : 1;
    const factor = Math.exp((-deltaY * unit) / 100);
    return Math.min(MAX_STEP, Math.max(1 / MAX_STEP, factor));
  }

  // 缩放前后指针下的那一点保持不动：before / after 是同一页缩放前后的矩形（视口坐标），返回新的滚动位置
  function anchoredScroll({ scrollLeft, scrollTop, before, after, clientX, clientY }) {
    const fx = before?.width ? (clientX - before.left) / before.width : 0.5;
    const fy = before?.height ? (clientY - before.top) / before.height : 0.5;
    return {
      left: scrollLeft + after.left + fx * after.width - clientX,
      top: scrollTop + after.top + fy * after.height - clientY
    };
  }

  return { wheelZoomFactor, anchoredScroll, MAX_STEP };
});
