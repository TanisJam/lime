import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, open: false },
  // @lime/* packages are consumed from their built dist via workspace symlinks.
  // Run `pnpm build` at the repo root after changing core/renderer/styles.
  optimizeDeps: {
    include: ["tone"],
  },
});
