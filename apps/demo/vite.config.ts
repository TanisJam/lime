import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  server: { port: 5173, open: false },
  // @lime/* packages are consumed from their built dist via workspace symlinks.
  // Run `pnpm build` at the repo root after changing core/renderer/styles.
  optimizeDeps: {
    include: ["tone"],
  },
  build: {
    rollupOptions: {
      input: {
        // The demo UI.
        index: here("index.html"),
        // Headless offline capture, driven by Playwright (window.limeRenderClip).
        render: here("render.html"),
      },
    },
  },
});
