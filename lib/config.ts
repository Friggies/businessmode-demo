export type Config = {
  apiUrl: string;
  apiKey: string;
  entitlement: string;
  origin: string;
  sessionSecret: string;
  publicCode: string;
};

export function readConfig(env: Readonly<Record<string, string | undefined>> = process.env): Config | null {
  if (!env.BUSINESSMODE_API_URL || !env.BUSINESSMODE_API_KEY || !env.DEMO_ORIGIN || !env.DEMO_SESSION_SECRET) return null;
  if (!/^[a-f0-9]{64}$/i.test(env.DEMO_SESSION_SECRET)) throw new Error("DEMO_SESSION_SECRET must be 32 random bytes encoded as hex.");
  const api = new URL(env.BUSINESSMODE_API_URL);
  const origin = new URL(env.DEMO_ORIGIN);
  for (const url of [api, origin]) {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new Error("Use HTTPS outside localhost.");
    }
    if (url.username || url.password || url.search || url.hash) throw new Error("Invalid configured URL.");
  }
  if (origin.pathname !== "/" || api.pathname.replace(/\/$/, "") !== "/v1") {
    throw new Error("DEMO_ORIGIN must be an origin; BUSINESSMODE_API_URL must end in /v1.");
  }
  return {
    apiUrl: api.href.replace(/\/$/, ""), apiKey: env.BUSINESSMODE_API_KEY,
    entitlement: env.BUSINESSMODE_ENTITLEMENT_KEY || "todo:write",
    origin: origin.origin,
    sessionSecret: env.DEMO_SESSION_SECRET,
    publicCode: env.DEMO_PUBLIC_ACCESS_CODE || "",
  };
}
