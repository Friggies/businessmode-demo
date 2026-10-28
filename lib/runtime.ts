import "server-only";
import { readConfig } from "./config";
import { businessmode, cleanup } from "./businessmode";
import { Store } from "./store";
import { createHandler } from "./handler";

function createRuntime() {
  const config = readConfig();
  if (!config) return null;
  const store = new Store(config.databasePath);
  const access = businessmode(config);
  let cleaning = false;
  return {
    handle: createHandler(config, store, access),
    async cleanup() {
      if (cleaning) return;
      cleaning = true;
      try { await cleanup(store, access); } finally { cleaning = false; }
    },
  };
}
const globalRuntime = globalThis as typeof globalThis & { demoRuntime?: ReturnType<typeof createRuntime> };
export function getRuntime() {
  if (globalRuntime.demoRuntime === undefined) globalRuntime.demoRuntime = createRuntime();
  return globalRuntime.demoRuntime;
}
