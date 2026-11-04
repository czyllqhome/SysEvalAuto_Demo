export type Fact = string | string[] | number
export type Atom = { tag: string; op: 'eq' | 'in'; value: Fact }
export type Rule = true | { any: { all: Atom[] }[] }
export type Definition = { code: string; zh: string; en: string; values?: string[]; kind?: 'enum' | 'multi' | 'number'; group?: string; risk?: boolean; when?: Rule; level?: string }
export type Config = { schema_version: string; domains: Definition[]; profiles: Definition[]; topics: Definition[]; questions: Definition[]; thresholds: { critical_minutes: number; important_minutes: number } }
export type LibraryControl = {
  control_id?: string; revision?: number; control_code: string; translations: Record<string, { title: string; description: string; verification: string }>;
  assessment_object: string; domain_code: string; assessment_profiles: string[]; required: boolean; topic_tags: string[];
  applicability_mode: 'always' | 'conditional'; rule: Rule; responsibility_rule: string; source_framework: string;
  source_version: string; source_ref: string; source_level?: number | null; control_family_id: string; change_reason: string;
  review_status: string; retired: boolean; tagging_basis?: string; source?: unknown;
}
export type LibraryState = { version: number; published_id: string | null; config: Config; controls: LibraryControl[]; can_edit: boolean }
