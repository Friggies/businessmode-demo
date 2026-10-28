import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { starterTitles, type Task } from "./types";

export const SESSION_SECONDS = 60 * 60;
export type Session = { id: string; expires: number };
export type Assignment = { session: string; license: string; assignment: string };

// The cookie is an opaque 256-bit bearer. Only its hash is stored in SQLite.
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL,
        redeem_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignments (
        session TEXT NOT NULL REFERENCES sessions(id), license TEXT NOT NULL, assignment TEXT NOT NULL,
        PRIMARY KEY (session, assignment)
      );
      CREATE TABLE IF NOT EXISTS limits (
        key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL
      );`);
  }

  rate(key: string, maximum: number, now = Date.now()) {
    const bucket = Math.floor(now / 60_000);
    const row = this.db.prepare(`INSERT INTO limits(key,bucket,count) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,
      count=CASE WHEN limits.bucket=excluded.bucket THEN limits.count+1 ELSE 1 END
      RETURNING count`).get(key, bucket) as { count: number };
    return row.count <= maximum;
  }

  create(now = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Includes expired sessions awaiting cleanup, keeping abandoned state bounded.
      const { count } = this.db.prepare("SELECT count(*) AS count FROM sessions").get() as { count: number };
      if (count >= 250) throw new Error("capacity");
      const token = randomBytes(32).toString("hex");
      const session = { id: randomUUID(), expires: now + SESSION_SECONDS * 1000 };
      this.db.prepare("INSERT INTO sessions(id,token_hash,expires) VALUES(?,?,?)")
        .run(session.id, hash(token), session.expires);
      const insert = this.db.prepare("INSERT INTO tasks(id,session,title,created) VALUES(?,?,?,?)");
      starterTitles.forEach((title, i) => insert.run(randomUUID(), session.id, title, now + i));
      this.db.exec("COMMIT");
      return { session, token };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  session(token: string, now = Date.now()): Session | undefined {
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
    return this.db.prepare("SELECT id,expires FROM sessions WHERE token_hash=? AND expires>?")
      .get(hash(token), now) as Session | undefined;
  }

  tasks(session: string): Task[] {
    const rows = this.db.prepare("SELECT id,title,done FROM tasks WHERE session=? ORDER BY created,id")
      .all(session) as { id: string; title: string; done: number }[];
    return rows.map(row => ({ ...row, done: Boolean(row.done) }));
  }

  add(session: string, title: string) {
    if (this.tasks(session).length >= 30) return false;
    this.db.prepare("INSERT INTO tasks(id,session,title,created) VALUES(?,?,?,?)")
      .run(randomUUID(), session, title, Date.now());
    return true;
  }

  update(session: string, id: string, done: boolean) {
    return this.db.prepare("UPDATE tasks SET done=? WHERE id=? AND session=?").run(Number(done), id, session).changes > 0;
  }

  remove(session: string, id: string) {
    return this.db.prepare("DELETE FROM tasks WHERE id=? AND session=?").run(id, session).changes > 0;
  }

  lockRedemption(session: string, now = Date.now()) {
    return this.db.prepare("UPDATE sessions SET redeem_until=? WHERE id=? AND redeem_until<=? AND expires>?")
      .run(now + 30_000, session, now, now).changes > 0;
  }
  unlockRedemption(session: string) {
    this.db.prepare("UPDATE sessions SET redeem_until=0 WHERE id=?").run(session);
  }
  rememberAssignment(value: Assignment) {
    this.db.prepare("INSERT OR IGNORE INTO assignments(session,license,assignment) VALUES(?,?,?)")
      .run(value.session, value.license, value.assignment);
  }
  expire(session: string, now = Date.now()) {
    this.db.prepare("UPDATE sessions SET expires=? WHERE id=?").run(now, session);
    this.db.prepare("DELETE FROM tasks WHERE session=?").run(session);
  }
  expiredAssignments(limit = 5, now = Date.now()): Assignment[] {
    return this.db.prepare(`SELECT a.* FROM assignments a JOIN sessions s ON s.id=a.session
      WHERE s.expires<=? AND s.redeem_until<=? ORDER BY s.expires LIMIT ?`)
      .all(now, now, limit) as Assignment[];
  }
  forgetAssignment(value: Assignment) {
    this.db.prepare("DELETE FROM assignments WHERE session=? AND assignment=?").run(value.session, value.assignment);
  }
  prune(now = Date.now()) {
    this.db.prepare("DELETE FROM tasks WHERE session IN (SELECT id FROM sessions WHERE expires<=?)").run(now);
    // Grace period lets in-flight redemption finish and persist its cleanup handle.
    this.db.prepare(`DELETE FROM sessions WHERE expires<? AND redeem_until<=?
      AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.session=sessions.id)`)
      .run(now - 600_000, now);
    this.db.prepare("DELETE FROM limits WHERE bucket<?").run(Math.floor(now / 60_000) - 2);
  }
  close() { this.db.close(); }
}

function hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
