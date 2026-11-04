import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowUpRight, Check, LoaderCircle, X } from 'lucide-react'
import { ApiError, api } from './api'
import { statuses, useLocale } from './i18n'
import type { Mode, Session, SystemDetail } from './types'

export const AuthContext = createContext<Session | null>(null)
export const useAuth = () => useContext(AuthContext)!
export const PreferencesContext = createContext({ mode: 'local' as Mode, setMode: (_mode: Mode) => {}, outputLanguage: 'auto', setOutputLanguage: (_language: string) => {} })
export function Preferences({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('local')
  const [outputLanguage, setOutputLanguage] = useState('auto')
  return <PreferencesContext.Provider value={{ mode, setMode, outputLanguage, setOutputLanguage }}>{children}</PreferencesContext.Provider>
}
export function ModeControl() {
  const { t } = useLocale()
  const prefs = useContext(PreferencesContext)
  const auth = useAuth()
  return <div className="mode-control">
    <label>{t('生成方式', 'Generation')}<select aria-label={t('生成方式', 'Generation mode')} value={prefs.mode} onChange={e => prefs.setMode(e.target.value as Mode)}>
      <option value="local">{t('本地规则草稿', 'Local rule-based draft')}</option>
      <option value="openrouter" disabled={!auth.model_configured}>OpenRouter{!auth.model_configured ? t('（未配置）', ' (not configured)') : ''}</option>
    </select></label>
    <label>{t('输出语言', 'Output language')}<select aria-label={t('输出语言', 'Output language')} value={prefs.outputLanguage} onChange={e => prefs.setOutputLanguage(e.target.value)}>
      <option value="auto">{t('跟随界面', 'Match interface')}</option><option value="zh">简体中文</option><option value="en">English</option>
    </select></label>
  </div>
}
export function Button({ children, variant = 'primary', busy, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'text' | 'danger'; busy?: boolean }) {
  return <button className={`button ${variant} ${className}`} {...props} disabled={props.disabled || busy}>
    {busy && <LoaderCircle size={16} className="spin" />}{children}
  </button>
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><AlertCircle size={17} /><div>{children}</div></div>
}
export function Status({ status }: { status: string }) {
  const { pair } = useLocale()
  return <span className={`status ${status === 'PENDING_DEVELOPMENT' ? 'success' : ''}`}><i />{statuses[status] ? pair(statuses[status]) : status}</span>
}
export function Empty({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-mark"><ArrowUpRight size={25} /></span><h3>{title}</h3>{description && <p>{description}</p>}{children}</div>
}
export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const { t } = useLocale()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const initial = ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]), textarea, select') ?? ref.current?.querySelector<HTMLElement>('button')
    initial?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') {
        const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]') ?? [])
        const first = focusable[0], last = focusable.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [])
  return <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><div className={`modal ${wide ? 'wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label={t('关闭', 'Close')} onClick={close}><X size={19} /></button></div>{children}
  </div></div>
}
export function useCommand(detail: SystemDetail) {
  const client = useQueryClient()
  const { error: translate } = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (path: string, body: Record<string, unknown> = {}, method = 'POST') => {
    setBusy(true); setError('')
    try {
      const latest = client.getQueryData<SystemDetail>(['system', detail.system.id]) ?? detail
      const result = await api<SystemDetail>(path, { method, body: { ...body, version: latest.system.version }, key: crypto.randomUUID() })
      client.setQueryData(['system', detail.system.id], result)
      void client.invalidateQueries({ queryKey: ['systems'] })
      return result
    } catch (cause) {
      setError(translate(cause instanceof ApiError ? cause.code : 'NETWORK_ERROR'))
      throw cause
    } finally { setBusy(false) }
  }
  return { run, busy, error, setError }
}
export function JobNotice({ detail }: { detail: SystemDetail }) {
  const { t, error } = useLocale()
  const job = detail.job
  if (!job || job.state === 'succeeded' || job.state === 'cancelled') return null
  if (job.state === 'stale') return <Notice>{t('来源内容已有更新，旧任务结果未发布。', 'The source changed. The previous task result was not published.')}</Notice>
  return job.state === 'failed' ? <Notice error>{error(job.error)}</Notice> : <div className="job-progress" role="status"><LoaderCircle size={18} className="spin" /><div><strong>{t('正在整理，请稍候', 'Working through the details')}</strong><span>{t('任务已保存，离开页面后仍会继续。', 'The task is saved and continues if you leave this page.')}</span></div><span className="mono">{job.mode === 'local' ? t('本地草稿', 'LOCAL DRAFT') : 'OPENROUTER'}</span></div>
}
export function CheckLabel({ checked, onChange, children, required = false, inputLabel }: { inputLabel?: string; required?: boolean; checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return <label className="check-label"><input type="checkbox" aria-label={inputLabel} required={required} checked={checked} onChange={e => onChange(e.target.checked)} /><span>{children}</span>{checked && <Check size={16} />}</label>
}
