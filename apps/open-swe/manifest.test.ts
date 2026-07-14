import { RoleManifestSchema } from "@openorg/manifest";
import { describe, expect, it } from "vitest";
import { manifest } from "./manifest";

describe("delivery manifest", () => {
  it("validates every station and opens on the FDE workbench", () => {
    expect(RoleManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.stations?.map((station) => station.id)).toEqual([
      "fde",
      "swe",
      "mle"
    ]);
  });
});
