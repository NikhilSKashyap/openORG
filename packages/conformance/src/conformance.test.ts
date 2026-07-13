import { afterAll, describe, expect, it } from "vitest";
import { createMemoryStoreProvider } from "@openorg/store-memory";
import { createSqliteStoreProvider } from "@openorg/store-sqlite";
import type { StoreProvider } from "@openorg/sdk";
import { runConformance } from "./index.js";
const providers: StoreProvider[] = [
  createMemoryStoreProvider(),
  createSqliteStoreProvider(":memory:")
];
afterAll(async () =>
  Promise.all(providers.map(async (provider) => provider.store.close?.()))
);
describe.each(providers)("$manifest.id conformance", (provider) => {
  it("preserves every required semantic", async () => {
    expect((await runConformance(provider)).checks).toHaveLength(23);
  });
});
