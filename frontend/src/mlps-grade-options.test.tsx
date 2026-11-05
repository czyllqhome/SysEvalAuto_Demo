import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import MLPSGradeResult from './MLPSGradeResult'
import { LocaleProvider, useLocale } from './i18n'
import type { Assessment, Question } from './MLPSIntake'
import questions from '../../backend/app/data/mlps_questionnaire.json'

afterEach(() => { cleanup(); localStorage.clear() })
function Language() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }
function show(population: string | number = '100,000 人及以上') {
  const assessment: Assessment = {
    status: 'preliminary_complete', base_level: 1, proposed_level: 3, business_information_level: 1, system_service_level: 1,
    special_principle_minimum: null, is_lower_bound_only: false, issues: [], alerts: [], rule_trace: [], organization_minimum: 3,
    organization_rule_trace: [
      { code: 'network', field: 'external_network_access', answer: '存在公众可访问入口', level: 2, zh: '已保存网络依据', en: 'Saved network basis' },
      { code: 'population', field: 'personal_info_count_system', answer: population, level: 3, zh: '已保存人数依据', en: 'Saved population basis' },
      { code: 'records', field: 'data_volume_ranges', subfield: 'records', answer: 'under_100k', level: 1, zh: '记录依据', en: 'Records basis' },
      { code: 'storage', field: 'data_volume_ranges', subfield: 'storage', answer: '1_10tb', level: 2, zh: '容量依据', en: 'Storage basis' },
    ],
  }
  const original = structuredClone(assessment)
  render(<LocaleProvider><Language /><MLPSGradeResult readOnly assessment={assessment} answers={{ personal_info_count_system: population }} notes={{}} questions={questions as Question[]} frameworks={['MLPS_LEVEL_3']} locked frameworkMode="auto" setFrameworkMode={() => {}} setFrameworks={() => {}} back={() => {}} confirm={() => {}} /></LocaleProvider>)
  return { assessment, original }
}

it('shows complete questionnaire options and selected answers instead of grade scales in both languages', () => {
  const { assessment, original } = show()
  const network = screen.getByRole('list', { name: '网络入口方式 · 全部选项' })
  expect(within(network).getAllByRole('listitem').map(item => item.textContent)).toEqual(['无', '仅经VPN/零信任接入', '存在受控互联网入口', '公网可访问入口已选', '不确定'])
  expect(within(network).getByText('公网可访问入口').closest('li')).toHaveAttribute('aria-current', 'true')
  const population = screen.getByRole('list', { name: '个人信息人数 · 全部选项' })
  expect(within(population).getAllByRole('listitem').map(item => item.textContent)).toEqual(['0–9,999 人', '10,000–99,999 人', '100,000 人及以上已选', '不确定'])
  const records = screen.getByRole('list', { name: '业务记录数量 · 全部选项' })
  expect(within(records).getByText('不足 10 万条').closest('li')).toHaveAttribute('aria-current', 'true')
  expect(within(records).getByText('1,000 万条及以上')).toBeVisible()
  const storage = screen.getByRole('list', { name: '数据容量 · 全部选项' })
  expect(within(storage).getByText('1–不足 10 TB').closest('li')).toHaveAttribute('aria-current', 'true')
  expect(within(storage).getByText('不足 1 TB')).toBeVisible()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('English'))
  expect(within(screen.getByRole('list', { name: 'Network ingress · All options' })).getByText('Public internet ingress').closest('li')).toHaveAttribute('aria-current', 'true')
  expect(within(screen.getByRole('list', { name: 'Data storage volume · All options' })).getByText('100 TB or more')).toBeVisible()
  expect(screen.getByText('Saved population basis')).toBeVisible()
  expect(assessment).toEqual(original)
})

it.each([{ value: '超过 50,000 人', label: '超过 50,000 人', english: '超过 50,000 人' }, { value: 50000, label: '50,000 人', english: '50,000 people' }])('retains the exact saved population $value beside the current options', ({ value, label, english }) => {
  const { assessment, original } = show(value)
  const options = screen.getByRole('list', { name: '个人信息人数 · 全部选项' })
  const saved = within(options).getByText(label).closest('li')!
  expect(saved).toHaveAttribute('aria-current', 'true')
  expect(within(saved).getByText('已保存答案')).toBeVisible()
  expect(within(options).getAllByRole('listitem')).toHaveLength(5)
  fireEvent.click(screen.getByText('English'))
  expect(within(screen.getByRole('list', { name: 'Personal-information population · All options' })).getByText(english).closest('li')).toHaveAttribute('aria-current', 'true')
  expect(assessment).toEqual(original)
})
