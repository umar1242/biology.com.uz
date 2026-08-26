import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Needed once this is served through a public HTTPS tunnel (ngrok/
    // localtunnel/etc.) for real testing inside Telegram — Vite's dev
    // server otherwise rejects requests for hosts it doesn't recognize.
    allowedHosts: true,
    // Same-origin proxy for the API — lets VITE_API_BASE_URL stay a
    // relative "/api/v1" so only one tunnel is needed (the browser talks
    // to whatever host served the page), matching the production Caddy
    // setup instead of hardcoding a second tunnel URL that changes on
    // every restart.
    proxy: {
      "/api/v1": process.env.VITE_DEV_API_PROXY ?? "http://localhost:3000",
    },
  },
});
