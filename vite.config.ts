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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("mermaid") || id.includes("cytoscape") || id.includes("d3-")) {
            return "vendor-mermaid";
          }
          if (id.includes("katex") || id.includes("@streamdown/math")) {
            return "vendor-math";
          }
          if (id.includes("@streamdown/cjk")) {
            return "vendor-cjk";
          }
          if (id.includes("shiki") || id.includes("@shikijs") || id.includes("@streamdown/code")) {
            return "vendor-syntax";
          }
          if (
            id.includes("streamdown") ||
            id.includes("remark") ||
            id.includes("rehype") ||
            id.includes("micromark") ||
            id.includes("mdast") ||
            id.includes("hast")
          ) {
            return "vendor-markdown";
          }
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
          if (id.includes("@radix-ui") || id.includes("radix-ui")) {
            return "vendor-radix";
          }
          return undefined;
        },
      },
    },
  },
});
