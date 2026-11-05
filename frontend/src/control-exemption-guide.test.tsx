import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LocaleProvider, useLocale } from './i18n'
import ControlExemptionGuide from './ControlExemptionGuide'

afterEach(() => { cleanup(); localStorage.clear() })
function Switch() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }

it('maps factual answers to outcomes, filters level-specific clauses and supports English', () => {
  render(<LocaleProvider><Switch /><ControlExemptionGuide /></LocaleProvider>)
  expect(screen.getByRole('heading', { name: '控制项豁免机制' })).toBeVisible()
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(10)
  fireEvent.change(screen.getByLabelText('参考等级'), { target: { value: '1' } })
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5)
  expect(screen.queryByText('是否使用外包运维服务？')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索规则'), { target: { value: 'B10' } })
  fireEvent.click(screen.getByText('适用等级与条款范围'))
  expect(screen.getByText(/6.1.9.1-a/)).toBeVisible()
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByRole('heading', { name: 'Control exemption rules' })).toBeVisible()
  expect(screen.getByText('Scope exemption')).toBeVisible()
  expect(screen.getByLabelText('Reference level')).toHaveValue('1')
  fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'nonexistent' } })
  expect(screen.getByRole('status')).toHaveTextContent('No matching rules')
})
