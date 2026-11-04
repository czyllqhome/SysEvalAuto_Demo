import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleProvider, useLocale } from './i18n'
import DataCategoryOption from './DataCategoryOption'

afterEach(() => { cleanup(); localStorage.clear() })
function Language() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>English</button> }

it.each(['敏感个人信息', '重要数据', '核心数据'])('explains %s on hover and focus without selecting the answer', value => {
  const change = vi.fn()
  render(<LocaleProvider><DataCategoryOption value={value} label={value} checked={false} onChange={change} /></LocaleProvider>)
  const checkbox = screen.getByRole('checkbox', { name: value })
  const help = screen.getByRole('button', { name: `${value}：查看解释` })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  fireEvent.mouseEnter(help.parentElement!)
  expect(screen.getByRole('tooltip')).toHaveTextContent(value)
  fireEvent.mouseLeave(help.parentElement!)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  fireEvent.focus(help)
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  fireEvent.keyDown(help, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  fireEvent.click(help)
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  expect(change).not.toHaveBeenCalled()
  expect(checkbox).not.toBeChecked()
})

it('switches definition language and distinguishes national core data from business importance', () => {
  render(<LocaleProvider><Language /><DataCategoryOption value="核心数据" label="核心数据" checked={false} onChange={() => {}} /></LocaleProvider>)
  fireEvent.click(screen.getByRole('button', { name: '核心数据：查看解释' }))
  expect(screen.getByRole('tooltip')).toHaveTextContent('国家核心数据')
  fireEvent.click(screen.getByText('English'))
  expect(screen.getByRole('tooltip')).toHaveTextContent('national core data')
})
