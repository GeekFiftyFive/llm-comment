import { defineConfig } from "vite";

// Port used by `npm run dev:server`; the Vite dev server proxies /api to it.
const API = "http://127.0.0.1:4100";

export default defineConfig({
  root: "web",
  build: { outDir: "../dist/public", emptyOutDir: true },
  oxc: { jsx: { runtime: "automatic" } },
  server: {
    proxy: {
      "/api": {
        target: API,
        changeOrigin: true,
        // The API server only accepts its own origin; present the request as coming from it.
        configure: (proxy) => proxy.on("proxyReq", (request) => request.setHeader("origin", API)),
      },
    },
  },
});
