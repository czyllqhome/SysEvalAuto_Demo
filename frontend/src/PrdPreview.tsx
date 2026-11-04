import { useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Notice } from './components'
import { useLocale } from './i18n'

export default function PrdPreview({ systemId, prdId }: { systemId: string; prdId: string }) {
  const { t } = useLocale()
  const document = useQuery({
    queryKey: ['prd-document', systemId, prdId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/v1/systems/${systemId}/prd-versions/${prdId}/document`, { credentials: 'same-origin', signal })
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event('scope-session-expired'))
        throw new Error('PRD document unavailable')
      }
      return response.text()
    },
  })
  if (document.isPending) return <p role="status">{t('正在加载 PRD 文档…', 'Loading PRD document…')}</p>
  if (document.error) return <Notice error>{t('PRD 预览加载失败，请重试或下载文档。', 'Could not load the PRD preview. Retry or download the document.')}<Button variant="secondary" onClick={() => void document.refetch()}>{t('重试', 'Retry')}</Button></Notice>
  return <div className="prd-markdown" aria-label={t('PRD 模板预览', 'PRD template preview')}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
      a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span className="field-hint">{t('图片：', 'Image: ')}{alt}</span>,
    }}>{document.data}</Markdown>
  </div>
}
