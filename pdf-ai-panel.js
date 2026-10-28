(() => {
  const WIDTH_KEY = "lexiloopPdfAiPanelWidth";
  const DEFAULT_WIDTH = 356;
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 720;

  function widthBounds(viewportWidth, reservedWidth = 0) {
    const rawViewport = Number(viewportWidth);
    const viewport = Number.isFinite(rawViewport) && rawViewport > 0 ? rawViewport : 320;
    const mobile = viewport <= 760;
    const available = mobile
      ? Math.floor(viewport * 0.92)
      : Math.floor(viewport - 320 - Math.max(0, Number(reservedWidth) || 0));
    const minimum = mobile ? Math.min(MIN_WIDTH, available) : MIN_WIDTH;
    return {
      min: minimum,
      max: Math.max(minimum, Math.min(MAX_WIDTH, available))
    };
  }

  function clampWidth(value, viewportWidth, reservedWidth = 0) {
    const bounds = widthBounds(viewportWidth, reservedWidth);
    const width = Number(value) || DEFAULT_WIDTH;
    return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
  }

  function widthFromDrag(startWidth, startClientX, currentClientX, viewportWidth, reservedWidth = 0) {
    return clampWidth(
      Number(startWidth) + Number(startClientX) - Number(currentClientX),
      viewportWidth,
      reservedWidth
    );
  }

  const api = Object.freeze({
    WIDTH_KEY,
    DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_WIDTH,
    widthBounds,
    clampWidth,
    widthFromDrag
  });

  globalThis.LexiLoopPdfAiPanel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
