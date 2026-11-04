export type Locale = 'zh' | 'en'
export type Mode = 'local' | 'openrouter'
export interface User { id: string; name: string; email: string; role: 'owner' | 'vendor' | 'member'; org_id: string; can_create?: boolean; organization_role?: string; is_admin?: boolean; must_change_password?: boolean; username?: string; projects?: { id: string; name: string; roles: string[] }[] }
export interface Session { user: User; csrf: string; model_configured: boolean }
export interface Classification { controls_ready?: boolean; missing_frameworks?: string[]; frameworks?: string[]; catalog_id?: string | null; scheme?: string; facts?: Record<string, string | string[] | number>; assessment_profile?: string; mode?: string; effective_level?: string; recommended_level?: string | null; reason?: string; answers?: Record<string, string>; exceptions?: { code: string; questions?: string[] }[] }
export interface ContextItem { id: string; title: string; description: string; source_blocks: string[] }
export interface Brief {
  summary: string; functions: ContextItem[]; departments: string[]; roles: string[]; owner_role: string;
  workflow: string; data_notes: string; integrations: string; constraints: string; scope: string;
  questions: string[]; grading_facts: Record<string, 'L1' | 'L2' | 'L3' | 'unknown'>
  applicability_tags?: Record<string, 'yes' | 'no' | 'unknown'>
}
export interface Control {
  id: string; code: string; domain: string; levels: string[]; required: boolean; catalog_id: string;
  translations: Record<string, { title: string; description: string; verification: string }>;
  selection_id?: string; included?: boolean; reason?: string; origin?: string;
  metadata?: { source_framework?: string; source_level?: number | null; source_ref?: string; responsibility_rule?: string; topic_tags?: string[] };
  match?: { status: string; reason: string; answer_refs: string[]; fact_values: Record<string, unknown>; responsibility: string };
}
export interface Requirement {
  id: string; title: string; description: string; origin: 'business' | 'control' | 'both'; priority: string;
  source_context_item_ids: string[]; source_control_ids: string[]; acceptance_criteria: string[]; dependencies: string[];
}
export interface PrdData { title: string; summary: string; requirements: Requirement[]; assumptions: string[]; open_questions: string[] }
export interface Answer {
  implementation_status: 'yes' | 'partial' | 'no' | 'needs_clarification'; duration_workdays: number | null;
  owner_name: string; implementation_plan: string; limitations: string; alternative: string;
  estimated_start_date?: string | null; estimated_finish_date?: string | null;
}
export interface Finding { id: string; requirement_id: string; severity: string; title: string; evidence_field: string; evidence: string; impact: string; recommendation: string }
export interface Decision { decision: 'accept' | 'changes' | ''; reason: string }
export interface SystemDetail {
  permissions?: string[];
  job?: Job | null;
  system: { assessment_type?: 'new' | 'existing'; asset_name?: string; assessment_round?: number; project_id?: string; asset_id?: string | null; predecessor_id?: string | null; assessment_scope?: Record<string, unknown>; id: string; name: string; status: string; version: number; revision: number; context: Partial<Brief>;
    draft: { prd_import_id?: string; block_sources?: Record<string, { import_id: string; text: string }>; blocks?: Record<string, string>; proposal?: Brief | null; proposal_stale?: boolean; proposal_mode?: string }; classification: Classification;
    context_revision_id?: string; created_at: number; updated_at: number };
  controls: Control[];
  prd: { id: string; data: PrdData; approved: boolean; language: Locale; mode: string; content_hash: string } | null;
  round: { id: string; status: string; version: number; draft: Record<string, Answer>; submitted_id?: string; supplier_org_id: string; instructions?: string } | null;
  report: { control_originals?: Record<string, { id: string; code: string; text: string }[]>; mlps3_major_risk?: boolean; id: string; data: { summary: string; findings: Finding[] }; mode: string; reviewed: boolean; decisions: Record<string, Decision> } | null;
  baseline: { id: string; content_hash: string; finalized: boolean; confirmations: { party: string; actor_id: string; created_at: number }[] } | null;
  job_id?: string; invite_token?: string | null; existing_supplier?: boolean;
}
export interface SystemRow { assessment_scope?: { as_of?: string }; assessment_type?: 'new' | 'existing'; asset_name?: string; assessment_round?: number; project_id?: string; asset_id?: string | null; id: string; name: string; status: string; revision: number; level: string | null; department: string; updated_at: number }
export interface Job { id: string; state: string; kind: string; error: string; mode: string; attempts: number }
