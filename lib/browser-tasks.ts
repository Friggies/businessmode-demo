import { sampleTasks, type Task } from "./types";

export const TASK_STORAGE_KEY = "businessmode-demo:tasks:v1";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function loadTasks(storage: Storage, sessionId: string): Task[] {
  try {
    const raw = storage.getItem(TASK_STORAGE_KEY);
    if (!raw || raw.length > 30_000) return sampleTasks;
    const value = JSON.parse(raw);
    if (value.sessionId !== sessionId || !Array.isArray(value.tasks) || value.tasks.length > 30) return sampleTasks;
    if (!value.tasks.every((task: Task) => task && typeof task.id === "string" && task.id.length <= 64
      && typeof task.title === "string" && task.title.trim() && task.title.length <= 160 && typeof task.done === "boolean")) return sampleTasks;
    if (new Set(value.tasks.map((task: Task) => task.id)).size !== value.tasks.length) return sampleTasks;
    return value.tasks;
  } catch { return sampleTasks; }
}

export function saveTasks(storage: Storage, sessionId: string, tasks: Task[]) {
  storage.setItem(TASK_STORAGE_KEY, JSON.stringify({ sessionId, tasks }));
}
