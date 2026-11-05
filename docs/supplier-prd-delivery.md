## 2026-11-05：逐项整改闭环（当前契约） / Scoped remediation workflow

本节取代下文历史记录中“保存后手动开启全量轮次”“来源 High 的 no/partial 只能经 AI 后接受”及“双方确认后手动转为待开发”的说明。

1. 负责人在同一复核表逐项选择接受或打回，填写理由与责任安排。高风险例外（no、partial、needs_clarification）须逐项确认，批量动作跳过；AI 仅提供建议，不代表负责人接受。
2. 点击“保存审查决定”同时提交当前 report_id 和 advance_workflow=true。授权负责人有 manage 权限时，在同一版本校验事务内保存决定：存在打回项则自动创建新轮次并下发；全部接受则自动冻结基线。仅有 review 权限的审查员仍可保存，推进操作由负责人执行。旧客户端省略该字段时保留先保存再推进的兼容接口。
3. 新轮次的 review_scope 只包含被打回的需求；每项 owner_feedback 保留负责人原文。已接受项保留不可变答复、报告结论、决定及其 round/submission/report 来源。供应商只填写整改项，API 和 CSV 都禁止改写已接受项；提交时服务端合并完整承诺。只改变某需求的一条结论时，该需求所有结论都须随新答复重新审查。
4. 提交仍不调用 AI 或自动排队分析。负责人显式开始本地规则审查或 AI 审查，任务只分析本轮整改项，并合并此前已接受的结论及决定。负责人可继续打回，重复此闭环；已接受项不再次分配给供应商。
5. 对来源 High 的例外或报告 high/critical 风险，负责人明确接受后，决定记录 residual_severity=medium。表格与最终稿显示“接受后：中风险”。来源控制、原报告严重度和供应商答复仍保留原值；不能把风险接受当作已实现或已验收。
6. 全部需求具有有效接受决定后自动冻结完整 PRD、全量供应商承诺和累计审查记录。双方仍须用不同账号确认同一 baseline hash。第二方确认的同一事务校验来源与完整性，自动将项目转为 PENDING_DEVELOPMENT。双方可下载同一不可变 Markdown 最终稿；单方确认不能下载，旧 finalize 命令仍幂等兼容。

轮次切换使旧报告/基线指针失效，保留旧 Submission、Report、Baseline、Confirmation 和审计。页面在供应商填写、负责人复核和双方确认阶段定时读取最新状态，旧复核链接也能进入当前整改表。新报告只承接未变化且已接受的需求；作用范围、来源或 PRD 改动仍走原修订与重新双签流程。

无数据库结构迁移，不清空运行数据，不从未保存的表单猜测负责人批准。已有全量历史轮次没有逐项决定时不会追认接受；负责人须审查当前提交并保存后进入此闭环。

English: New owner saves atomically open a round containing only returned requirements, or freeze the all-accepted agreement. Server-owned carry-forward snapshots preserve accepted answers, findings, decisions and their original provenance. Scoped drafts, submissions and CSV imports cannot modify accepted items. Explicit local/model review analyzes only returned requirements; no supplier submission calls AI. Individual acceptance records Medium residual risk separately from immutable source ratings and report severity. The second independent same-hash confirmation automatically finalizes the baseline and enables both parties to download the same final PRD. Legacy save-only API clients and explicit finalization remain compatible.

Regression: test_negotiation_rounds.py exercises three rounds, partial submissions, answer/decision tampering, version and report conflicts, idempotency, organization boundaries, carried risk decisions, independent confirmation and final export. Source-risk/contextual tests retain evidence validation; frontend tests cover scoped rendering, owner feedback, automatic navigation and separate source/accepted-risk display.

# PRD supplier review, contextual risk and delivery (2026-11-04)

## 6. 供应商复核 / Supplier PRD review

供应商使用独立账号登录，导航仅保留供应商复核、复核结果、双方确认、开发进度追踪四步。旧 `/prd` 链接重定向到 `/supplier`，客户侧 PRD 审批及下发仍保留。

需求按业务功能/控制需求分类，控制需求按本轮发布时固定的来源控制域分组，支持域、答复状态及正文搜索。全量与各域分别显示已完成/总数、未填写/总数，筛选不改变答复或总体进度。验收条件、来源和例外输入默认收起；完整 PRD 仍可查阅。

