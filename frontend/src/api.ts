import type { Board, Stats, Task, User } from "./types";
let token = localStorage.getItem("token") ?? "";
export const setToken = (t: string) => { token = t; t ? localStorage.setItem("token", t) : localStorage.removeItem("token"); };
export const hasToken = () => !!token;

async function req<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch("/api" + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (r.status === 401 && token) { setToken(""); location.reload(); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.status === 204 ? (undefined as T) : r.json();
}
export const api = {
  auth: (mode: "login" | "register", b: object) => req<{ token: string }>(`/auth/${mode}`, "POST", b),
  users: () => req<User[]>("/users"),
  boards: () => req<{ id: number; name: string }[]>("/boards"),
  createBoard: (name: string) => req<{ id: number }>("/boards", "POST", { name }),
  board: (id: number) => req<Board>(`/boards/${id}`),
  addTask: (colId: number, title: string) => req<Task>(`/columns/${colId}/tasks`, "POST", { title }),
  updateTask: (id: number, p: Partial<Task>) => req<Task>(`/tasks/${id}`, "PATCH", p),
  analytics: (id: number) => req<Stats>(`/boards/${id}/analytics`),
  addMember: (id: number, email: string, role: string) => req<void>(`/boards/${id}/members`, "POST", { email, role }),
  deleteTask: (id: number) => req<void>(`/tasks/${id}`, "DELETE"),
  moveTask: (id: number, columnId: number, index: number) => req<void>(`/tasks/${id}/move`, "POST", { columnId, index }),
};
