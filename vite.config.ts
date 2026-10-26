import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  publicDir: false,
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
  test: { root: ".", include: ["tests/**/*.test.ts"] },
  build: { outDir: "../../dist", emptyOutDir: true },
});
