import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Resolve @dopamine/core straight to source so the demo needs no pre-build
// during `dev`, `build`, or the Playwright recording.
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@dopamine/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
});
