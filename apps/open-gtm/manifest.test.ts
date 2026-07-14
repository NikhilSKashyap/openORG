import { describe, expect, it } from "vitest";
import { RoleManifestSchema } from "@openorg/manifest";
import { manifest } from "./manifest";
describe("GTM manifest", () =>
  it("validates", () =>
    expect(RoleManifestSchema.safeParse(manifest).success).toBe(true)));
