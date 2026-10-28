import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
    coverage: {
      provider: "v8",
      include: ["src/lib/workspace.js", "src/lib/extension-events.js", "src/pages/ReviewPage.jsx", "src/components/ui.jsx"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 }
    }
  }
});
