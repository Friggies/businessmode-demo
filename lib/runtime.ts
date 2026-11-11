import "server-only";
import { readConfig } from "./config";
import { businessmode } from "./businessmode";
import { createHandler } from "./handler";

let runtime: { handle: ReturnType<typeof createHandler> } | undefined;

// Reuse the SDK's bounded decision cache within this server process. Guest
// identity stays in signed cookies, so requests also work across instances.
export function getRuntime() {
  if (runtime) return runtime;
  const config = readConfig();
  if (!config) return null;
  runtime = { handle: createHandler(config, businessmode(config)) };
  return runtime;
}
