import { useId, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { useLocale } from './i18n'

const definitions: Record<string, { zh: string; en: string; source: string; sourceEn: string }> = {
  敏感个人信息: {
    zh: '泄露或滥用后，容易损害个人尊严或人身、财产安全的信息，如人脸、指纹、健康、金融账户、行踪轨迹，以及不满14周岁未成年人的个人信息。',
    en: 'Personal information whose disclosure or misuse can harm dignity or personal/property safety, such as biometrics, health, financial accounts, location history, and information about children under 14.',
    source: '《个人信息保护法》第28条', sourceEn: 'Personal Information Protection Law, Article 28',
  },
  重要数据: {
    zh: '涉及特定领域、群体、区域或达到一定精度和规模，受损或滥用可能直接影响国家安全、经济运行、社会稳定或公共健康安全的数据。需结合适用目录和规定核实。',
    en: 'Data in particular domains, groups or regions, or of a certain precision and scale, whose compromise or misuse may directly affect national security, economic operations, social stability or public health and safety. Verify applicable catalogues and rules.',
    source: '《网络数据安全管理条例》第62条', sourceEn: 'Network Data Security Management Regulations, Article 62',
  },
  核心数据: {
    zh: '这里指国家核心数据，涉及国家安全、国民经济关键领域、重要民生或重大公共利益。不能仅因数据对企业经营很重要，就认定为核心数据。',
    en: 'Here this means national core data, involving national security, vital economic sectors, essential livelihoods or major public interests. Business-critical company data is not automatically national core data.',
    source: '《数据安全法》第21条', sourceEn: 'Data Security Law, Article 21',
  },
}

export default function DataCategoryOption({ value, label, checked, onChange }: {
  value: string; label: string; checked: boolean; onChange: (checked: boolean) => void
}) {
  const { t, locale } = useLocale()
  const id = useId()
  const [open, setOpen] = useState(false)
  const help = definitions[value]
  const input = <label><input type="checkbox" aria-describedby={help && open ? id : undefined} checked={checked} onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>
  if (!help) return input
  return <div className="mlps-data-option" onMouseEnter={() => setOpen(true)}
    onMouseLeave={e => setOpen(e.currentTarget.contains(document.activeElement))}
    onFocus={() => setOpen(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}
    onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); e.stopPropagation() } }}>
    {input}
    <button type="button" className="mlps-definition-icon" aria-label={`${label}${t('：查看解释', ': show definition')}`}
      aria-describedby={open ? id : undefined} onClick={() => setOpen(true)}><CircleAlert size={19} aria-hidden="true" /></button>
    {open && <div className="mlps-definition-tooltip" role="tooltip" id={id}>
      <strong>{label}</strong><p>{locale === 'zh' ? help.zh : help.en}</p><small>{locale === 'zh' ? help.source : help.sourceEn}</small>
    </div>}
  </div>
}
