import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleProvider, useLocale } from './i18n'
import ControlMatchSummary from './ControlMatchSummary'
import { summarizeControls, exemptionReason, isRuleExempted } from './ControlMatchSummary'
import type { Control, SystemDetail } from './types'
afterEach(() => { cleanup(); localStorage.clear() })

it('counts only the selected reference and separates exemptions, unresolved decisions and extras', () => {
  const row = (id: string, patch: Partial<Control> = {}) => ({ id, levels: ['L2'], metadata: { source_framework: 'MLPS_LEVEL_2' }, origin: 'matched', included: true, ...patch } as Control)
  const detail = { system: { classification: { frameworks: ['MLPS_LEVEL_2'], effective_level: 'L2' } }, controls: [row('selected'), row('automatic', { included: false, origin: 'inapplicable', match: { status: 'inapplicable' } as Control['match'] }), row('manual', { included: false, reason: 'Reviewed scope exclusion' }), row('pending', { included: false, origin: 'candidate' }), row('other-level', { included: false, metadata: { source_framework: 'MLPS_LEVEL_3' } }), row('custom', { origin: 'custom' })] } as SystemDetail
  const summary = summarizeControls(detail)
  expect([summary.original.length, summary.included.length, summary.inapplicable.length, summary.excluded.length, summary.pending, summary.additional]).toEqual([4, 1, 1, 1, 1, 1])
  expect(summary.inapplicable.map(c => c.id)).toEqual(['automatic'])
  expect(summary.excluded.map(c => c.id)).toEqual(['manual'])
})

it('explains a scope-based exclusion using the saved answer', () => {
  const c = { id: 'scope', code: 'scope', domain: 'ops', levels: ['L2'], required: true, catalog_id: 'catalog', translations: {}, match: { status: 'inapplicable', reason: 'rule_not_matched', responsibility: 'shared', answer_refs: ['scope.media_transport'], fact_values: { 'scope.media_transport': 'no' } } } as Control
  expect(exemptionReason(c, zh => zh)).toContain('不涉及实体介质线下运输或交付')
  c.reason = '人工核实后的原因'
  expect(exemptionReason(c, zh => zh)).toBe(c.reason)
})

function cloudControl(id: string, patch: Partial<Control> = {}): Control {
  return { id, code: id, catalog_id: 'pinned', domain: 'cloud', levels: ['L2'], required: true,
    translations: { zh: { title: id, description: '保留原文', verification: '核对' } },
    metadata: { source_framework: 'MLPS_LEVEL_2', source_ref: id }, included: false, origin: 'inapplicable', reason: '',
    match: { status: 'inapplicable', reason: 'rule_not_matched', answer_refs: ['hosting.models'],
      fact_values: { 'hosting.models': ['own_dc'] }, responsibility: 'shared' }, ...patch } as Control
}
function assessment(controls: Control[]): SystemDetail {
  return { system: { classification: { catalog_id: 'pinned', frameworks: ['MLPS_LEVEL_2'], effective_level: 'L2' } }, controls } as SystemDetail
}
it('keeps non-cloud extension rules, manual exemptions and unknown deployment distinct', () => {
  const controls = [cloudControl('non-cloud'), cloudControl('manual', { reason: '人工例外说明' }),
    cloudControl('unknown', { origin: 'candidate', match: { ...cloudControl('x').match!, status: 'unknown', fact_values: { 'hosting.models': ['unknown'] } } }),
    cloudControl('cloud', { included: true, origin: 'matched', match: { ...cloudControl('x').match!, status: 'applicable', fact_values: { 'hosting.models': ['cloud'] } } }),
    cloudControl('reconfirm', { origin: 'candidate' }), cloudControl('old-catalog', { catalog_id: 'old' }),
    cloudControl('other-level', { metadata: { source_framework: 'MLPS_LEVEL_1' } })]
  const result = summarizeControls(assessment(controls))
  expect(result.inapplicable.map(c => c.id)).toEqual(['non-cloud'])
  expect(result.excluded.map(c => c.id)).toEqual(['manual'])
  expect(result.included.map(c => c.id)).toEqual(['cloud'])
  expect(result.pending).toBe(2)
  expect(result.original.length).toBe(result.included.length + result.inapplicable.length + result.excluded.length + result.pending)
  expect(exemptionReason(controls[0], zh => zh)).toContain('采用非云环境，云计算安全扩展要求不适用')
})
it('shows separate applicability and exemption reason tables without mixing decisions', () => {
  render(<LocaleProvider><ControlMatchSummary detail={assessment([cloudControl('cloud-extension'), cloudControl('manual-exemption', { reason: '人工例外说明' })])} domains={{ cloud: ['云计算安全扩展要求', 'Cloud security extensions'] }} /></LocaleProvider>)
  expect(screen.getByText('不适用', { exact: true }).parentElement).toHaveTextContent('1')
  expect(screen.getByText('豁免条目', { exact: true }).parentElement).toHaveTextContent('1')
  fireEvent.click(screen.getByRole('button', { name: /^不适用原因/ }))
  expect(screen.getByRole('table')).toHaveTextContent('cloud-extension')
  expect(screen.getByRole('table')).not.toHaveTextContent('人工例外说明')
  fireEvent.click(screen.getByRole('button', { name: /^豁免原因/ }))
  expect(screen.getByRole('table')).toHaveTextContent('人工例外说明')
  expect(screen.getByRole('table')).not.toHaveTextContent('cloud-extension')
})


