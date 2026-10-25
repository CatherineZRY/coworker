import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@coworker/shared": resolve("./packages/shared/src/index.ts"),
      "@coworker/core": resolve("./packages/core/src/index.ts"),
      "@coworker/adapters": resolve("./packages/adapters/src/index.ts"),
      "@coworker/daemon": resolve("./apps/daemon/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
