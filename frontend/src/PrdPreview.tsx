import { useQuery } from '@tanstack/react-query'
import Markdown, { defaultUrlTransform } from 'react-markdown'
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
  const [body, ...appendices] = document.data.split('\n<!-- syseval:prd-appendix -->\n')
  const renderMarkdown = (text: string) => <Markdown urlTransform={(url, key) => key === 'src' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) ? url : defaultUrlTransform(url)} remarkPlugins={[remarkGfm]} skipHtml components={{
      table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
      a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
      img: ({ src, alt }) => src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? <img className="network-topology-image" src={src} alt={alt ?? t('网络拓扑图', 'Network topology diagram')} loading="lazy" /> : <span className="field-hint">{t('图片：', 'Image: ')}{alt}</span>,
    }}>{text}</Markdown>
  return <div className="prd-markdown" aria-label={t('PRD 模板预览', 'PRD template preview')}>
    {renderMarkdown(body)}
    {appendices.length > 0 && <details className="prd-appendix" key={prdId}><summary>{t('验收、实施说明与来源附录', 'Acceptance, implementation and source appendices')}</summary>{renderMarkdown(appendices.join('\n'))}</details>}
  </div>
}
