import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "bg-base": "#0A0C0F",
        "bg-surface": "#111318",
        "bg-elevated": "#181C24",
        border: "#1E2229",
        red: "#E63946",
        amber: "#F4A261",
        orange: "#F97316",
        teal: "#2A9D8F",
        text: "#F0F2F5",
        muted: "#6B7280",
        dim: "#3D4450",
      },
      fontFamily: {
        mono: ["DM Mono", "monospace"],
        sans: ["DM Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
