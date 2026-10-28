import { DemoError, type AccessService } from "./businessmode";
import type { Config } from "./config";
import { COOKIE_SECONDS, MAX_ASSIGNMENTS, createSession, readSession, signSession, type Session } from "./session";
import type { DemoState } from "./types";

const cookieName = "bm_demo_session";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers },
});

export function createHandler(config: Config, access: AccessService, now = Date.now) {
  const cookie = (token: string, maxAge = COOKIE_SECONDS) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.origin.startsWith("https:") ? "; Secure" : ""}`;
  const active = (session?: Session): session is Session => Boolean(session && now() < session.expires);
  const state = async (session?: Session): Promise<DemoState> => {
    const hasAccess = active(session) ? await access.hasAccess(session.id) : false;
    // An upstream request can cross the expiry boundary. Use only server time.
    const valid = active(session);
    return { configured: true, session: valid, sessionId: valid ? session.id : null,
      expiresAt: valid ? new Date(session.expires).toISOString() : null,
      hasAccess: valid && hasAccess, publicCode: config.publicCode };
  };
  const release = async (session?: Session) => {
    for (const assignment of session?.assignments || []) await access.release(assignment);
  };

  return async function handle(request: Request, segments: string[]): Promise<Response> {
    const headers: Record<string, string> = {};
    try {
      if (request.method !== "GET" && request.headers.get("origin") !== config.origin) {
        throw new DemoError(403, "This request must come from the demo.");
      }
      const token = request.headers.get("cookie")?.split(";").map(s => s.trim())
        .find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
      const session = readSession(token, config.sessionSecret);
      const route = segments.join("/");

      if (route === "state" && request.method === "GET") return json(await state(session));
      if (route === "session" && request.method === "POST") {
        if (active(session)) return json(await state(session));
        await release(session); // Retryable: do not discard handles on failure.
        const created = createSession(now());
        return json({ configured: true, session: true, sessionId: created.id,
          expiresAt: new Date(created.expires).toISOString(), hasAccess: false, publicCode: config.publicCode },
          201, { "Set-Cookie": cookie(signSession(created, config.sessionSecret)) });
      }
      if (route === "session" && request.method === "DELETE") {
        await release(session);
        return json(await state(), 200, { "Set-Cookie": cookie("", 0) });
      }
      if (!active(session)) throw new DemoError(401, "This session has ended. Start a new guest session.");
      if (route === "redeem" && request.method === "POST") {
        const body = await readBody(request);
        if (typeof body.code !== "string" || body.code.length < 1 || body.code.length > 512) {
          throw new DemoError(400, "Enter an access code (up to 512 characters).");
        }
        if (session.assignments.length >= MAX_ASSIGNMENTS) {
          throw new DemoError(409, "Reset this demo before redeeming more codes.");
        }
        const assignment = await access.redeem(session.id, body.code);
        if (!session.assignments.some(a => a.license === assignment.license && a.assignment === assignment.assignment)) {
          session.assignments.push(assignment);
        }
        // Save the cleanup handle even if the following access check fails.
        headers["Set-Cookie"] = cookie(signSession(session, config.sessionSecret));
        return json(await state(session), 200, headers);
      }
      if (route === "authorize" && request.method === "POST") {
        if (!await access.hasAccess(session.id)) throw new DemoError(403, "Redeem a code to change your tasks.");
        if (!active(session)) throw new DemoError(401, "This session has ended. Start a new guest session.");
        // The browser owns the actual tasks. This endpoint demonstrates a real
        // server-side entitlement check, not server-side task persistence.
        return json({ hasAccess: true });
      }
      throw new DemoError(404, "Route not found.");
    } catch (error) {
      const failure = error instanceof DemoError ? error : new DemoError(503, "The demo could not complete this request. Please try again.");
      return json({ error: failure.message, ...(failure.requestId ? { requestId: failure.requestId } : {}) },
        failure.status, { ...headers, ...(failure.status === 429 ? { "Retry-After": "60" } : {}) });
    }
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new DemoError(415, "Send JSON data.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new DemoError(400, "Missing request data.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new DemoError(413, "Request is too large."); }
    chunks.push(value);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new DemoError(400, "Send a valid JSON object."); }
}
