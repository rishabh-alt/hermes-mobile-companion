import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    hmr: false,
  },
  optimizeDeps: {
    entries: ["index.html"],
    exclude: ["shiki", "@streamdown/code", "vitest"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
