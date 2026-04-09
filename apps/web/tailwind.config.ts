import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        breath: {
          cyan: "#00E5FF",
          violet: "#B24BF3",
          rose: "#FF3D7F",
          dark: "#0A0E1A",
          darker: "#060910",
          card: "#111827",
        },
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
