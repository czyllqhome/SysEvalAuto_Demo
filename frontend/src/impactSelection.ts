export function selectedImpactFields(dimension: 'info' | 'service', answers: Record<string, unknown>): string[] {
  const saved = ['rights', 'public', 'national'].map(party => `${dimension}_${party}_severity`).filter(field => answers[field] !== undefined)
  const affected = saved.filter(field => answers[field] !== 0)
  return affected.length ? affected : saved.slice(0, 1)
}
