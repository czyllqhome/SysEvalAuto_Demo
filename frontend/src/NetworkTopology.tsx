import { useLocale } from './i18n'

export default function NetworkTopology({ systemId, images }: {
  systemId: string; images: { id: string; filename: string }[]
}) {
  const { t } = useLocale()
  if (!images.length) return null
  return <div className="network-topology"><h4>{t('网络拓扑图', 'Network topology diagram')}</h4>{images.map(image => <figure key={image.id}><img className="network-topology-image" src={`/api/v1/systems/${systemId}/network-topology/${image.id}`} alt={t('网络拓扑图', 'Network topology diagram')} loading="lazy" /><figcaption>{image.filename}</figcaption></figure>)}</div>
}