勾选“可以按本项要求完成”即可完成答复，不要求额外工期、负责人或实施方案。部分完成、无法完成、需要澄清项要求填写原因或待澄清内容，可补充补偿性措施和预计工作日。已有交付安排、原文和历史轮次保留；若提供工期或日期，继续校验正数整数范围及日期顺序。批量填入仅填未触碰项，不覆盖已勾选的简单承诺。

草稿自动保存；正式提交形成不可变轮次并进入负责人复核，立即展示开发项确认汇总，不创建规则或模型分析任务。可完成只是供应商承诺，不视作已实施证据；没有实施方案时，本地规则预审引用实际的 implementation_status，并保持证据待验证。待澄清与风险审查不会因答复完整自动通过，高风险待澄清项由负责人逐项决定；双方独立签署相同基线 hash 的规则不变。

Supplier review uses four navigation steps and a compact, filterable domain list. A Yes checkbox is a complete response. Exceptions require an explanation; compensating measures and estimated workdays are optional. Domain labels come from immutable round control snapshots, not current controls. Historical authored data, autosave, version checks, immutable submissions and independent owner review remain intact.

## 7. 影响评估 / Contextual impact assessment

本说明替代早期“来源 High + no 永久直接失败”的规则。来源 High 等级保持不变。
2026-11-05 起，正式提交仅记录供应商承诺，忽略旧客户端的生成模式参数，不启动 OpenRouter 或本地分析任务。
负责人在同一张按域分组的复核表中查看确认汇总、风险依据和逐项决定；无报告时显式选择本地规则辅助的人工审查或 AI 影响评估。
来源 High 未完整承诺项不能因汇总已展示而绕过冻结检查。no/partial 保留情境评估门槛；needs_clarification 由负责人逐项决定并记录理由，详见下文。
客户可在冻结前显式重新进行 AI 影响评估，形成新的报告，原报告保留历史且审查决定重新填写。

供应商轮次固定控制、业务说明、定级和问卷快照；模型只能使用这轮来源。早期没有问卷快照的轮次
不会从当前草稿补造历史证据。AI 输出暴露面、利用前提、缓解措施、不确定项及事实路径和原文引用。
服务端验证事实路径与引用；未提供有效分析时仍使用保守的本地严重度。
离线不自动消除本地接触、移动介质、内部人员或供应链风险。

来源 High 的 no/partial 项，只有与当前不可变提交关联的 AI 报告，且本项所有结论的残余风险为 low/medium、有事实依据并无
未确认条件时，才开放客户接受入口；仍需客户填写责任及风险接受理由。
来源 High 的 needs_clarification 项始终显示为需负责人逐项决定：可选择接受待澄清风险并记录责任理由，或要求澄清/修改。
接受需要该项显式 owner_reviewed=true、非空理由、当前提交对应的已审查报告；批量操作跳过这些项，模型降低严重度不代表负责人决定。
未决定、未保存、要求澄清、缺失逐项确认标记或报告已更换时，继续阻止冻结。冻结、双方确认与最终待开发均重复检查同一门槛。
本地规则结果和 AI 结果在界面保留不同标识；来源 High 与情境残余风险并列展示。

Large impact reports use at most 12 requirements per model request. Coverage, exact supplier
quotes and contextual evidence references are validated; findings receive unique server-owned
IDs, usage is accumulated, and the worker lease covers all bounded calls. A completed job is
published only if its source hash is still current. Single-item assistance is advisory and
does not replace the persisted full report or its customer review.

单条“AI 分析残余风险”仅发送当前项固定的控制原文（含来源标识、原始风险）和本轮已提交供应商答复（状态、方案、原因、补偿措施）。不发送系统信息、定级、问卷、协商要求、其他控制或开发项。无关联控制的业务需求仅使用本轮发布的需求原文，不补造控制来源。专用提示词和结构只返回 residual_risk：一两句简短残余风险，中文优先控制在100字内，输出硬上限240字符；不显示处理建议、待核实清单或引用列表。不推断未提供的系统事实，补偿措施尚未验证时在同一句风险中说明条件。

