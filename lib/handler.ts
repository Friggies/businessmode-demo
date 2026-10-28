import { DemoError, type AccessService } from "./businessmode";
import type { Config } from "./config";
import { SESSION_SECONDS, type Session, type Store } from "./store";
import { sampleTasks, type DemoState } from "./types";

const cookieName = "bm_demo_session";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers },
});

export function createHandler(config: Config, store: Store, access: AccessService) {
  const cookie = (token: string, maxAge = SESSION_SECONDS) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.origin.startsWith("https:") ? "; Secure" : ""}`;
  const state = async (session?: Session): Promise<DemoState> => ({
    configured: true, session: Boolean(session), expiresAt: session ? new Date(session.expires).toISOString() : null,
    hasAccess: session ? await access.hasAccess(session.id) : false,
    tasks: session ? store.tasks(session.id) : sampleTasks, publicCode: config.publicCode,
  });

  return async function handle(request: Request, segments: string[]): Promise<Response> {
    try {
      if (request.method !== "GET" && request.headers.get("origin") !== config.origin) {
        throw new DemoError(403, "This request must come from the demo.");
      }
      const token = request.headers.get("cookie")?.split(";").map(s => s.trim())
        .find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
      const session = store.session(token);
      const route = segments.join("/");

      if (route === "state" && request.method === "GET") {
        if (session && !store.rate(`request:${session.id}`, 60)) throw new DemoError(429, "Please wait a minute before trying again.");
        return json(await state(session));
      }
      if (route === "session" && request.method === "POST") {
        if (session) return json(await state(session));
        if (!store.rate("new-session", 15)) throw new DemoError(429, "The demo is busy. Please try again in a minute.");
        store.prune();
        let created;
        try { created = store.create(); }
        catch { throw new DemoError(503, "The demo is at capacity. Please try again later."); }
        // Creating our app identity does not call BusinessMode or consume a seat.
        return json({ configured: true, session: true, expiresAt: new Date(created.session.expires).toISOString(),
          hasAccess: false, tasks: store.tasks(created.session.id), publicCode: config.publicCode },
          201, { "Set-Cookie": cookie(created.token) });
      }
      if (!session) throw new DemoError(401, "Start a guest session to continue.");
      if (!store.rate(`request:${session.id}`, 60)) throw new DemoError(429, "Please wait a minute before trying again.");
      if (route === "session" && request.method === "DELETE") {
        store.expire(session.id);
        return json(await state(), 200, { "Set-Cookie": cookie("", 0) });
      }
      if (route === "redeem" && request.method === "POST") {
        const body = await readBody(request);
        if (typeof body.code !== "string" || body.code.length < 1 || body.code.length > 512) {
          throw new DemoError(400, "Enter an access code (up to 512 characters).");
        }
        if (!store.rate(`redeem:${session.id}`, 5)) throw new DemoError(429, "Too many attempts. Please wait a minute.");
        if (!store.lockRedemption(session.id)) throw new DemoError(409, "A redemption is already in progress. Please wait.");
        try {
          const assignment = await access.redeem(session.id, body.code);
          store.rememberAssignment(assignment);
        } finally { store.unlockRedemption(session.id); }
        if (!store.session(token)) throw new DemoError(401, "This session has ended. Start a new guest session.");
        return json(await state(session));
      }
      if (segments[0] !== "tasks" || segments.length > 2 || !["POST", "PATCH", "DELETE"].includes(request.method)) {
        throw new DemoError(404, "Route not found.");
      }
      // Every task write checks access on the server, including direct HTTP calls.
      if (!await access.hasAccess(session.id)) throw new DemoError(403, "Redeem a code to change your tasks.");
      if (!store.session(token)) throw new DemoError(401, "This session has ended. Start a new guest session.");
      if (segments.length === 1 && request.method === "POST") {
        const body = await readBody(request);
        if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 160) {
          throw new DemoError(400, "Use a task title between 1 and 160 characters.");
        }
        if (!store.add(session.id, body.title.trim())) throw new DemoError(409, "This demo supports up to 30 tasks per session.");
      } else if (segments.length === 2 && request.method === "PATCH") {
        const body = await readBody(request);
        if (typeof body.done !== "boolean") throw new DemoError(400, "Choose whether the task is complete.");
        if (!store.update(session.id, segments[1], body.done)) throw new DemoError(404, "Task not found.");
      } else if (segments.length === 2 && request.method === "DELETE") {
        if (!store.remove(session.id, segments[1])) throw new DemoError(404, "Task not found.");
      } else throw new DemoError(404, "Route not found.");
      return json({ tasks: store.tasks(session.id), hasAccess: true });
    } catch (error) {
      const failure = error instanceof DemoError ? error : new DemoError(500, "The demo could not complete this request.");
      return json({ error: failure.message, ...(failure.requestId ? { requestId: failure.requestId } : {}) },
        failure.status, failure.status === 429 ? { "Retry-After": "60" } : {});
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