function physicalControl(id: string, hosting: string[], patch: Partial<Control> = {}): Control {
  return cloudControl(id, { domain: 'physical', metadata: { source_framework: 'MLPS_LEVEL_2', source_ref: id, source: { languages: { zh: { fields: { security_domain: '安全物理环境' } } } } },
    match: { ...cloudControl('x').match!, fact_values: { 'hosting.models': hosting } }, ...patch })
}
it.each([['cloud'], ['saas'], ['own_dc', 'cloud']])('classifies general physical controls under confirmed %j deployment as exemptions', (...hosting) => {
  const physical = physicalControl('physical', hosting)
  const cloud = cloudControl('cloud', { included: true, origin: 'matched' })
  const summary = summarizeControls(assessment([physical, cloud]))
  expect(summary.excluded.map(c => c.id)).toEqual(['physical'])
  expect(summary.inapplicable).toHaveLength(0)
  expect(summary.included).toHaveLength(1)
  expect(summary.pending).toBe(0)
  expect(exemptionReason(physical, zh => zh)).toContain('通用控制')
  expect(exemptionReason(physical, zh => zh)).toContain('按部署规则豁免')
})
it('keeps candidate, unknown, outside-reference and manual decisions distinct from deployment exemptions', () => {
  const pending = physicalControl('pending', ['cloud'], { origin: 'candidate' })
  const unknown = physicalControl('unknown', ['unknown'], { origin: 'candidate', match: { ...cloudControl('x').match!, status: 'unknown' } })
  const manual = physicalControl('manual', ['cloud'], { reason: '人工核实的豁免理由' })
  const outside = physicalControl('outside', ['cloud'], { metadata: { source_framework: 'MLPS_LEVEL_1', source: { fields: { security_domain: '安全物理环境' } } }, match: { ...cloudControl('x').match!, reason: 'framework_not_selected', fact_values: { 'hosting.models': ['cloud'] } } })
  const local = physicalControl('local', ['own_dc'], { included: true, origin: 'matched' })
  const extension = cloudControl('non-cloud-extension')
  const result = summarizeControls(assessment([pending, unknown, manual, outside, local, extension]))
  expect(result.excluded.map(c => c.id)).toEqual(['manual'])
  expect(result.inapplicable.map(c => c.id)).toEqual(['non-cloud-extension'])
  expect(result.pending).toBe(2)
  expect(result.included.map(c => c.id)).toEqual(['local'])
  expect(result.original).toHaveLength(5)
  for (const c of [pending, unknown, manual, outside, local, extension]) expect(isRuleExempted(c)).toBeFalsy()
  expect(exemptionReason(manual, zh => zh)).toBe('人工核实的豁免理由')
})
it('shows cloud physical exclusions in the exemption reason table as rule decisions', () => {
  render(<LocaleProvider><ControlMatchSummary detail={assessment([physicalControl('physical-cloud', ['cloud'])])} domains={{ physical: ['安全物理环境', 'Physical environment'] }} /></LocaleProvider>)
  expect(screen.getByText('不适用', { exact: true }).parentElement).toHaveTextContent('0')
  expect(screen.getByText('豁免条目', { exact: true }).parentElement).toHaveTextContent('1')
  fireEvent.click(screen.getByRole('button', { name: /^豁免原因/ }))
  expect(screen.getByRole('table')).toHaveTextContent('physical-cloud')
  expect(screen.getByRole('table')).toHaveTextContent('部署规则豁免')
  expect(screen.getByRole('table')).not.toHaveTextContent('人工排除')
})


