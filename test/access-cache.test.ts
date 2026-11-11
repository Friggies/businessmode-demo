import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { businessmode, externalUserId } from "../lib/businessmode";

test("published SDK caches decisions, honors fresh checks and expiry, and invalidates after mutations", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-11T08:00:00Z") });
  t.mock.method(performance, "now", () => Date.now());
  const grants = new Set<string>();
  let checks = 0;
  let unavailable = false;
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/v1/access") {
      checks++;
      if (unavailable) { response.writeHead(503); response.end("{}"); return; }
      const hasAccess = grants.has(url.searchParams.get("externalUserId")!);
      const checkedAt = new Date();
      response.end(JSON.stringify({ hasAccess, checkedAt: checkedAt.toISOString(),
        cacheUntil: new Date(checkedAt.getTime() + (hasAccess ? 60_000 : 5_000)).toISOString() }));
    } else if (url.pathname === "/v1/access-codes/redeem") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      grants.add(body.externalUserId);
      response.end(JSON.stringify({ licenseId: "license", assignmentId: body.externalUserId }));
    } else if (request.method === "DELETE") {
      grants.delete(decodeURIComponent(url.pathname.split("/").at(-1)!));
      response.end("{}");
    } else { response.writeHead(404); response.end("{}"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address !== "string");
  const config = { apiUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "local-test-key",
    entitlement: "todo:write", origin: "http://localhost:3000", sessionSecret: "11".repeat(32), publicCode: "DEMO" };
  const access = businessmode(config);

  assert.equal(await access.hasAccess("guest"), false);
  assert.equal(await access.hasAccess("guest"), false);
  assert.equal(checks, 1, "repeat denials share the five-second cache");
  grants.add(externalUserId("guest"));
  t.mock.timers.tick(5_000);
  assert.equal(await access.hasAccess("guest"), true);
  assert.equal(checks, 2, "expired denial refreshes");
  grants.clear();
  t.mock.timers.tick(59_999);
  assert.equal(await access.hasAccess("guest"), true);
  assert.equal(checks, 2, "an external revocation can remain cached for one minute");
  assert.equal(await access.hasAccess("guest", { fresh: true }), false);
  assert.equal(checks, 3, "fresh bypass reaches the API");
  t.mock.timers.tick(1);
  assert.equal(await access.hasAccess("guest"), false);
  assert.equal(checks, 4, "fresh bypass clears the previous cached approval");

  const assignment = await access.redeem("guest", "DEMO");
  assert.equal(await access.hasAccess("guest"), true, "redemption invalidates the prior denial");
  assert.equal(await access.hasAccess("other-guest"), false, "guest cache entries stay separate");
  await access.release(assignment);
  assert.equal(await access.hasAccess("guest"), false, "reset/release invalidates the approval");

  await access.redeem("guest", "DEMO");
  assert.equal(await access.hasAccess("guest"), true);
  unavailable = true;
  t.mock.timers.tick(60_000);
  await assert.rejects(access.hasAccess("guest"), /temporarily unavailable/);
  await assert.rejects(access.hasAccess("guest"), /temporarily unavailable/);
  unavailable = false;
  grants.clear();
  assert.equal(await access.hasAccess("guest"), false, "an outage never extends expired access");
});
