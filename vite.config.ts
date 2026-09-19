import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: "web",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Zee-Drive",
        short_name: "Zee-Drive",
        description: "Google Drive file explorer and media streaming server",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#000000",
        icons: [
          {
            src: "/Zee-Index-Logo.png",
            sizes: "any",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // Jangan pernah ganti navigasi server-driven dengan index ter-cache:
        // 302/Set-Cookie (auth, logout, share, proxy) harus sampai ke jaringan.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/logout/, /^\/s\//, /^\/d\//, /^\/p\//],
      },
    }),
  ],
  build: {
    outDir: "../public",
    emptyOutDir: true,
    target: "es2020",
    assetsInlineLimit: 8192,
  },
});
