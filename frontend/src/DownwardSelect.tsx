import { useEffect, useId, useRef, useState } from 'react'

export default function DownwardSelect({ label, value, options, onChange }: {
  label: string; value: string; options: { code: string; label: string }[]; onChange: (value: string) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const search = useRef({ text: '', time: 0 })
  const selected = Math.max(0, options.findIndex(option => option.code === value))
  const show = () => { setActive(selected); setOpen(true) }
  const choose = (index: number) => { onChange(options[index].code); setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active, id])
  return <div className="downward-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <label id={`${id}-label`} htmlFor={id}>{label}</label>
    <button id={id} ref={trigger} type="button" className="downward-select-trigger" role="combobox"
      aria-labelledby={`${id}-label`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
      aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); return }
        if (event.key === 'Tab') { setOpen(false); return }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          if (!open) show()
          else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
            : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (open) choose(active); else show()
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now()
          search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now }
          const index = options.findIndex(option => option.label.toLowerCase().startsWith(search.current.text))
          if (index >= 0) { setActive(index); setOpen(true) }
        }
      }}><span>{options[selected]?.label}</span><span aria-hidden="true">⌄</span></button>
    {open && <div id={`${id}-list`} className="downward-select-list" role="listbox" aria-labelledby={`${id}-label`}>
      {options.map((option, index) => <div key={option.code} id={`${id}-option-${index}`} role="option"
        aria-selected={option.code === value} className={index === active ? 'active' : ''}
        onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>{option.label}</div>)}
    </div>}
  </div>
}
