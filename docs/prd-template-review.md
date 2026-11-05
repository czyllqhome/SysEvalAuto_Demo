# PRD 模板评审与接入

## 2026-11-06：v4 八章正文与页尾精简

默认 PRD 现在保留第 1–8 章，在“服务水平”后结束；移除第 9 章“交付与待确认事项”、其中的交付占位及假设/待确认清单，以及验收、实施说明、来源与版本附录。网页同时移除正文下的“逐项需求审查与编辑”折叠区，需求和验收仍可从页头“修改 PRD”查看与编辑。Word 和 Markdown 从同一保存稿导出，内容一致。

新默认模板为 `System_Assessment_PRD_v4.md`，用 `<!-- syseval:prd-layout-v4 -->` 标识；未使用的附录、交付和问题占位符不再自动补回正文。业务需求、安全控制、问卷章节及网络拓扑仍保留覆盖检查和缺失补充。需求 JSON 中的验收、实施说明、假设、问题和来源引用仍用于评估、供应商协同及后续交付，不因移除展示而删除。

更新已有草稿使用“应用当前模板（新修订）”，保留原需求、输出语言和生成方式，生成未批准的新 PRD；原文、模板快照和 hash 保留。仅在 PRD_REVIEW 允许，沿用当前 version/prd_id、组织及编辑权限检查；下发后的文档和已确认基线不重写。组织自定义模板与已排队任务保持其原有快照，旧 v3 模板仍支持原附录渲染。无需迁移或数据重置。

English: The default v4 document has eight chapters and ends after Service levels. Delivery/open questions and all appendices are omitted from the saved document and both download formats. The duplicate footer editor is removed; the header editor and structured requirement, acceptance and source records remain. Refreshing a draft creates an unapproved revision without changing historical documents, supplier submissions or independent same-hash confirmations.

离线回归覆盖中英文八章输出、旧 v3 兼容、来源/验收记录保留、Word/Markdown 一致、不可变历史、新修订和编辑/审批入口。

## 2026-11-04：v3 阅读与填写改版

本次评估发现：安全需求重复显示项目描述与控制原文，并混入优先级、来源 UUID、测评步骤和文件行号；SLA 章节承担了全部需求验收与追踪；联系人挤在长行中，结构化数据量与恢复目标直接展示 JSON。大量空字段与重复说明妨碍填写和阅读。

新版默认模板保留九章：背景与范围、相关人员与用户、使用场景与流程、功能需求、数据与接口、部署与架构、安全开发需求、服务水平、交付与待确认事项。缺失信息明确标注“待补充”，不推断负责人、指标或日期。联系人按部门分行；数据量显示问卷范围名称，恢复目标标明小时。

第七章只显示域标题和控制内容。每个已纳入控制按其原始安全域分组一次；跨域需求分别归入各控制的域，同一个控制被多个需求引用时不重复。优先使用输出语言的原文，缺少时回退到已有中英文原文；没有原文时使用控制描述。正文不展示需求编号、优先级、来源、文件行号、测评步骤或验收条目。项目特有的模型/人工描述仍保留在附录 B，不以控制原文覆盖。

附录 A 保存逐项验收；附录 B 保存安全实施说明；附录 C 保存来源映射、版本、生成方式和复核说明。网页默认折叠附录，Markdown 下载保留全部内容。规则草稿、模型草稿、人工修订仍清晰区分。需求 ID、来源覆盖、组织授权与独立同 hash 双签不变。

填写路径：系统信息收集补齐事实 → 确认控制范围 → 生成 PRD → “修改 PRD”按编号/标题/内容搜索，再展开单项填写描述与验收 → 保存新修订 → 人工复核。模板编辑页提供填写说明与自动填充字段。

已有文档不自动重写。PRD_REVIEW 阶段可点击“应用当前模板（新修订）”：保留原需求 JSON、ID、输出语言及生成方式，使用组织当前模板另存未批准修订。旧文件、模板快照及内容 hash 保留。操作要求当前 system version 和 prd_id；下发后禁止更新模板。此操作不调用模型，不自动批准或下发。已保存的组织自定义模板仍优先，不被默认模板覆盖。

