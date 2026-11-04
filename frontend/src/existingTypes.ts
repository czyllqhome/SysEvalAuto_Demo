export interface Evidence { id: string; content_hash: string; description: string; environment: string; system_version: string; collected_on: string }
export interface Verification { control_id: string; conclusion: string; reason: string; method: string; evidence: { source_id: string }[] }
export interface Gap { id: string; reason: string; conclusion: string; status: string; risk?: { priority: string; reason: string }; acceptance?: { reason: string; review_on: string; owner_id: string } }
export interface Plan {
  delivery_policy_version?: number; delivery_batch_id?: string;
  id: string; content_hash: string; status: string; revision: number; supplier_id: string | null; development_id?: string;
  payload: { gap_ids: string[]; owner_id: string; due_on: string; kind: string; scope: string; acceptance_criteria: string[] };
  confirmations: { party: string; actor_id: string }[]; retests: { passed: boolean; reason: string }[];
}
export interface ExistingData {
  stale?: boolean;
  scope: { scope: string; environment: string; system_version: string; as_of: string; trigger: string };
  run: { verifications: Record<string, Verification>; gaps: Record<string, Gap>; plans: Record<string, Plan>;
    reports: { id: string; summary: string; content_hash: string; statistics: { applicable: number; verified: number; satisfied: number; insufficient_evidence: number } }[];
    history: { at: number; actor_id: string; action: string; detail: unknown }[]; next_review_on?: string;
  } | null;
  evidence: Evidence[]; expired_gaps: string[]; history_revisions: number[];
}
