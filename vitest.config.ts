import { defineConfig } from "vitest/config"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@opentui/solid",
  },
  resolve: {
    alias: {
      "@opencode/plugin/tui": new URL(
        "./packages/opencode/src/test-plugin-stub.ts",
        import.meta.url,
      ).pathname,
      "@opentui/solid/jsx-runtime": new URL(
        "./packages/opencode/src/jsx-test-stub.ts",
        import.meta.url,
      ).pathname,
      "@opentui/solid/jsx-dev-runtime": new URL(
        "./packages/opencode/src/jsx-test-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
  },
})
