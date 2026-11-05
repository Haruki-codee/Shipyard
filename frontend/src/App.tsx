import { useEffect, useState } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import ReactMarkdown from "react-markdown";
import { api, hasToken, setToken } from "./api";
import type { Board, Stats, Task, User } from "./types";

function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const submit = async () => {
    try { setToken((await api.auth(mode, f)).token); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="login">
      <h1>Shipyard</h1>
      {mode === "register" && <input placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}
      <input placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <input placeholder="Password" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      {err && <p className="err">{err}</p>}
      <button onClick={submit}>{mode === "login" ? "Sign in" : "Create account"}</button>
      <a onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}</a>
    </div>
  );
}

function TaskModal({ task, users, onSave, onDelete, onClose }: {
  task: Task; users: User[]; onSave: (p: Partial<Task>) => void; onDelete: () => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description);
  const [who, setWho] = useState<number | null>(task.assigneeId);
  const [prio, setPrio] = useState(task.priority);
  const [due, setDue] = useState(task.dueDate ?? "");
  const [labels, setLabels] = useState(task.labels);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <input className="title" value={title} onChange={e => setTitle(e.target.value)} />
        <select value={who ?? ""} onChange={e => setWho(e.target.value ? +e.target.value : null)}>
          <option value="">Unassigned</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <div className="meta">
          <select value={prio} onChange={e => setPrio(e.target.value)}>
            {["low", "medium", "high", "critical"].map(p => <option key={p}>{p}</option>)}
          </select>
          <input type="date" value={due} onChange={e => setDue(e.target.value)} />
          <input placeholder="Labels: bug, deploy" value={labels} onChange={e => setLabels(e.target.value)} />
        </div>
        <div className="split">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Describe the task in Markdown" />
          <div className="md"><ReactMarkdown>{desc || "*Preview appears here*"}</ReactMarkdown></div>
        </div>
        <div className="row">
          <button className="danger" onClick={onDelete}>Delete task</button>
          <button onClick={() => onSave({ title, description: desc, assigneeId: who, priority: prio, dueDate: due || null, labels })}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

function BoardView({ boardId }: { boardId: number }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState<Task | null>(null);
  const [q, setQ] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [inv, setInv] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const load = () => { api.board(boardId).then(setBoard); api.analytics(boardId).then(setStats); };
  useEffect(() => { load(); api.users().then(setUsers); }, [boardId]);
  if (!board) return <p className="pad">Loading board…</p>;

  const onDragEnd = async ({ source, destination, draggableId }: DropResult) => {
    if (!destination || (source.droppableId === destination.droppableId && source.index === destination.index)) return;
    const prev = board;
    const cols = board.columns.map(c => ({ ...c, tasks: [...c.tasks] }));
    const from = cols.find(c => String(c.id) === source.droppableId)!;
    const to = cols.find(c => String(c.id) === destination.droppableId)!;
    const [moved] = from.tasks.splice(source.index, 1);
    to.tasks.splice(destination.index, 0, { ...moved, columnId: to.id });
    setBoard({ ...board, columns: cols });           // optimistic update
    try { await api.moveTask(+draggableId, to.id, destination.index); load(); }
    catch { setBoard(prev); }                         // roll back on failure
  };
  const add = async (colId: number) => {
    const t = drafts[colId]?.trim(); if (!t) return;
    await api.addTask(colId, t); setDrafts({ ...drafts, [colId]: "" }); load();
  };
  const match = (t: Task) => !q || (t.title + " " + t.labels + " " + (users.find(u => u.id === t.assigneeId)?.name ?? "")).toLowerCase().includes(q.toLowerCase());
  const name = (id: number | null) => users.find(u => u.id === id)?.name;

  return (
    <div className="layout">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="columns">
          {board.columns.map(col => (
            <section key={col.id} className="col">
              <h2>{col.title} <span>{col.tasks.length}</span></h2>
              <Droppable droppableId={String(col.id)}>
                {(p, snap) => (
                  <div ref={p.innerRef} {...p.droppableProps} className={"drop" + (snap.isDraggingOver ? " over" : "")}>
                    {col.tasks.map((t, i) => (
                      <Draggable key={t.id} draggableId={String(t.id)} index={i} isDragDisabled={board.role === "viewer"}>
                        {(p, s) => (
                          <article ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps}
                            className={"card" + (s.isDragging ? " dragging" : "") + (match(t) ? "" : " dim")} onClick={() => setOpen(t)}>
                            <b>{t.title}</b>
                            <span className={"badge " + t.priority}>{t.priority}</span>
                            {t.dueDate && <span className={"badge" + (t.dueDate < new Date().toISOString().slice(0, 10) ? " late" : "")}>Due {t.dueDate}</span>}
                            {t.labels && <small>{t.labels}</small>}
                            {name(t.assigneeId) && <small>{name(t.assigneeId)}</small>}
                          </article>
                        )}
                      </Draggable>
                    ))}
                    {p.placeholder}
                  </div>
                )}
              </Droppable>
              {board.role !== "viewer" && <input className="add" placeholder="Add a task" value={drafts[col.id] ?? ""}
                onChange={e => setDrafts({ ...drafts, [col.id]: e.target.value })}
                onKeyDown={e => e.key === "Enter" && add(col.id)} />}
            </section>
          ))}
        </div>
      </DragDropContext>
      <aside className="audit">
        <input placeholder="Filter by text, label or person" value={q} onChange={e => setQ(e.target.value)} />
        {board.role === "owner" && <div className="invite"><input placeholder="Invite by email" value={inv} onChange={e => setInv(e.target.value)} />
          <button onClick={async () => { await api.addMember(board.id, inv, "editor"); setInv(""); load(); }}>Invite</button></div>}
        {stats && <div className="stats"><h2>Insights</h2>
          {stats.perColumn.map(c => <div key={c.title}><small>{c.title}: {c.count}</small><div className="bar" style={{ width: `${Math.min(100, c.count * 20)}%` }} /></div>)}
          <p>Overdue tasks: <b>{stats.overdue}</b></p>
          <small>Deployed per week: {stats.deployedPerWeek.map(w => `${w.week} (${w.count})`).join(", ") || "none yet"}</small></div>}
        <h2>Activity</h2>
        {board.audit.map(a => (
          <p key={a.id}><b>{a.user}</b> {a.action.replace(".", " ")}<br /><span>{a.detail}</span></p>
        ))}
      </aside>
      {open && <TaskModal task={open} users={users} onClose={() => setOpen(null)}
        onSave={async p => { await api.updateTask(open.id, p); setOpen(null); load(); }}
        onDelete={async () => { await api.deleteTask(open.id); setOpen(null); load(); }} />}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [boardId, setBoardId] = useState<number | null>(null);
  useEffect(() => {
    if (!authed) return;
    api.boards().then(async bs => setBoardId(bs[0]?.id ?? (await api.createBoard("Platform team")).id));
  }, [authed]);
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <>
      <header><h1>Shipyard</h1><button onClick={() => { setToken(""); setAuthed(false); }}>Sign out</button></header>
      {boardId && <BoardView boardId={boardId} />}
    </>
  );
}