const generalCases = [
  ['in-house', 'delivery.models', ['purchased'], ['in_house']],
  ['outsourced-development', 'delivery.models', ['in_house'], ['outsourced']],
  ['operations', 'ops.outsourced', 'no', 'yes'],
  ['media', 'scope.physical_media', 'no', 'yes'],
  ['transport', 'scope.media_transport', 'no', 'yes'],
  ['facility', 'scope.facility_management', 'no', 'yes'],
  ['visitors', 'scope.physical_visitors', 'no', 'yes'],
] as const
function generalControl(id: string, tag: string, value: unknown, required: string | readonly string[]): Control {
  return cloudControl(id, { domain: 'general', metadata: { source_framework: 'MLPS_LEVEL_2', source: { fields: { security_domain: '安全运维管理' } } },
    match: { ...cloudControl('x').match!, answer_refs: [tag], fact_values: { [tag]: value }, rule: { tag, value: typeof required === 'string' ? required : [...required] } } })
}
it.each(generalCases)('counts confirmed out-of-scope %s general controls as exemptions', (id, tag, value, required) => {
  const c = generalControl(id, tag, value, required)
  const result = summarizeControls(assessment([c, cloudControl('non-cloud-extension')]))
  expect(result.excluded.map(c => c.id)).toEqual([id])
  expect(result.inapplicable.map(c => c.id)).toEqual(['non-cloud-extension'])
  expect(result.pending).toBe(0)
  expect(exemptionReason(c, zh => zh)).toContain('通用控制按范围规则豁免')
  expect(exemptionReason(c, (_zh, en) => en)).toContain('general control is exempted by the scope rule')
  const unknown = { ...c, origin: 'candidate', match: { ...c.match!, status: 'unknown', fact_values: { [tag]: 'unknown' } } }
  expect(summarizeControls(assessment([unknown])).pending).toBe(1)
  expect(isRuleExempted(unknown)).toBe(false)
  expect(isRuleExempted({ ...c, included: true })).toBe(false)
  const manual = { ...c, reason: '人工核实的原因' }
  expect(isRuleExempted(manual)).toBe(false)
  expect(exemptionReason(manual, zh => zh)).toBe(manual.reason)
  const outside = { ...c, match: { ...c.match!, reason: 'framework_not_selected' } }
  expect(isRuleExempted(outside)).toBe(false)
})
it('does not infer development exemptions from empty, unknown, matching or missing facts', () => {
  for (const value of [[], ['unknown'], ['purchased', 'unknown'], ['in_house'], undefined]) {
    const c = generalControl('invalid-evidence', 'delivery.models', value, ['in_house'])
    expect(isRuleExempted(c)).toBe(false)
  }
})
it('labels general scope exemptions separately from deployment rules and manual decisions', () => {
  const c = generalControl('outsourced-ops', 'ops.outsourced', 'no', 'yes')
  render(<LocaleProvider><ControlMatchSummary detail={assessment([c, physicalControl('physical', ['cloud']), cloudControl('non-cloud-extension')])} domains={{}} /></LocaleProvider>)
  expect(screen.getByText('豁免条目', { exact: true }).parentElement).toHaveTextContent('2')
  expect(screen.getByText('不适用', { exact: true }).parentElement).toHaveTextContent('1')
  fireEvent.click(screen.getByRole('button', { name: /^豁免原因/ }))
  expect(screen.getByRole('table')).toHaveTextContent('范围规则豁免')
  expect(screen.getByRole('table')).toHaveTextContent('部署规则豁免')
  expect(screen.getByRole('table')).not.toHaveTextContent('不适用')
  expect(screen.getByRole('table')).not.toHaveTextContent('人工排除')
})


