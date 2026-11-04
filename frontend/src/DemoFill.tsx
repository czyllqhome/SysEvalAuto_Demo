import { useState } from 'react'
import { Sparkles, Undo2 } from 'lucide-react'
import { Button } from './components'
import { useLocale } from './i18n'

export default function DemoFill({ apply, undo, disabled = false }: { apply: () => void; undo: () => void; disabled?: boolean }) {
  const { t } = useLocale(), [applied, setApplied] = useState(false)
  return <Button className="demo-action" variant="secondary" disabled={disabled}
    title={t('填入示例配置后可继续下一步。示例仅供演示，请审阅后再提交。再次点击可撤销填入。', 'Fill editable sample settings and continue. Review demonstration content before submitting. Click again to undo the fill.')}
    onClick={() => { if (applied) undo(); else apply(); setApplied(!applied) }}>
    {applied ? <Undo2 size={14} /> : <Sparkles size={14} />}{applied ? t('撤销填入', 'Undo fill') : t('一键填入 Demo', 'Fill demo')}
  </Button>
}
