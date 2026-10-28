import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { businessmode, cleanup, externalUserId } from "../lib/businessmode";
import { readConfig, type Config } from "../lib/config";
import { createHandler } from "../lib/handler";
import { Store } from "../lib/store";

test("the packaged SDK protects the entire guest → redemption → task → reset flow", async t => {
  const grants = new Set<string>();
  const received: { method: string; path: string; body: Record<string, string> }[] = [];
  let unavailable = false;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-machine-key");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const url = new URL(req.url!, "http://localhost");
    received.push({ method: req.method!, path: url.pathname, body });
    res.setHeader("Content-Type", "application/json");
    if (unavailable) { res.writeHead(503); res.end(JSON.stringify({ error: { code: "unavailable", message: "Unavailable" } })); return; }
    if (url.pathname === "/v1/access") {
      assert.equal(url.searchParams.get("entitlementKey"), "todo:write");
      res.end(JSON.stringify({ hasAccess: grants.has(url.searchParams.get("externalUserId")!) }));
    } else if (url.pathname === "/v1/access-codes/redeem") {
      if (body.code !== "  Try_Access  ") {
        res.writeHead(404); res.end(JSON.stringify({ error: { code: "access_code_not_found", message: "Missing" } })); return;
      }
      grants.add(body.externalUserId);
      res.end(JSON.stringify({ accessCodeId: "code-1", assignmentId: body.externalUserId, externalUserId: body.externalUserId,
        licenseId: "license-1", redeemedAt: new Date().toISOString(), redemptionId: "redemption-1" }));
    } else if (req.method === "DELETE") {
      grants.delete(decodeURIComponent(url.pathname.split("/").at(-1)!));
      res.end("{}");
    } else { res.writeHead(404); res.end("{}"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const config: Config = { apiUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-machine-key", entitlement: "todo:write",
    origin: "http://localhost:3000", databasePath: ":memory:", publicCode: "  Try_Access  " };
  const store = new Store(":memory:"); t.after(() => store.close());
  const access = businessmode(config);
  const handler = createHandler(config, store, access);
  let cookie = "";
  async function call(path: string, method = "GET", body?: unknown, overrideCookie = cookie, origin = config.origin) {
    return handler(new Request(`${config.origin}/api/demo/${path}`, { method,
      headers: { Cookie: overrideCookie, Origin: origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), path.split("/"));
  }

  assert.equal((await (await call("state")).json()).session, false);
  assert.equal(received.length, 0, "anonymous page view does not consume BusinessMode capacity");
  assert.equal((await call("tasks", "POST", { title: "blocked" })).status, 401);
  assert.equal((await call("session", "POST", undefined, "", "https://attacker.example")).status, 403);
  const started = await call("session", "POST");
  assert.equal(started.status, 201);
  assert.match(started.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  cookie = started.headers.get("set-cookie")!.split(";")[0];
  const initial = await started.json();
  assert.equal(initial.tasks.length, 3);
  assert.equal(initial.hasAccess, false);
  assert.equal((await call("tasks", "POST", { title: "blocked" })).status, 403);
  assert.equal((await call("redeem", "POST", { code: "wrong" })).status, 404);
  const redeemed = await call("redeem", "POST", { code: "  Try_Access  ", externalUserId: "attacker-chosen-id" });
  assert.equal(redeemed.status, 200);
  assert.equal((await redeemed.json()).hasAccess, true);
  const redemption = received.findLast(r => r.path.endsWith("redeem"))!;
  assert.equal(redemption.body.code, "  Try_Access  ", "promo string must preserve exact whitespace and case");
  assert.match(redemption.body.externalUserId, /^todo_demo:[a-f0-9-]{36}$/);
  assert.notEqual(redemption.body.externalUserId, "attacker-chosen-id");
  assert.equal((await call("redeem", "POST", { code: "  Try_Access  " })).status, 200);
  assert.equal(grants.size, 1);
  assert.equal((await call("tasks", "POST", { title: "My task" })).status, 200);
  let current = await (await call("state")).json();
  const id = current.tasks.find((task: { title: string }) => task.title === "My task").id;
  assert.equal((await call(`tasks/${id}`, "PATCH", { done: true })).status, 200);
  current = await (await call("state")).json();
  assert.equal(current.tasks.find((task: { id: string }) => task.id === id).done, true);

  const second = await call("session", "POST", undefined, "");
  const secondCookie = second.headers.get("set-cookie")!.split(";")[0];
  await call("redeem", "POST", { code: "  Try_Access  " }, secondCookie);
  assert.equal((await call(`tasks/${id}`, "DELETE", undefined, secondCookie)).status, 404, "guests cannot delete each other's tasks");
  assert.equal((await call(`tasks/${id}`, "DELETE")).status, 200);

  unavailable = true;
  assert.equal((await call("tasks", "POST", { title: "must not be saved" })).status, 503);
  unavailable = false;
  const ownId = redemption.body.externalUserId;
  grants.delete(ownId);
  assert.equal((await call("tasks", "POST", { title: "revoked" })).status, 403, "access is rechecked after revocation");
  grants.add(ownId);
  assert.equal((await call("session", "DELETE")).status, 200);
  assert.equal((await call("tasks", "POST", { title: "old session" })).status, 401);
  unavailable = true;
  await cleanup(store, access);
  assert.equal(store.expiredAssignments().length, 1, "failed cleanup retains its retry handle");
  unavailable = false;
  await cleanup(store, access);
  assert.equal(store.expiredAssignments().length, 0);
  assert.equal(grants.has(ownId), false);
});

test("session expiry uses an absolute instant; hashes and guest isolation survive storage", () => {
  const store = new Store(":memory:");
  try {
    const now = Date.parse("2026-10-25T01:30:00Z");
    const { token, session } = store.create(now);
    assert(store.session(token, session.expires - 1));
    assert.equal(store.session(token, session.expires), undefined);
    assert.equal(store.session(token.toUpperCase(), now), undefined);
    const row = store.db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    assert.notEqual(row.token_hash, token);
    assert.equal(store.rate("limit", 1, now), true);
    assert.equal(store.rate("limit", 1, now + 1), false);
    assert.equal(store.rate("limit", 1, now + 60_000), true);
    assert.equal(store.lockRedemption(session.id, now), true);
    assert.equal(store.lockRedemption(session.id, now + 1), false);
    assert.equal(store.lockRedemption(session.id, now + 30_000), true);
    assert.match(externalUserId(session.id), /^todo_demo:/);
  } finally { store.close(); }
});

test("configuration rejects insecure remote URLs and accepts local development", () => {
  assert.equal(readConfig({}), null);
  const env = { BUSINESSMODE_API_URL: "http://localhost:4010/v1", BUSINESSMODE_API_KEY: "test", DEMO_ORIGIN: "http://localhost:3000" };
  assert.equal(readConfig(env)!.entitlement, "todo:write");
  assert.throws(() => readConfig({ ...env, BUSINESSMODE_API_URL: "http://api.example.com/v1" }));
  assert.throws(() => readConfig({ ...env, DEMO_ORIGIN: "https://demo.example.com/path" }));
  assert.throws(() => readConfig({ ...env, BUSINESSMODE_API_URL: "https://api.example.com" }));
});

test("request bounds, code validation and redemption throttling cannot be bypassed", async () => {
  const store = new Store(":memory:");
  const config: Config = { apiUrl: "http://localhost:4010/v1", apiKey: "test", entitlement: "todo:write", origin: "http://localhost:3000", databasePath: ":memory:", publicCode: "DEMO_ACCESS" };
  let attempts = 0;
  const access = { hasAccess: async () => false, redeem: async (session: string) => { attempts++; return { session, license: "l", assignment: "a" }; }, release: async () => {} };
  const handler = createHandler(config, store, access);
  const { token } = store.create();
  const call = (body: string, type = "application/json") => handler(new Request(`${config.origin}/api/demo/redeem`, {
    method: "POST", headers: { origin: config.origin, cookie: `bm_demo_session=${token}`, "Content-Type": type }, body,
  }), ["redeem"]);
  try {
    assert.equal((await call('{"code":""}')).status, 400);
    assert.equal((await call("not json")).status, 400);
    assert.equal((await call("{}", "text/plain")).status, 415);
    assert.equal((await call(JSON.stringify({ code: "a".repeat(4200) }))).status, 413);
    for (let i = 0; i < 5; i++) assert.equal((await call('{"code":"a"}')).status, 200);
    const limited = await call('{"code":"a"}');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal(attempts, 5);
  } finally { store.close(); }
});