调用失败仅在对应条目显示具体原因，服务端保留安全错误码、条目关联和用量审计。单条建议不改写报告、来源风险或负责人决定，不开放接受或冻结入口；完整影响报告仍沿用原情境证据校验和审查门槛。

Single-item AI receives only the pinned control clause and submitted supplier response. Its dedicated schema returns a short residual_risk string (one or two sentences, maximum 240 characters), with no recommendations, evidence list or system context. Advice does not change the persisted report, owner decisions or acceptance gates. Full contextual report validation remains unchanged.

## 8. 双方确认与最终稿 / Joint confirmation and final document

两位不同身份分别确认同一个不可变基线 hash 后，双方均可下载 Word（.docx）最终稿：
`GET /api/v1/baselines/{id}/document?format=docx`。内容包含原发布 PRD、逐项供应商承诺、AI/规则影响结论、
客户决定、例外审查、双方确认身份与时间、基线和 PRD 指纹以及完整基线记录。
下载验证组织权限、当前基线、独立双签和指纹，不从可编辑草稿拼接；单方确认时不可下载。
客户继续通过“保存并转为待开发”最终发布开发状态，不借下载操作代替确认或发布。

The final Word document is rendered from the jointly confirmed baseline and its immutable
PRD. Downloads cannot substitute for either party's confirmation. No database migration is needed.
PRD review and corresponding-version download links also use `?format=docx`; authored text,
source appendices and embedded raster topology are retained. Omitted `format` or explicit
`format=markdown` preserves the Markdown response and existing web preview. Exporting does
not call AI, create a revision or change any baseline hash or approval record.

## 9. 开发进度追踪 / Evidence and AI assessment

供应商导航包含开发进度追踪。客户开启交付任务后，本系统页面直接展示总览、筛选和逐项证据卡；
供应商填写材料并“保存并提交验收”，客户在独立人工验收区通过或退回。历史轮次和重新打开原因分别展示。
界面、统计及流程详见 [开发追踪说明](development-tracking.md)。
新基线交付任务按 PRD requirement 去重，只纳入承诺 yes/partial 的开发项；无法完成且接受风险
的项目保留在最终稿中，不制造虚假的开发任务。既有交付批次和整改计划不重写。

供应商上传截图、代码文本、PDF/DOCX/XLSX 报告或文本记录，指定环境、版本、采集日期，并映射到
每条验收条件；文件不执行。仍执行 20 MiB/附件、10 文件/提交、100 MiB/提交等原有界限和校验。
配置模型后正式提交自动排队 AI 分析；未配置、预算受限或请求失败不丢失已提交证据，可显式重试。
后台复用持久化 Job、幂等请求、版本检查、模型配置快照、usage 预算与审计。

`delivery_evidence:<submission-id>` reads actual submitted file content, not just names. Text
extraction is bounded to 16,000 characters per file and 40 PDF pages. Screenshots are supplied
as image inputs through the existing OpenRouter adapter (the configured model must support
vision). Scanned PDFs without extractable text, unreadable data, embedded office images and
truncation are explicitly marked incomplete; affected criteria cannot receive an automatic PASS.
Screenshots can be uploaded separately when a report's image evidence needs visual assessment.

每条验收条件返回 PASS / FAIL / NEEDS_MORE_EVIDENCE、具体依据和本项附件引用；服务端校验完整覆盖
与附件归属，读取不完整时下调为需补证。结果绑定源 hash、提交 manifest hash、条目版本，来源变化后
正在生成的结果标记 stale。AI 建议和人工验收结论分别展示，AI 不代替客户签署 PASS，也不改变原基线。
外部模型仅通过服务端配置调用；回归使用离线模型桩，不消耗真实模型调用。

Regression coverage: `test_contextual_delivery.py`, `test_source_risk.py`, existing delivery
workflow tests, and frontend supplier/impact/delivery interaction tests.

供应商控制域筛选位于正文左侧，保留每域完成数/总数，并提示高风险数量。需求标记“高风险”及“只看高风险”筛选取自本轮发布时固定的来源控制风险，不随当前控制库修改、语言切换或可完成勾选变化；不代表影响分析结论。筛选组合不会清除已填写答复。窄屏域导航移至正文上方。

