import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend is a Vite + React SPA built to ./dist/client.
// Cloudflare Workers serves that directory via the `assets` binding (see wrangler.jsonc).
// During local dev, `vite` runs on :5173 and proxies /api/* to `wrangler dev` on :8787.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8788",
        changeOrigin: true,
      },
    },
  },
});
