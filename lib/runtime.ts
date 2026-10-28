import "server-only";
import { readConfig } from "./config";
import { businessmode } from "./businessmode";
import { createHandler } from "./handler";

// No filesystem writes, mutable session maps or database connections. Requests
// work across independent serverless instances using the same signing secret.
export function getRuntime() {
  const config = readConfig();
  return config ? { handle: createHandler(config, businessmode(config)) } : null;
}
