import { SqliteStore } from "@openorg/store-sqlite";
import { createServer } from "./app.js";
import { securityConfigFromEnvironment } from "./security.js";

const app = createServer(
  new SqliteStore(),
  undefined,
  {},
  {},
  {
    security: securityConfigFromEnvironment()
  }
);
await app.listen({
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 4700)
});
