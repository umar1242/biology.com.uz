import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin proxy for the API, mirroring apps/miniapp and the production
    // Caddy setup. Without it the dev server fell back to the hardcoded
    // http://localhost:3000, which is nothing once the API runs in Docker
    // (docker-compose.prod.yml deliberately does not publish that port).
    // Point VITE_DEV_API_PROXY at the dashboard container to develop against
    // the running stack: VITE_DEV_API_PROXY=http://127.0.0.1:8080
    proxy: {
      "/api/v1": process.env.VITE_DEV_API_PROXY ?? "http://localhost:3000",
    },
  },
});
