import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), wasm()],
  server: {
    port: 5173,
    allowedHosts: ["judged.proxy.tionis.dev"],
  },
  build: {
    // Automerge's bundled WASM glue uses top-level await; esbuild
    // handles it natively at this target.
    target: "esnext",
    outDir: "dist/client",
  },
});