供应商“一键填入 Demo”包含三项固定演示例外：远程管理鉴别信息保护为无法完成（20 个工作日用于方案评估验证）；防恶意代码软件与库更新为需要澄清（5 个工作日）；外部人员书面审批、开户及备案为需要澄清（3 个工作日）。按中文来源条款内容匹配，不依赖生成的 REQ 编号；英文界面填入对应英文样例，切换语言不会改写已有答复。样例显式标记为演示，含原因、补偿措施和计划，仍需负责人判断；仅填入/保存草稿，不自动提交或确认。其余需求保留原 Demo 可完成策略，撤销恢复填入前全部答复。

供应商需求域导航红圈统一表示“需关注项”：无法完成的全部需求，以及来源高风险且尚未承诺可完成的需求（部分完成、需要澄清、未填写）。计数、条目浅红背景和红色侧边、需关注筛选复用 answerNeedsAttention，按需求去重；已填写说明不表示高风险已解决。全部域显示分类总数，单域显示域总数，不受筛选影响。可完成的高风险项保留来源高风险标记及数量，但不计入红圈；答复状态直接显示部分完成/需要澄清/无法完成，不再把已填完的例外显示为绿色。答复完整度与交付可完成性独立。


## 2026-11-05：提交后展示开发项确认汇总 / Commitment summary after submission

`POST /systems/{id}/supplier-submit` 保存不可变 Submission，返回 `submission_id`，直接进入 `RESULT_REVIEW`，不返回新 `job_id`。即使模型已配置、客户端传入 `mode=openrouter` 或模型预算耗尽，也不会启动或依赖分析任务。后续审查由负责人显式发起。缺少报告时审查决定与冻结仍返回业务校验错误，不能绕过逐项人工决定或双签。

`system_view.supplier_review` 从该可访问轮次的发布 PRD、固定控制快照和已提交 Submission 读取；不从可编辑 draft、当前选择或当前控制库推断。未提交的新轮次返回 null，旧轮次、报告及基线不修改。供应商只能看到自己可访问轮次的内容，组织权限不变。

确认程度 = yes / 全部唯一 PRD 开发项。部分完成、无法完成、待澄清分别统计；中高风险未确认 = 来源为该等级且答复不是 yes。一个开发项关联多个控制时按 High、Medium、未知、Low 的保守顺序取等级并仅计一次；缺失来源不推断为低风险，业务功能计入确认度但不虚构控制风险。来源六字段风险沿用中文固定字段，切换语言不修改原文。确认度不是合规率、实施完成率或验收结果。

界面采用汇总卡、需关注/中高风险/已确认/全部筛选和按域表格。保留开发要求、控制来源原文、供应商原因及补偿措施；报告存在时在同一表格显示风险与辅助分析、负责人审查两列，无报告时显示显式开启审查的入口。AI 仍需主动发起，供应商提交及页面进入不会触发分析。开发阶段证据验收流程保持独立。

English: supplier publication only records commitments and returns an immediate read-only summary. It never queues analysis, even with configured AI or legacy generation parameters. The owner explicitly starts subsequent local-rule or AI review. Counts use the immutable submission and pinned source risk, deduplicate requirements, preserve unknown ratings and authored text, and distinguish commitments from accepted delivery. Existing independent same-hash confirmation remains mandatory.

Offline regression: `test_supplier_review_summary.py`, explicit-review workflow journeys, and `supplier-review-summary.test.tsx` cover no automatic generation, immutable evidence, authorization, counting, filtering, language preservation and manual initiation.

后续影响任务以 `impact_analysis.requested` 记录审查动作，避免将审查员发起规则/AI 审查误记为需求编辑而剥夺其复核权限。旧失败分析提示仅在审查工具栏显示；历史记录本身保持不变。


## 2026-11-05：高风险待澄清项由负责人决定

来源高风险 + needs_clarification 的结论即使严重度为 unknown，也在复核表中显示负责人决定，并纳入来源高风险未确认计数与筛选（按开发项去重）。表格并列保留“来源高风险 · 待澄清”、原始依据、负责人决定及责任理由，不将模型/规则 unknown 改写为高残余风险。

