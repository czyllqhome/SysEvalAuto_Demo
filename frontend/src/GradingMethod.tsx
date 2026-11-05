import { useLocale } from './i18n'
import matrix from '../../backend/app/data/mlps_impact_matrix.json'
import populationPolicy from '../../backend/app/data/mlps_population_policy.json'

export default function GradingMethod() {
  const { t } = useLocale()
  const rows = [
    [t('合法权益', 'Individual / organizational rights'), t('公民、法人和其他组织', 'Citizens, legal persons and other organizations'), Object.values(matrix.levels.rights)],
    [t('社会秩序与公共利益', 'Public order & public interests'), t('公共服务、社会秩序等', 'Public services and social order'), Object.values(matrix.levels.public)],
    [t('国家安全', 'National security'), t('有现实依据的国家安全影响', 'Credible national-security impact'), Object.values(matrix.levels.national)],
  ] as const
  return <section className="grading-method">
    <header><span className="eyebrow">MLPS 2.0 · {matrix.version}</span><h1>{t('系统等级如何确定？', 'How is the system grade determined?')}</h1><p>{t('分别计算业务信息与系统服务的矩阵等级，再与 Amer Sports 内部下限取最高值。', 'Calculate information and service matrix grades, then take the maximum with Amer Sports internal minima.')}</p></header>
    <section className="method-card"><h2>{t('① 受侵害客体 × 损害程度', '① Affected party × severity')}</h2><p>{t('先选择受侵害客体和损害程度，再在下表找到对应的初步等级。六项答案不相加，也不取平均。', 'For each core impact question, look up the preliminary grade below. Do not add or average the six answers.')}</p>
      <div className="method-table-scroll"><table><caption>{t('当前应用定级矩阵：单元格数字为等级', 'Current application grading matrix: cell numbers are grades')}</caption><thead><tr><th scope="col">{t('受侵害客体', 'Affected party')}</th>{[t('1 · 一般损害', '1 · Minor harm'), t('2 · 严重损害', '2 · Serious harm'), t('3 · 特别严重损害', '3 · Particularly serious harm')].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(([label, hint, levels]) => <tr key={label}><th scope="row">{label}<small>{hint}</small></th>{levels.map((level, i) => <td key={i} className={`matrix-grade grade-${level}`}><strong>{level}</strong><span>{t('级', 'Level')}</span></td>)}</tr>)}</tbody></table></div>
      <p className="method-callout">{t('合法权益受到特别严重损害时，本应用按 3 级计算。', 'This application maps particularly serious harm to rights to level 3.')}</p>
    </section>
    <section className="method-card"><h2>{t('② 两个维度，六项独立判断', '② Two dimensions, six independent judgments')}</h2><div className="method-dimensions">{[[t('业务信息安全等级', 'Business information grade'), t('信息泄露、篡改、丢失或损坏', 'Disclosure, tampering, loss or destruction')], [t('系统服务安全等级', 'System service grade'), t('核心服务中断、失效或受扰', 'Core service interruption, failure or disruption')]].map(([title, explanation]) => <article key={title}><h3>{title}</h3><p>{explanation}</p><p>{t('依次判断：合法权益、公共利益、国家安全。', 'Assess rights, public interests and national security in turn.')}</p><strong>{t('取本维度三个矩阵结果的最大值', 'Take the highest of the three matrix results')}</strong></article>)}</div><div className="method-formula">{t('基础初步等级 = max（业务信息安全等级，系统服务安全等级）', 'Base preliminary grade = max(information grade, service grade)')}</div></section>
    <section className="method-card"><h2>{t('Amer Sports 内部等级下限', 'Amer Sports internal grade minima')}</h2><p>{t('企业内部下限与上方影响矩阵分别计算，再取最高值。', 'Internal minima and the impact matrix above are calculated separately, then combined by taking the maximum.')}</p><div className="method-table-scroll"><table><thead><tr><th>{t('问卷答案', 'Questionnaire answer')}</th><th>{t('内部最低等级', 'Internal minimum')}</th></tr></thead><tbody><tr><th>{t('B04：与其他系统对接', 'B04: connects to other systems')}</th><td>{t('不低于对接系统最高已确认等级', 'At least the highest confirmed connected-system grade')}</td></tr><tr><th>{t('B06：仅经 VPN/零信任接入', 'B06: VPN / zero-trust only')}</th><td>3 {t('级', 'Level')}</td></tr><tr><th>{t('B06：受控互联网入口', 'B06: controlled internet ingress')}</th><td>2 {t('级', 'Level')}</td></tr><tr><th>{t('B06：公网可访问入口', 'B06: public internet ingress')}</th><td>2 {t('级', 'Level')}</td></tr>{[
      [t('C02：涉及交易', 'C02: transaction involvement'), 2],
      [t('C04：直接提供公共服务或公共设施支撑', 'C04: public services or public-facility support'), 2],
      [t('C05：非核心', 'C05: non-core'), 1],
      [t('C05：重要辅助', 'C05: important supporting'), 2],
      [t('C05：主要业务核心', 'C05: core business'), 3],
      ...populationPolicy.bands.map(band => [t(`D01：个人信息 ${band.zh}`, `D01: personal information for ${band.en}`), band.level]),
      [t('D05：一般数据', 'D05: general data'), 1],
      [t('D05：重要、核心或混合数据', 'D05: important, core or mixed data'), 3],
      [t('D06：数据跨境传输或向境外提供数据', 'D06: cross-border transfer or overseas data provision'), 2],
      [t('D04：业务记录不足10万条', 'D04: fewer than 100,000 records'), 1],
      [t('D04：业务记录10万–不足100万条', 'D04: 100,000 to under 1 million records'), 2],
      [t('D04：业务记录100万条及以上', 'D04: 1 million or more records'), 3],
      [t('D04：数据容量不足1 TB', 'D04: storage below 1 TB'), 1],
      [t('D04：数据容量1–不足10 TB', 'D04: storage from 1 to under 10 TB'), 2],
      [t('D04：数据容量10 TB及以上', 'D04: storage of 10 TB or more'), 3],
      [t('E06：外部单位、供应链等同步受影响', 'E06: external dependency impact'), 2],
      [t('E07：影响人身、生产、医疗安全或社会稳定', 'E07: safety or social-stability impact'), 3],
    ].map(([answer, minimum]) => <tr key={answer}><th>{answer}</th><td>{minimum} {t('级', 'Level')}</td></tr>)}</tbody></table></div><div className="method-formula">{t('初步建议等级 = max（影响矩阵结果，Amer Sports 内部等级下限）', 'Preliminary recommendation = max(impact matrix result, Amer Sports internal minimum)')}</div></section>
  </section>
}
