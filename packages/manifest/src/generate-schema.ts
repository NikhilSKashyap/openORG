import { mkdir, writeFile } from "node:fs/promises";
import { roleManifestJsonSchema } from "./index.js";

await mkdir(new URL("../schemas", import.meta.url), { recursive: true });
await writeFile(
  new URL("../schemas/role-manifest.json", import.meta.url),
  `${JSON.stringify(roleManifestJsonSchema(), null, 2)}\n`
);