function LanguageToggle() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }

it('shows source identifiers and complete pinned original text without internal codes in both languages', () => {
  const original = '应对访问机房的人员进行登记。\n应保存全部访问记录，不得省略控制原文。'
  const c = physicalControl('internal-hash', ['cloud'], { code: 'MLPS2-private-hash',
    translations: { zh: { title: '简短标题', description: '摘要，不是来源原文', verification: '' }, en: { title: 'Short title', description: 'Translated summary', verification: '' } },
    metadata: { source_framework: 'MLPS_LEVEL_2', source_ref: 'fallback-id', source: { fields: { source: 'MLPS Level 2', control_identifier: '7.1.1.2 -a)', control_requirement: original, security_domain: '安全物理环境' } } },
  })
  render(<LocaleProvider><LanguageToggle /><ControlMatchSummary detail={assessment([c])} domains={{}} /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: /^豁免原因/ }))
  expect(screen.getByRole('columnheader', { name: 'Source' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Identifier' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: '控制项原文' })).toBeVisible()
  expect(screen.getByRole('table')).toHaveTextContent('MLPS Level 2')
  expect(screen.getByRole('table')).toHaveTextContent('7.1.1.2 -a)')
  expect(document.querySelector('.control-reason-original')?.textContent).toBe(original)
  expect(screen.getByRole('table')).not.toHaveTextContent('MLPS2-private-hash')
  expect(screen.getByRole('table')).not.toHaveTextContent('摘要，不是来源原文')
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByRole('columnheader', { name: 'Original control text' })).toBeVisible()
  expect(document.querySelector('.control-reason-original')?.textContent).toBe(original)
  expect(screen.getByRole('table')).not.toHaveTextContent('Translated summary')
})

it('falls back per field for partial source metadata and preserves authored legacy text', () => {
  const c = cloudControl('legacy', { metadata: { source_framework: 'MLPS_LEVEL_2', source_ref: 'legacy-clause', source: { languages: { zh: { fields: { risk_level: 'High' } } }, fields: { source: 'Original source' } } } })
  render(<LocaleProvider><ControlMatchSummary detail={assessment([c])} domains={{}} /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: /^不适用原因/ }))
  expect(screen.getByRole('table')).toHaveTextContent('Original source')
  expect(screen.getByRole('table')).toHaveTextContent('legacy-clause')
  expect(screen.getByRole('table')).toHaveTextContent('保留原文')
})

it('explains the cloud assessment total as 15 deployment and 5 scope exemptions with no inapplicable extensions', () => {
  const included = Array.from({ length: 144 }, (_, i) => cloudControl(`included-${i}`, { included: true, origin: 'matched' }))
  const deployment = Array.from({ length: 15 }, (_, i) => physicalControl(`physical-${i}`, ['cloud']))
  const scope = [generalCases[0], generalCases[0], ...generalCases.slice(3, 5), generalCases[6]].map(([id, tag, value, required], i) => generalControl(`${id}-${i}`, tag, value, required))
  const detail = assessment([...included, ...deployment, ...scope])
  const summary = summarizeControls(detail)
  expect([summary.original.length, summary.included.length, summary.excluded.length, summary.inapplicable.length, summary.pending]).toEqual([164, 144, 20, 0, 0])
  render(<LocaleProvider><ControlMatchSummary detail={detail} domains={{}} /></LocaleProvider>)
  expect(screen.getByText('豁免构成：部署规则 15 条，范围规则 5 条，人工排除 0 条。')).toBeVisible()
})
