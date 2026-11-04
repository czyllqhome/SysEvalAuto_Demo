import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import DownwardSelect from './DownwardSelect'

it('selects with keyboard or pointer and dismisses without changing the value', () => {
  const onChange = vi.fn()
  render(<DownwardSelect label="控制域" value="" onChange={onChange} options={[
    { code: '', label: '全部' }, { code: 'IAM', label: '身份与访问' }, { code: 'DATA', label: '数据保护' },
  ]} />)
  const trigger = screen.getByRole('combobox', { name: '控制域' })
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(trigger, { key: 'End' })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(onChange).toHaveBeenLastCalledWith('DATA')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: '身份与访问' }))
  expect(onChange).toHaveBeenLastCalledWith('IAM')
  fireEvent.click(trigger)
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  fireEvent.pointerDown(document.body)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(onChange).toHaveBeenCalledTimes(2)
})
