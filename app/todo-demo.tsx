"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { loadTasks, saveTasks, TASK_STORAGE_KEY } from "../lib/browser-tasks";
import { sampleTasks, type DemoState, type Task } from "../lib/types";

const initial: DemoState & { tasks: Task[] } = { configured: false, session: false, sessionId: null, expiresAt: null, hasAccess: false, tasks: sampleTasks, publicCode: "" };

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

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/demo/state", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load the demo.");
        let tasks = sampleTasks;
        try { if (body.sessionId) tasks = loadTasks(window.localStorage, body.sessionId); } catch { /* Memory-only fallback. */ }
        setState({ ...body, tasks });
        setCode(body.publicCode || "");
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
      const taskAction = path.startsWith("tasks");
      if (action === "add" && state.tasks.length >= 30) throw new Error("This demo supports up to 30 tasks.");
      const response = await fetch(`/api/demo/${taskAction ? "authorize" : path}`, {
        method: taskAction ? "POST" : method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: taskAction || body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) setState(previous => ({ ...previous, session: false, sessionId: null, hasAccess: false, expiresAt: null, tasks: sampleTasks }));
        if (response.status === 403 || response.status === 503) setState(previous => ({ ...previous, hasAccess: false }));
        throw new Error(result.error || "Something went wrong. Please try again.");
      }
      let tasks = state.tasks;
      if (taskAction) {
        const id = path.split("/")[1];
        if (method === "POST") tasks = [...tasks, { id: crypto.randomUUID(), title: title.trim(), done: false }];
        if (method === "PATCH") tasks = tasks.map(task => task.id === id ? { ...task, done: (body as { done: boolean }).done } : task);
        if (method === "DELETE") tasks = tasks.filter(task => task.id !== id);
      }
      if (action === "start" || action === "reset" || result.session === false) tasks = sampleTasks;
      const next = { ...state, ...result, tasks };
      setState(next);
      if (action === "start") setCode(result.publicCode || "");
      try {
        if (action === "reset") window.localStorage.removeItem(TASK_STORAGE_KEY);
        else if (next.sessionId) saveTasks(window.localStorage, next.sessionId, tasks);
      } catch { setProblem("Browser storage is unavailable. Your tasks will last until you reload this page."); }
      if (action === "redeem") setMessage(result.hasAccess ? "Access granted. Try adding or completing a task." : "Code redeemed, but it does not grant task editing.");
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
    <section className="test-guide" aria-labelledby="test-title">
      <h2 id="test-title">How to test</h2>
      <ol className="test-steps">
        <li className={!state.session ? "current" : "finished"} aria-current={!state.session ? "step" : undefined}>
          <h3>Start a guest session</h3>
          <p>No email or account needed.</p>
          {!state.session ? <button className="button" type="button" disabled={busy || !state.configured} onClick={() => void act("start", "POST", "session")}>{pending === "start" ? "Starting…" : loading ? "Loading…" : "Start demo"}</button> : <span className="step-done">Guest session ready</span>}
        </li>
        <li className={state.hasAccess ? "finished" : state.session ? "current" : ""} aria-current={state.session && !state.hasAccess ? "step" : undefined}>
          <h3>Redeem the demo code</h3>
          <p>{state.hasAccess ? "BusinessMode has granted task editing." : "The code is ready for you. Redeem it to unlock the list."}</p>
          {state.session && !state.hasAccess ? <form className="redeem-form" onSubmit={redeem}>
            <label className="sr-only" htmlFor="access-code">Access code</label>
            <input id="access-code" required autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" maxLength={512} value={code} onChange={event => setCode(event.target.value)} disabled={busy}/>
            <button className="button" type="submit" disabled={busy || !code}>{pending === "redeem" ? "Redeeming…" : "Redeem code"}</button>
            {state.publicCode && code !== state.publicCode ? <button className="text-button" type="button" disabled={busy} onClick={() => setCode(state.publicCode)}>Restore demo code</button> : null}
          </form> : null}
        </li>
        <li className={state.hasAccess ? "current" : ""} aria-current={state.hasAccess ? "step" : undefined}>
          <h3>Try the list</h3>
          <p>Add a task, tick one off, or delete it. Reset to try again.</p>
          {state.session ? <button className="text-button reset-button" type="button" disabled={busy} onClick={() => void act("reset", "DELETE", "session")}>{pending === "reset" ? "Resetting…" : "Reset demo"}</button> : null}
        </li>
      </ol>
      {!loading && !state.configured ? <p className="setup-notice">This demo is not connected yet. Follow the setup guide in the source repository.</p> : null}
      <div className="feedback" aria-live="polite" aria-atomic="true">
        {problem ? <p className="error">{problem}</p> : message ? <p>{message}</p> : null}
      </div>
    </section>

    <section className="task-panel" aria-labelledby="list-title" aria-busy={Boolean(pending)}>
      <div className="list-heading"><h2 id="list-title">Today’s list</h2><span className={`access-label ${state.hasAccess ? "unlocked" : ""}`}>{state.hasAccess ? "Unlocked" : "Locked"}</span></div>
      <form className="task-composer" onSubmit={add}>
        <label className="sr-only" htmlFor="new-task">New task</label>
        <input id="new-task" placeholder="Add something to do" maxLength={160} value={title} onChange={event => setTitle(event.target.value)} disabled={!editable} />
        <button className="button" type="submit" disabled={!editable || !title.trim()}>{pending === "add" ? "Adding…" : "Add task"}</button>
      </form>
      <ul className="task-list" aria-label="Your tasks">
        {state.tasks.map(task => <li key={task.id} className={task.done ? "task complete" : "task"}>
          <label className="task-check"><input type="checkbox" checked={task.done} disabled={!editable} onChange={event => void act(`task-${task.id}`, "PATCH", `tasks/${task.id}`, { done: event.target.checked })}/><span>{task.title}</span></label>
          <button className="icon-button" type="button" aria-label={`Delete ${task.title}`} disabled={!editable} onClick={() => void act(`task-${task.id}`, "DELETE", `tasks/${task.id}`)}><TrashIcon /></button>
        </li>)}
      </ul>
      {state.tasks.length === 0 ? <p className="empty-list">All clear. Add a task to keep exploring.</p> : null}
      <p className="list-note">{state.hasAccess ? "Your changes stay in this browser." : "Start the demo and redeem the code to edit."}</p>
    </section>
  </div>;
}