逐项选择接受时写入 `owner_reviewed=true`；两个批量动作都跳过高风险待澄清项。`source_assessment` 返回 `clarification_requirements` 和 `owner_accepted_requirements`，后者仅依据当前不可变提交关联的已审查报告及逐项决定计算。接受不会把供应商答复改成 yes，也不降低来源风险或修改原报告结论。报告重生、轮次更换后需要重新决定。no/partial 的原有门槛保持不变；独立双方确认同一 hash 继续必需。无数据迁移或运行数据重置。

English: source-High clarification is prominently expanded and included in high-risk filters even when report severity is unknown. Authorized customer reviewers decide each item individually, with rationale; bulk actions skip it. Explicit accepted clarification is bound to the current reviewed report and immutable submission, without changing source risk or supplier status. New reports/rounds require fresh decisions, and independent same-hash confirmations remain mandatory.


## 2026-11-05：复核表融合审查与双方确认 / Integrated review workspace

移除独立“后续审查与双方确认”折叠区和重复风险卡片，沿用确认汇总、蓝色筛选按钮、按域表格与浅色风险行。报告就绪后，每行并列显示开发要求、供应商答复、风险与辅助分析、负责人审查；原文和详细风险依据可在行内展开。同一开发项的多条报告结论逐条显示并独立决定，待负责人审查按开发项去重计数。切换筛选、状态、搜索或界面语言不丢失未保存决定或已生成的单条 AI 建议。

工具栏统一承载本地/AI 报告标识、批量处理和按需完整 AI 评估。新报告生成前要求先保存当前决定；供应商提交和页面访问均不自动调用 AI。批量可实施项优先读取不可变提交的确认状态，高风险待澄清项仍跳过批量决定。表格底部统一展示全量开发项完整性提醒、保存、协商及冻结入口；筛选隐藏项仍参与完整性校验。已有基线显示双方确认状态和独立确认页入口，不代替任何一方确认。

The commitment table now contains per-item risk assistance and owner decisions. There is no separate duplicate card workspace. Filters preserve draft decisions, multiple findings remain independently reviewable, and pending counts deduplicate requirements. Shared footer actions retain permission, source-risk, revision, review-completeness and independent same-hash confirmation checks. No backend contract or runtime migration changes.


## 2026-11-05：移除独立例外审查，加入负责人审查 Demo / Review Demo and retired exception field

复核页移除“例外与排除项审查”、计数及说明输入，不再因 exception_reason 缺失而阻止保存。审查接口仍要求当前报告的全部结论都有决定与非空理由，并保持组织、版本、来源高风险与逐项负责人确认检查。新客户端不发送 exception_reason；旧客户端可继续提供非空文本。省略、空白或 null 不清除已有 `_exceptions` 历史原文；不自动制造“已审查”记录。历史基线和指纹不重写，历史说明继续可在其基线和最终稿中查阅；无历史说明的新基线不生成空白例外章节。

本页“一键填入 Demo”按固定控制条款和供应商状态识别三个示例，不依赖 REQ 编号：远程管理鉴别信息保护无法完成 → 要求修改或补充证据 / “使用指定工具”；防恶意代码待澄清 → 接受 / “定期进行漏洞和系统安全评估”；外部人员接入待澄清 → 接受 / “需经过正是审批流程”（保留用户原文）。英文界面填入英文示例，切换语言不改写已填内容。只填入匹配的三项，不覆盖其他条目；同一需求有多条报告结论时不推断对应关系。

Demo 仅修改当前表单，可撤销恢复填入前的全部决定及未保存状态，不调用模型或自动保存。高风险待澄清的接受示例不携带 owner_reviewed 授权，需要负责人在行内逐项确认后再保存；来源高风险无法完成项的接受门槛保持不变。其余可完成项仍可通过原“一键接受可实施项”处理。报告更新后重置 Demo 撤销范围，供应商及只读用户无填入入口。

The separate exception-review field is retired across the UI and review API. Legacy authored notes remain immutable in historical baselines and are preserved on re-save when omitted by new clients. Review Demo fills only the three clause-matched examples, supports undo, and performs no automatic save or AI call. Suggested High clarification acceptance still needs an individual owner acknowledgement; existing source-risk and independent same-hash confirmation checks remain in force.

Regression: `test_review_without_exceptions.py`, source-risk tests, `review-demo.test.ts`, and integrated review interactions cover optional legacy fields, historical notes, item completeness, explicit owner acknowledgement, clause matching, undo and independent confirmation.
