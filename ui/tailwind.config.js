/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // 语义色板与 Reader（shadcn/ui）一致：全部读取 CSS 变量，主题切换只换变量
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        popover: "var(--popover)",
        "popover-foreground": "var(--popover-foreground)",
        primary: "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        secondary: "var(--secondary)",
        "secondary-foreground": "var(--secondary-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        destructive: "var(--destructive)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        shell: "var(--shell)",
        track: "var(--track)",
        // 兼容旧类名（页面里仍在用 surface/line/ink 这套），语义已指向新令牌
        surface: "var(--background)",
        raised: "var(--accent)",
        line: "var(--border)",
        ink: "var(--foreground)",
        "ink-soft": "var(--ink-soft)",
        brand: "var(--primary)",
        "brand-ink": "var(--primary-foreground)",
        "brand-soft": "var(--primary-soft)",
        danger: "var(--destructive)"
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        card: "var(--radius)",
        pill: "999px"
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        soft: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
        pop: "var(--shadow-pop)"
      },
      fontSize: {
        // 页面里沿用的小字号档位，行高按 Reader 的紧凑比例
        ui: ["13px", { lineHeight: "1.5" }],
        "ui-sm": ["12px", { lineHeight: "1.45" }],
        "ui-lg": ["15px", { lineHeight: "1.5" }]
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "system-ui",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};