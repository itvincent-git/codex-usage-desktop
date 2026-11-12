import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "rgb(var(--border) / <alpha-value>)",
        input: "rgb(var(--border) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          foreground: "rgb(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          foreground: "rgb(var(--muted-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          foreground: "rgb(var(--foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          foreground: "rgb(var(--foreground) / <alpha-value>)",
        },
        surface: "rgb(var(--surface) / <alpha-value>)",
        card: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          foreground: "rgb(var(--foreground) / <alpha-value>)",
        },
        success: { DEFAULT: "rgb(var(--success) / <alpha-value>)", foreground: "rgb(var(--success-foreground) / <alpha-value>)" },
        warning: { DEFAULT: "rgb(var(--warning) / <alpha-value>)", foreground: "rgb(var(--warning-foreground) / <alpha-value>)" },
        error: { DEFAULT: "rgb(var(--error) / <alpha-value>)", foreground: "rgb(var(--error-foreground) / <alpha-value>)" },
      },
      fontFamily: {
        display: ["'General Sans'", "sans-serif"],
        sans: ["'DM Sans'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      borderRadius: {
        lg: "12px",
        md: "8px",
        sm: "6px",
      },
      boxShadow: {
        card: "0 8px 30px rgba(0,0,0,0.08)",
        glow: "0 4px 12px rgba(99,102,241,0.35)",
      },
      letterSpacing: {
        display: "-0.04em",
      },
      maxWidth: {
        layout: "1280px",
      },
    },
  },
  plugins: [plugin(({ addVariant }) => {
    for (const [name, width] of Object.entries({ sm: 640, md: 768, lg: 1024 })) {
      addVariant(`content-${name}`, `@container app-content (min-width: ${width}px)`);
    }
  })],
} satisfies Config;

