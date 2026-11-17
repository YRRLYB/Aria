import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import packageJson from "./package.json";

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [react(), tailwindcss()],
  server: {
    // Runtime data, packaged output and native binaries can contain thousands
    // of files; none participate in frontend HMR.
    watch: {
      ignored: [
        "**/.cache/**",
        "**/.musicbox/**",
        "**/.tmp-mpv/**",
        "**/.tools/**",
        "**/dist/**",
        "**/dist-server/**",
        "**/release/**",
        "**/release-fixed/**",
        "**/vendor/**",
      ],
    },
    proxy: {
      "/api": `http://127.0.0.1:${process.env.ARIA_API_PORT || process.env.MUSICBOX_API_PORT || 3636}`,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
