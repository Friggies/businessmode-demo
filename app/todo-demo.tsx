"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { sampleTasks, type DemoState } from "../lib/types";

const initial: DemoState = { configured: false, session: false, expiresAt: null, hasAccess: false, tasks: sampleTasks, publicCode: "" };

function LockIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path d="M12 14v3"/></svg>;
}
function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>;
}

export function TodoDemo() {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const inFlight = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/demo/state", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load the demo.");
        setState(body);
      })
      .catch(error => { if (error.name !== "AbortError") setProblem(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function act(action: string, method: string, path: string, body?: unknown) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(action); setProblem(""); setMessage("");
    try {
      const response = await fetch(`/api/demo/${path}`, {
        method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) setState(previous => ({ ...previous, session: false, hasAccess: false, expiresAt: null, tasks: sampleTasks }));
        if (response.status === 403 || response.status === 503) setState(previous => ({ ...previous, hasAccess: false }));
        throw new Error(result.error || "Something went wrong. Please try again.");
      }
      setState(previous => ({ ...previous, ...result }));
      if (action === "redeem") setMessage(result.hasAccess ? "Access granted. Make this list your own." : "Code redeemed, but it does not grant task editing.");
      if (action === "reset") { setCode(""); setTitle(""); setMessage("Demo reset. Start a fresh session whenever you like."); }
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not reach the demo. Please try again.");
      return false;
    } finally { inFlight.current = false; setPending(""); }
  }

  const busy = loading || Boolean(pending);
  const editable = state.session && state.hasAccess && !busy;
  const redeem = (event: FormEvent) => { event.preventDefault(); void act("redeem", "POST", "redeem", { code }); };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await act("add", "POST", "tasks", { title })) setTitle("");
  };

  return <div className="demo-grid">
    <section className="todo-column" aria-labelledby="list-title">
      <div className="list-heading"><h1 id="list-title">Today’s list</h1><p>A simple app. Real access control.</p></div>
      <div className="task-panel" aria-busy={Boolean(pending)}>
        <form className="task-composer" onSubmit={add}>
          <label className="sr-only" htmlFor="new-task">New task</label>
          <input id="new-task" placeholder="What needs doing?" maxLength={160} value={title} onChange={event => setTitle(event.target.value)} disabled={!editable} />
          <button className="button" type="submit" disabled={!editable || !title.trim()}>{pending === "add" ? "Adding…" : "Add task"}</button>
        </form>
        <ul className="task-list" aria-label="Your tasks">
          {state.tasks.map(task => <li key={task.id} className={task.done ? "task complete" : "task"}>
            <label className="task-check"><input type="checkbox" checked={task.done} disabled={!editable} onChange={event => void act(`task-${task.id}`, "PATCH", `tasks/${task.id}`, { done: event.target.checked })}/><span>{task.title}</span></label>
            <button className="icon-button" type="button" aria-label={`Delete ${task.title}`} disabled={!editable} onClick={() => void act(`task-${task.id}`, "DELETE", `tasks/${task.id}`)}><TrashIcon /></button>
          </li>)}
        </ul>
        {state.tasks.length === 0 ? <p className="empty-list">A clear list. Add something you’d like to do.</p> : null}
        <p className="list-note"><LockIcon />{state.hasAccess ? "Access granted. Every task change is checked on the server." : "Redeem a code to add, complete, and delete tasks."}</p>
      </div>
    </section>

    <aside className="access-panel" aria-labelledby="access-title">
      <h2 id="access-title">Unlock the demo</h2>
      <p className={`session-status ${state.session ? "ready" : ""}`}><span aria-hidden="true"/>{loading ? "Loading demo…" : state.session ? "Guest session ready" : "No account needed"}</p>
      <p className="access-intro">Your app handles identity.<br/>{" "}BusinessMode handles access.</p>
      {!loading && !state.configured ? <p className="setup-notice">This demo is not connected yet. Configure the server using the setup guide in the source repository.</p> : null}
      {!state.session ? <button className="button primary start-button" type="button" disabled={busy || !state.configured} onClick={() => void act("start", "POST", "session")}>{pending === "start" ? "Starting…" : "Start guest session"}</button> : null}
      <form className="redeem-form" onSubmit={redeem}>
        <label htmlFor="access-code">Access code</label>
        <input ref={codeInput} id="access-code" required autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" maxLength={512} placeholder={state.publicCode || "Enter an access code"} value={code} onChange={event => setCode(event.target.value)} disabled={busy || !state.session}/>
        {state.publicCode ? <button className="text-button use-code" type="button" disabled={busy || !state.session} onClick={() => { setCode(state.publicCode); codeInput.current?.focus(); }}>Use demo code</button> : null}
        <button className="button primary" type="submit" disabled={busy || !state.session}>{pending === "redeem" ? "Redeeming…" : "Redeem code"}</button>
      </form>
      <div className="feedback" aria-live="polite" aria-atomic="true">
        {problem ? <p className="error">{problem}</p> : message ? <p className="success">{message}</p> : null}
      </div>
      <div className="access-summary"><p>Access: <strong>{state.hasAccess ? "granted" : "not granted"}</strong></p><button className="text-button" type="button" disabled={busy || !state.session} onClick={() => void act("reset", "DELETE", "session")}>{pending === "reset" ? "Resetting…" : "Reset demo"}</button></div>
    </aside>
  </div>;
}
