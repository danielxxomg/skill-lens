import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@opencode/plugin/tui": new URL(
        "./packages/opencode/src/test-plugin-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
  },
})
