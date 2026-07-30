import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cockpit base: zinc/slate darks (v2.2 §3). Semantic accents only —
        // truth = blue spectrum, privacy = green/amber/red, no decorative
        // color, no purple, no teal, no gradients.
        ink: {
          950: "#09090b",
          900: "#0c0d10",
          850: "#101216",
          800: "#16181d",
          700: "#1f2229",
          600: "#2c3038",
        },
        dim: {
          500: "#63687a",
          400: "#7d8294",
          300: "#9ba0b0",
          200: "#c3c7d4",
          100: "#e7e9ef",
        },
        signal: {
          blue: "#5b9dff",      // truth: strong (VERIFIED)
          bluedim: "#3d6db3",   // truth: attested band
          green: "#3ecf8e",     // privacy: PUBLIC_SAFE
          amber: "#e0b45c",     // privacy: INTERNAL_ONLY / warnings / NEEDS_PROOF
          red: "#e26d6d",       // privacy: PRIVATE / DISPUTED / blocked
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "JetBrains Mono", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
