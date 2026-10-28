// 共享动效：主题切换时新主题从中心圆形展开（View Transitions API）。
// 不支持该 API 或用户开启「减少动态效果」时直接切换。
(function (root) {
  const reducedMotion = () => root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let running = null;

  function themeReveal(update, origin) {
    const doc = root.document;
    if (typeof doc.startViewTransition !== "function" || reducedMotion() || doc.visibilityState !== "visible") {
      update();
      return Promise.resolve();
    }
    running?.skipTransition?.();
    const x = Number.isFinite(origin?.x) ? origin.x : root.innerWidth / 2;
    const y = Number.isFinite(origin?.y) ? origin.y : root.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, root.innerWidth - x), Math.max(y, root.innerHeight - y));
    doc.documentElement.classList.add("theme-reveal");
    const transition = doc.startViewTransition(update);
    running = transition;
    transition.ready.then(() => {
      doc.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(.22, 1, .36, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(() => {});
    return transition.finished.catch(() => {}).finally(() => {
      if (running === transition) running = null;
      doc.documentElement.classList.remove("theme-reveal");
    });
  }

  root.LexiLoopMotion = { themeReveal };
})(typeof window !== "undefined" ? window : globalThis);
