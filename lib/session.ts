import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SESSION_SECONDS = 3600;
// Keep cleanup handles after access expires, so returning visitors can release
// their old assignments before starting again. No database needed.
export const COOKIE_SECONDS = 7 * 24 * 3600;
export const MAX_ASSIGNMENTS = 8;
export type Assignment = { session: string; license: string; assignment: string };
export type Session = { version: 1; id: string; expires: number; assignments: Assignment[] };

export function createSession(now = Date.now()): Session {
  return { version: 1, id: randomUUID(), expires: now + SESSION_SECONDS * 1000, assignments: [] };
}

export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function readSession(token: string, secret: string): Session | undefined {
  if (!token || token.length > 3800) return;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return;
  const actual = Buffer.from(parts[1], "base64url");
  const expected = signature(parts[0], secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return;
  try {
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (value.version !== 1 || typeof value.id !== "string" || !Number.isSafeInteger(value.expires)
      || !Array.isArray(value.assignments) || value.assignments.length > MAX_ASSIGNMENTS) return;
    if (!value.assignments.every((a: Assignment) => a && a.session === value.id
      && typeof a.license === "string" && typeof a.assignment === "string")) return;
    return value;
  } catch { return; }
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", Buffer.from(secret, "hex")).update(payload).digest();
}
