import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, run `npm run dev:worker` (port 8787) alongside `npm run dev`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {rollupOptions:{input:{chief:"index.html",daynote:"daynote/index.html"}}},
  server: { proxy: { "/api": "http://localhost:8787" } },
});
