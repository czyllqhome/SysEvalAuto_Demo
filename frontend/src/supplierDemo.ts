import { blankAnswer } from './supplierAnswers'
import type { Answer, Locale, Requirement } from './types'

// Match the control clause, not the generated REQ number, which changes between PRDs.
const scenarios = [
  {
    matches: (text: string) => text.includes('远程管理') && text.includes('鉴别信息') && text.includes('窃听'),
    status: 'no', days: null,
    zh: {
      limitations: '现有远程维护组件不支持加密鉴别信息传输，供应商无法在本期交付范围内完成组件替换，因此暂不能满足本项要求。',
      alternative: '停用该组件的远程管理入口，仅允许经审批的现场维护；通过网络访问控制阻断远程管理端口，保留变更审批和操作日志。组件替换并验证传输加密前，不恢复远程管理。请负责人判断临时方案及后续改造范围。',
      implementation_plan: '演示安排：预计 20 个工作日完成替换方案评估和验证；此估算不代表已承诺本期完成整改。',
    },
    en: {
      limitations: 'The existing remote maintenance component cannot encrypt authentication data in transit. Replacing it is outside this delivery scope, so this requirement cannot currently be met.',
      alternative: 'Disable remote management through this component, allow only approved on-site maintenance, block remote administration ports, and retain change approvals and activity logs. Do not restore remote access until the replacement passes encryption verification. The owner must review the temporary arrangement and remediation scope.',
      implementation_plan: 'Demo estimate: 20 workdays to assess and validate a replacement plan; this is not a commitment to complete remediation in this delivery.',
    },
  },
  {
    matches: (text: string) => text.includes('安装防恶意代码软件') && text.includes('更新防恶意代码库'),
    status: 'needs_clarification', days: 5,
    zh: {
      limitations: '应用拟部署在托管云环境中，供应商尚未确认宿主机与容器的防恶意代码能力由云服务商还是客户负责，也未获得覆盖范围、更新策略及检测记录。请负责人明确责任边界和验收证据要求。',
      alternative: '在责任明确前，对交付镜像、依赖包和上传文件执行恶意代码扫描，仅使用受信镜像并限制运行权限；涉及宿主机的防护及更新记录由责任方提供。上述措施的覆盖范围需由负责人确认，不能视为已经满足全部要求。',
      implementation_plan: '演示安排：预计 5 个工作日完成责任澄清、收集防护与更新记录，并提交负责人复核。',
    },
    en: {
      limitations: 'The application is planned for a managed cloud environment. Responsibility for host and container malware protection is not yet confirmed, and coverage, update policies and detection records are unavailable. The owner must define responsibilities and acceptance evidence.',
      alternative: 'Scan delivery images, dependencies and uploaded files, use trusted images and restrict runtime privileges while responsibilities are clarified. The responsible party must provide host protection and update records. The owner must verify coverage; these measures do not establish full compliance.',
      implementation_plan: 'Demo estimate: 5 workdays to clarify responsibilities, collect protection and update records, and request owner review.',
    },
  },
  {
    matches: (text: string) => text.includes('外部人员') && text.includes('书面申请') && text.includes('开设账户') && text.includes('登记备案'),
    status: 'needs_clarification', days: 3,
    zh: {
      limitations: '外部维护人员的接入审批、账号开设和备案由客户侧管理，但当前尚未明确审批人、申请模板、权限范围及账号有效期。请负责人确认客户与供应商各自职责，以及需要保留的审批和备案材料。',
      alternative: '流程确认前不开放常驻外部账号；确需访问时先留存书面批准，由指定管理员开设实名、最小权限且限时的账号，记录访问过程并在到期后禁用。账号清单和审批记录交负责人复核。',
      implementation_plan: '演示安排：预计 3 个工作日明确审批及备案流程，并提交一份脱敏的申请、授权和销户记录样例。',
    },
    en: {
      limitations: 'The customer manages external maintenance access approval, account creation and registration, but the approver, request form, permission scope and account expiry are not defined. The owner must confirm both parties’ responsibilities and the required approval records.',
      alternative: 'Do not enable standing external accounts before the process is agreed. For necessary access, retain written approval and have a designated administrator create named, least-privilege, time-limited accounts, log access and disable accounts on expiry. Submit account and approval records for owner review.',
      implementation_plan: 'Demo estimate: 3 workdays to define approval and registration procedures and provide a redacted request, authorization and account closure example.',
    },
  },
] satisfies { matches: (text: string) => boolean; status: Answer['implementation_status']; days: Answer['duration_workdays']; zh: Pick<Answer, 'limitations' | 'alternative' | 'implementation_plan'>; en: Pick<Answer, 'limitations' | 'alternative' | 'implementation_plan'> }[]

export function supplierDemoAnswer(requirement: Requirement, locale: Locale): Answer {
  const scenario = requirement.origin !== 'business' && scenarios.find(s => s.matches(requirement.description.replace(/\s+/g, '')))
  return {
    ...blankAnswer(), implementation_status: scenario ? scenario.status : 'yes', duration_workdays: scenario ? scenario.days : 10,
    owner_name: locale === 'zh' ? '演示交付负责人' : 'Demo delivery lead',
    implementation_plan: locale === 'zh' ? '演示方案：按需求实现并提供验收测试记录，待双方复核。' : 'Demo plan: implement the requirement and provide acceptance test records for joint review.',
    ...(scenario ? scenario[locale] : {}),
  }
}
