import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { businessmode } from "../lib/businessmode";
import { readConfig, type Config } from "../lib/config";
import { createHandler } from "../lib/handler";
import { createSession, readSession, signSession } from "../lib/session";
import { loadTasks, saveTasks, TASK_STORAGE_KEY } from "../lib/browser-tasks";
import { sampleTasks } from "../lib/types";

const config: Config = { apiUrl: "http://localhost:4010/v1", apiKey: "test-machine-key", entitlement: "todo:write",
  origin: "http://localhost:3000", sessionSecret: "11".repeat(32), publicCode: "  Try_Access  " };

test("real packaged SDK: signed guests, exact redemption, access checks and retryable reset across instances", async t => {
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
      if (body.code !== config.publicCode) {
        res.writeHead(404); res.end(JSON.stringify({ error: { code: "access_code_not_found", message: "Missing" } })); return;
      }
      grants.add(body.externalUserId);
      res.end(JSON.stringify({ accessCodeId: "code-1", assignmentId: body.externalUserId, externalUserId: body.externalUserId,
        licenseId: "license-1", redeemedAt: new Date().toISOString(), redemptionId: "redemption-1" }));
    } else if (req.method === "DELETE") {
      grants.delete(decodeURIComponent(url.pathname.split("/").at(-1)!)); res.end("{}");
    } else { res.writeHead(404); res.end("{}"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address !== "string");
  const configured = { ...config, apiUrl: `http://127.0.0.1:${address.port}/v1` };
  let cookie = "";
  async function call(path: string, method = "GET", body?: unknown, overrideCookie = cookie, origin = config.origin) {
    // A fresh handler/client per request proves that no process-local session state is required.
    const response = await createHandler(configured, businessmode(configured))(new Request(`${config.origin}/api/demo/${path}`, {
      method, headers: { Cookie: overrideCookie, Origin: origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), path.split("/"));
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
    return response;
  }
  assert.equal((await (await call("state")).json()).session, false);
  assert.equal(received.length, 0);
  assert.equal((await call("authorize", "POST")).status, 401);
  assert.equal((await call("session", "POST", undefined, "", "https://attacker.example")).status, 403);
  const started = await call("session", "POST"); assert.equal(started.status, 201);
  assert.match(started.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  const initial = await started.json(); assert.equal(initial.hasAccess, false);
  assert.equal(initial.tasks, undefined, "the server does not store or return tasks");
  assert.equal((await call("authorize", "POST")).status, 403);
  assert.equal((await call("redeem", "POST", { code: "wrong" })).status, 404);
  assert.equal((await call("authorize", "POST", undefined, cookie + "tampered")).status, 401);
  const redeemed = await call("redeem", "POST", { code: config.publicCode, externalUserId: "attacker-chosen-id" });
  assert.equal(redeemed.status, 200); assert.equal((await redeemed.json()).hasAccess, true);
  const redemption = received.findLast(r => r.path.endsWith("redeem"))!;
  assert.equal(redemption.body.code, config.publicCode, "preserve exact whitespace and case");
  assert.match(redemption.body.externalUserId, /^todo_demo:[a-f0-9-]{36}$/);
  assert.notEqual(redemption.body.externalUserId, "attacker-chosen-id");
  assert.equal((await call("redeem", "POST", { code: config.publicCode })).status, 200);
  assert.equal(grants.size, 1); assert.equal((await call("authorize", "POST")).status, 200);
  const signed = cookie.slice(cookie.indexOf("=") + 1);
  assert.equal(readSession(signed, config.sessionSecret)!.assignments.length, 1);
  assert.equal((await call("authorize", "POST", undefined, "")).status, 401);
  unavailable = true; assert.equal((await call("authorize", "POST")).status, 503);
  const failedReset = await call("session", "DELETE"); assert.equal(failedReset.status, 503);
  assert.equal(failedReset.headers.get("set-cookie"), null, "retain handles when release fails");
  unavailable = false;
  grants.clear(); assert.equal((await call("authorize", "POST")).status, 403, "revocation is rechecked");
  grants.add(redemption.body.externalUserId);
  assert.equal((await call("session", "DELETE")).status, 200);
  assert.equal(grants.size, 0); assert.equal((await call("authorize", "POST")).status, 401);
});

test("absolute expiry, server clock boundaries, signed-cookie tampering and key rotation", async () => {
  let now = Date.parse("2026-10-25T01:30:00Z");
  const session = createSession(now); const token = signSession(session, config.sessionSecret);
  assert.equal(readSession(token, "22".repeat(32)), undefined);
  assert.equal(readSession(token.replace(/^./, "x"), config.sessionSecret), undefined);
  assert.equal(readSession(token + ".extra", config.sessionSecret), undefined);
  assert.equal(readSession("x".repeat(4000), config.sessionSecret), undefined);
  const released: string[] = [];
  session.assignments.push({ session: session.id, license: "l", assignment: "a" });
  let crossBoundary = false;
  const access = { hasAccess: async () => { if (crossBoundary) now = session.expires; return true; },
    redeem: async () => session.assignments[0], release: async (a: { assignment: string }) => { released.push(a.assignment); } };
  const handler = createHandler(config, access, () => now);
  const call = (path: string, method = "GET") => handler(new Request(`${config.origin}/api/demo/${path}`, {
    method, headers: { origin: config.origin, cookie: `bm_demo_session=${signSession(session, config.sessionSecret)}` },
  }), [path]);
  now = session.expires - 1; assert.equal((await call("authorize", "POST")).status, 200);
  crossBoundary = true; assert.equal((await call("authorize", "POST")).status, 401);
  assert.equal((await (await call("state")).json()).hasAccess, false);
  assert.equal((await call("session", "POST")).status, 201);
  assert.deepEqual(released, ["a"], "returning visitor releases expired assignment before replacement");
});

test("configuration and JSON bounds reject malformed data without changing promo strings", async () => {
  assert.equal(readConfig({}), null);
  const env = { BUSINESSMODE_API_URL: config.apiUrl, BUSINESSMODE_API_KEY: "test", DEMO_ORIGIN: config.origin, DEMO_SESSION_SECRET: config.sessionSecret };
  assert.equal(readConfig(env)!.entitlement, "todo:write");
  assert.throws(() => readConfig({ ...env, BUSINESSMODE_API_URL: "http://api.example.com/v1" }));
  assert.throws(() => readConfig({ ...env, DEMO_ORIGIN: "https://demo.example.com/path" }));
  assert.throws(() => readConfig({ ...env, BUSINESSMODE_API_URL: "https://api.example.com" }));
  assert.throws(() => readConfig({ ...env, DEMO_SESSION_SECRET: "weak" }));
  let attempts = 0;
  const session = createSession();
  const access = { hasAccess: async () => false, redeem: async () => { attempts++; return { session: session.id, license: "l", assignment: "a" }; }, release: async () => {} };
  const handler = createHandler(config, access);
  const call = (body: string, type = "application/json") => handler(new Request(`${config.origin}/api/demo/redeem`, {
    method: "POST", headers: { origin: config.origin, cookie: `bm_demo_session=${signSession(session, config.sessionSecret)}`, "Content-Type": type }, body,
  }), ["redeem"]);
  assert.equal((await call('{"code":""}')).status, 400);
  assert.equal((await call("not json")).status, 400);
  assert.equal((await call("{}", "text/plain")).status, 415);
  assert.equal((await call(JSON.stringify({ code: "a".repeat(4200) }))).status, 413);
  assert.equal(attempts, 0);
  assert.equal((await call('{"code":"  readable code  "}')).status, 200);
});

test("redemption cleanup handle survives a failed follow-up access check", async () => {
  const session = createSession();
  const handler = createHandler(config, { hasAccess: async () => { throw new Error("upstream down"); },
    redeem: async () => ({ session: session.id, license: "l", assignment: "a" }), release: async () => {} });
  const response = await handler(new Request(`${config.origin}/api/demo/redeem`, { method: "POST",
    headers: { origin: config.origin, cookie: `bm_demo_session=${signSession(session, config.sessionSecret)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "ANY_CODE" }) }), ["redeem"]);
  assert.equal(response.status, 503);
  const token = response.headers.get("set-cookie")!.split(";")[0].slice("bm_demo_session=".length);
  assert.equal(readSession(token, config.sessionSecret)!.assignments[0].assignment, "a");
});

test("local task storage isolates guests and tolerates invalid or unavailable storage", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  const tasks = [{ id: "task-1", title: "Try the SDK", done: true }];
  saveTasks(storage, "guest-1", tasks);
  assert.deepEqual(loadTasks(storage, "guest-1"), tasks);
  assert.deepEqual(loadTasks(storage, "guest-2"), sampleTasks);
  storage.setItem(TASK_STORAGE_KEY, "not json"); assert.deepEqual(loadTasks(storage, "guest-1"), sampleTasks);
  storage.setItem(TASK_STORAGE_KEY, JSON.stringify({ sessionId: "guest-1", tasks: [tasks[0], tasks[0]] }));
  assert.deepEqual(loadTasks(storage, "guest-1"), sampleTasks);
  assert.deepEqual(loadTasks({ ...storage, getItem: () => { throw new Error("disabled"); } }, "guest-1"), sampleTasks);
});
