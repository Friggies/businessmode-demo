// Test process only. Production routes always use the configured BusinessMode API.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const assignments = new Map<string, string>();
createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  const url = new URL(request.url!, "http://127.0.0.1:4010");
  if (url.pathname === "/health") { response.end("{}"); return; }
  if (request.headers.authorization !== "Bearer local-test-key") { response.writeHead(401); response.end("{}"); return; }
  if (url.pathname === "/v1/access") {
    response.end(JSON.stringify({ hasAccess: assignments.has(url.searchParams.get("externalUserId")!) })); return;
  }
  if (url.pathname === "/v1/access-codes/redeem" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.code !== "TRY_BUSINESSMODE") {
      response.writeHead(404); response.end(JSON.stringify({ error: { code: "access_code_not_found", message: "Code not found" } })); return;
    }
    const assignmentId = assignments.get(body.externalUserId) || randomUUID();
    assignments.set(body.externalUserId, assignmentId);
    response.end(JSON.stringify({ accessCodeId: "demo-code", assignmentId, externalUserId: body.externalUserId,
      licenseId: "demo-license", redemptionId: "demo-redemption", redeemedAt: new Date().toISOString() })); return;
  }
  if (url.pathname.startsWith("/v1/licenses/demo-license/assignments/") && request.method === "DELETE") {
    for (const [user, assignment] of assignments) {
      if (assignment === url.pathname.split("/").at(-1)) assignments.delete(user);
    }
    response.end("{}"); return;
  }
  response.writeHead(404); response.end("{}");
}).listen(4010, "127.0.0.1", () => console.log("Local test API listening on 4010"));
