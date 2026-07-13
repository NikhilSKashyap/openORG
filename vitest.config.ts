import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@openorg/manifest": new URL(
        "./packages/manifest/src/index.ts",
        import.meta.url
      ).pathname,
      "@openorg/conformance": new URL(
        "./packages/conformance/src/index.ts",
        import.meta.url
      ).pathname,
      "@openorg/protocol": new URL(
        "./packages/protocol/src/index.ts",
        import.meta.url
      ).pathname,
      "@openorg/sdk": new URL("./packages/sdk/src/index.ts", import.meta.url)
        .pathname,
      "@openorg/learning": new URL(
        "./packages/learning/src/index.ts",
        import.meta.url
      ).pathname,
      "@openorg/skill-spine": new URL(
        "./packages/skill-spine/src/index.ts",
        import.meta.url
      ).pathname,
      "@openorg/workbench-kit": new URL(
        "./packages/workbench-kit/src/index.tsx",
        import.meta.url
      ).pathname,
      "@openorg/store-memory": new URL(
        "./packages/store-memory/src/index.ts",
        import.meta.url
      ).pathname,
      "@openorg/store-sqlite": new URL(
        "./packages/store-sqlite/src/index.ts",
        import.meta.url
      ).pathname
    },
    conditions: ["source"]
  }
});
