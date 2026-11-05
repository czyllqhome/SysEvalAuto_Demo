export interface DashboardData {
  generated_at: number
  organization: string
  summary: { total: number; new: number; existing: number; in_progress: number; complete: number; agreed: number; suppliers: number; todos: number; delivery_review: number }
  stages: { key: string; count: number }[]
  remediation: { total: number; overdue: number; states: Record<string, number>; risks: Record<string, number>; stale_assessments: number }
  suppliers: {
    id: string; name: string; systems: { id: string; name: string; status: string }[]
    awaiting_response: number; awaiting_review: number; agreed: number; gaps: number; closed: number; overdue: number
  }[]
  todos: { id: string; key: string; name: string; status: string; kind: string; href: string; updated_at: number; count: number; priority: number }[]
  levels: { key: string; count: number }[]
  departments: { name: string; count: number }[]
}