模板含 `<!-- syseval:prd-layout-v3 -->` 时启用新版排版；旧模板继续使用原排版。`<!-- syseval:prd-appendix -->` 分隔正文和网页可折叠附录。新增 `document_status`、`security_details` 字段，问卷分组字段 `scope_questions`、`roles_questions`、`workflow_questions`、`functions_questions`、`data_questions`、`security_questions`、`acceptance_questions`、`release_questions` 均可自动填充。不要删除新版标记或覆盖校验所需的内容块。

English: v3 separates nine readable chapters from acceptance, implementation and provenance appendices. Security shows only domain headings and original control content, without losing project-specific prose or source mappings. Applying the current template creates an unapproved revision without model generation, retaining immutable history and existing authorization/version checks. Existing custom layouts remain in effect.

Offline regression coverage includes control-only grouping, multilingual source fallback, multi-domain and duplicate references, authored prose preservation, readable ranges, legacy template snapshots, immutable template refresh, stale IDs, supplier-stage rejection and appendix disclosure.

---

## 历史评审与通用契约



评审对象：用户提供的《应用开发 PRD 模板》1.0。原文保留于 `backend/app/templates/prd-reference.md`；实际默认布局为同目录 `prd.md`，采用 0–13 节结构及命名填充块。

## 结论

适合作为本项目的 PRD 参照模板。背景、角色、范围、流程、数据、验收和 AI 扩展覆盖完整；区分已确认、假设、建议和待确认，能降低生成内容被误当成业务承诺的风险。需求追踪和自检值得保留。

需要适配：

- 安全要求不能只用 NFR-003 一行概括。每条已纳入控制应关联项目需求、控制编号、源控制 ID、验收标准及评估锁定的控制库版本。
- 沿用系统 REQ 编号作为稳定主键，避免重新编号破坏供应商答复；验收编号使用 AC-REQ-…，而非独立重排。
- “已纳入”只代表需求范围，不表示已实现、通过验收或满足认证。自检仅对来源和覆盖作确定性判断，其余交由评审。
- 完整原模板对小型评估较重；默认布局保留所有主章节，已确认输入直接填入，尚未收集的交互、AI 边界等登记 Q，不能凭空补充指标、工期和责任人。
- 原模板 A/B 为作者使用说明，不作为生成正文或可执行系统指令。项目默认布局不带示例需求。

## 使用

Admin → AI 模型与提示词 → PRD 文档模板：上传 UTF-8 `.md`（最大 100 KB）、编辑内容并保存，或删除。只有管理员可更改，按组织隔离、版本校验并记审计。删除后新任务使用基础格式；已有文档及排队任务保持原模板。

支持 `{{name}}`、`{{document_info}}`、`{{summary}}`、`{{roles}}`、`{{scope}}`、`{{workflow}}`、`{{business_requirements}}`、`{{interaction}}`、`{{data_and_integrations}}`、`{{security_requirements}}`、`{{traceability}}`、`{{constraints}}`、`{{questions}}`、`{{review}}`、`{{ai_scope}}`。

自定义未知占位符转为带 Q 编号的待确认项；未放置的标准内容块自动追加。上传自由 Markdown 不会自动把任意自然语言字段推断为确认事实，建议使用上述块适配。模板中的静态正文作为管理员编写内容保留，应删除示例和不适用说明。

OpenRouter 任务同时收到锁定布局参照和已确认业务/控制输入；结构化输出仍受来源和全覆盖校验。规则草稿不调用模型，保留规则草稿标识。渲染不执行模板代码，不能通过模板删除强制业务/安全覆盖。修改 PRD 使用原模板快照，并形成新的文档与内容哈希。

本次不会替用户重新生成、批准现有评估 PRD；在控制审查完成后显式生成即可使用新模板。
