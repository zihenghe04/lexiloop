// 侧边栏跟随 PDF 阅读器的阅读主题（同一扩展源共享 localStorage），也可以在侧边栏里切换。
// 在 <head> 中同步执行，避免首帧闪白；之后的切换用中心展开动画。
(() => {
  const KEY = "lexiloopReaderTheme";
  const THEMES = ["light", "sepia", "dark"];
  const LABELS = { light: "浅色", sepia: "纸张", dark: "深色" };
  const normalize = (value) => (THEMES.includes(value) ? value : "light");
  const current = () => normalize(document.documentElement.dataset.theme);
  const apply = (value) => {
    const theme = normalize(value);
    if (theme === "light") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    return theme;
  };
  const animate = (update) => (window.LexiLoopMotion ? window.LexiLoopMotion.themeReveal(update) : update());
  try { apply(localStorage.getItem(KEY)); } catch { apply("light"); }

  window.addEventListener("storage", (event) => {
    if (event.key !== KEY || normalize(event.newValue) === current()) return;
    animate(() => apply(event.newValue));
  });

  window.LexiLoopTheme = {
    labels: LABELS,
    current,
    cycle() {
      const next = THEMES[(THEMES.indexOf(current()) + 1) % THEMES.length];
      try { localStorage.setItem(KEY, next); } catch {}
      animate(() => apply(next));
      return next;
    }
  };
})();
