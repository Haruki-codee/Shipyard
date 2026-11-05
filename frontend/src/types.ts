export interface Task { id: number; columnId: number; title: string; description: string; assigneeId: number | null; priority: string; dueDate: string | null; labels: string }
export interface Column { id: number; title: string; tasks: Task[] }
export interface AuditEntry { id: number; user: string; action: string; detail: string; at: string }
export interface Board { id: number; name: string; role: "owner" | "editor" | "viewer"; columns: Column[]; audit: AuditEntry[] }
export interface User { id: number; name: string }
export interface Stats { perColumn: { title: string; count: number }[]; overdue: number; deployedPerWeek: { week: string; count: number }[] }
