import type { Brief } from './types'

export const emptyBrief = (): Brief => ({ summary: '', functions: [], departments: [], roles: [], owner_role: '', workflow: '', data_notes: '', integrations: '', constraints: '', scope: '', questions: [], grading_facts: {}, applicability_tags: {} })

export function gradingFacts(brief: Partial<Brief>, previous: Record<string, string> = {}) {
  const facts = { ...brief.grading_facts }
  for (const [tag, question, minimum] of [['external_access', 'Q4', 'L2'], ['personal_data', 'Q1', 'L2'], ['production_admin', 'Q3', 'L3']] as const) {
    const current = facts[question] ?? previous[question] ?? 'unknown'
    if (brief.applicability_tags?.[tag] === 'yes' && (current === 'unknown' || Number(current.slice(1)) < Number(minimum.slice(1)))) facts[question] = minimum
  }
  return facts
}

export function missingBriefFields(brief: Brief) {
  const missing: string[] = []
  if (!brief.functions.length || brief.functions.some(item => !item.title.trim())) missing.push('functions')
  return missing
}


export function briefFromQuestionnaire(answers: Record<string, unknown>): Brief {
  const text = (key: string) => typeof answers[key] === 'string' ? answers[key] as string : ''
  const list = (key: string) => Array.isArray(answers[key]) ? (answers[key] as unknown[]).filter((v): v is string => typeof v === 'string') : text(key) ? [text(key)] : []
  return { ...emptyBrief(), summary: text('system_purpose'),
    functions: text('system_functions').split('\n').filter(line => line.trim()).map((title, index) => ({ id: `F-QUESTIONNAIRE-${index + 1}`, title, description: '', source_blocks: [] })),
    workflow: text('system_scenarios'), departments: list('system_owner'), roles: list('user_types'),
    data_notes: list('data_categories').join('、'), integrations: text('system_interfaces_description') }
}
