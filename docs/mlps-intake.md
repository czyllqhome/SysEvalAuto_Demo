> 2026-11-05：AmerSports-2.18 / 规则引擎1.8.2 移除原定级 G02（来源 B03，`independent_business`）及其 QA01 边界复核规则。定级页现为14题，展示编号顺延为 G01–G14；缺失、否、不确定均不再触发该题的必填或复核。历史答案、说明、已确认结果及基线保留；重新计算使用新规则。责任主体校验继续有效，无需数据迁移或重置。
>
> English: The former G02 independent-business question and its QA01 review rule are retired. Grading now has 14 questions. Historical answers and confirmed snapshots remain intact; new calculations ignore this field. Responsibility checks remain active.

> 当前 AmerSports-2.17 / AMER-INTERNAL/5 / 规则引擎1.8.1：公网可访问入口最低2级，无公网入口最低1级。历史结果需重新计算确认后更新。

> 应用说明以 PRD 初稿展示，增加问卷部署/业务连续性事实和安全开发需求占位。正式 PRD 将已纳入控制按控制域分组，跨域需求以联合域分组，保留来源与验收引用。

> 应用说明审查移除“范围与不做事项”输入及必填校验，已有值保留。

> A05 和 A06 支持逐条添加、编辑及移除。原有多行文本按行显示，保存和 AI 优化沿用文本格式。A05 各条分别预填为应用说明功能项。

> 系统信息录入页面退役：确认分级后直接审查应用说明，旧 discovery 链接重定向。无历史描述时以已确认问卷预填可编辑说明，缺少职责/范围须人工补齐并确认；历史描述及说明保留。

> 问卷每页提供直接查看系统等级入口，填写完成后先保存再计算跳转；沿用完整性及失败校验。

> 参考底稿选择器移至“等级如何得出”卡片内右下角，与内部下限并列。

> 结果页将内部下限与核心影响卡片合并到“系统分级依据”同一网格，保留各自刻度及对应等级。

> 当前 AmerSports-2.16 / 规则引擎1.8.0：只以当前可见问卷字段进行分级。退役 B11 承载对象、B12 特殊边界及大数据平台适用性题，取消承载下限和相关结果卡片。历史答案保存但不参与当前结果。B04 对接等级、D01 数据类别明细仍按所选答案展开；未展开的旧答案不影响等级或复核。E09/E10 仅校验当前所选客体，其他客体不再要求补答或理由。旧个人信息开关不再决定当前字段显示或规则。Current grading uses visible questionnaire inputs only; historical answers remain stored.

> 承载系统下限说明按实际情况显示：非支撑平台、承载等级/证据待核实，或已确认最高等级，避免与 B04 系统交互规则混淆。

> 结果页移除“哪些答案决定了等级”摘要区，等级依据通过内部下限及核心影响卡片展示。

> 参考底稿选择器标题采用16px常规字重，与相邻等级标题一致，下拉框18px，标题与下拉框间隔16px，移除下方说明文字。

> 内部等级下限依据采用只读1–5级滑动刻度卡片，显示原答案、对应最低等级与规则说明，突出决定内部下限的项目。Internal minimum drivers use read-only level 1–5 score bars.

> 结果页参考底稿选择移至建议等级旁，支持自动匹配及手动选择 MLPS 2/3 级；1级使用2级参考，4/5级仍需专业复核。移除额外复核提示面板，B03 否与未确认分别提示。特殊原则下限明确为承载系统等级下限。

> 等级结果页与 E09/E10 使用相同客体选择逻辑，仅展示当前问卷中的判断卡片，隐藏历史其余客体卡片。Grade-result impact cards now follow the questionnaire selection.

> E09/E10 已移除“其余客体”说明、批量无侵害确认和历史判断面板；已有答案及理由继续保留。E09/E10 no longer show the other-party panel; saved judgments and rationales are preserved.

> 当前 AmerSports-2.15 / 规则引擎1.7.0 / AMER-INTERNAL/4：D04记录量四档下限1/2/3/3级，容量四档下限1/2/3/3级，分别以organization_rule_trace.subfield=records/storage记录；E06外部同步影响选是最低2级，E07安全/社会稳定影响选是最低3级。D05一般1级、重要/核心/混合3级，D06跨境选是2级也已接入。未知或未完整填入的下限来源须核实，不降低矩阵或其他较高下限。
> E09/E10 移除新增另一类受侵害客体按钮，保留已有判断、理由及显式确认其余客体无侵害的流程，不自动把未知影响改为0。历史多项判断仍保留并参与计算。
> 经用户明确确认，指定评估和Demo的人数已更新为“超过50,000人”，通过正常保存流程写入；原数据库和Demo快照备份保存在.syseval/backups。旧10,001–100,000选项不再出现在下拉框；其他历史记录仍可读取，需选择新档位才能计为完成。
> Record count and storage volume independently establish level 1/2/3/3 minima. External dependency impact establishes level 2 and safety impact level 3. The affected-party add button is removed without dropping historical judgments or treating unknowns as zero. The authorized source assessment and Demo population were saved as Over 50,000 after verified backups.

> C04/C05 展示调整：移除公共服务和业务重要性题目下方的中英文等级下限提示；选项、计算规则、结果来源及分级方法说明保持不变。
> C04/C05 inline minimum-grade hints are removed in both languages; options, calculation and result attribution remain unchanged.

> C02 展示调整：移除题目下方“涉及交易时最低2级”的中英文提示；交易内部最低2级的计算、结果来源与分级方法说明保持不变。
> The C02 inline transaction-policy hint is removed in both languages; the internal level 2 minimum remains in calculation, result attribution and methodology.

> 当前 AmerSports-2.13 / 规则引擎1.5.0 / AMER-INTERNAL/2：C02涉及交易最低2级；C04公共服务或公共设施支撑最低2级；C05非核心/重要辅助/主要业务核心最低1/2/3级，移除核心公共服务/关键生产选项。D01人数三档为0–10,000（1级）、10,001–50,000（2级）、超过50,000（3级），另保留不确定；恰好10,000归第一档、50,000归第二档。各项与既有网络/对接下限、特殊原则、矩阵结果取最高，轨迹包含题号与原答案。
> 历史人数与旧业务选项不改写：同一新档位内的历史范围可沿用；跨档范围仅用下界确定已知最低值，必须重新选择才能确认。明确未知业务属性/人数也待复核；无个人信息时不使用隐藏人数。C02/C04/C05为确认所需字段。原Demo历史范围保留，不猜测实际人数；需按新档位确认。
> New public-service, transaction, business-importance and population inputs establish organization-specific minima. Numeric boundaries are contiguous, history remains intact, cross-band historical values require refinement, and the national-standard matrix remains unchanged.

> B07–B10 网络区域、互联网入口、外部单位连接、系统间接口四个题干改用“预计／计划”措辞，英文题干同步；字段、编号、已有答案、Demo内容及规则不变。
> The four network-detail prompts now use expected/planned wording in both languages; answer keys, saved text and grading rules are unchanged.

> 当前 AmerSports-2.12 / 规则引擎1.4.0：B04选是，补充对接系统最高已确认等级（1–5级或不确定）；本系统内部下限取该等级。B06仅经VPN/零信任=3，受控互联网=2，公众入口=1，无=不触发网络下限。结果取国家标准矩阵、适用特殊原则、企业内部下限的最大值，分别保留 base_level / special_principle_minimum / organization_minimum 和来源轨迹 organization_rule_trace（AMER-INTERNAL/1）。新规则属于用户指定的企业内部规则，不作为 GB/T 矩阵条款。未知对接等级或未知网络入口阻止确认；内部下限不能消除未知影响，四五级仍转专业复核，控制参考库不足仍拦截。原Demo没有对接等级，保留原答案，不推断新增下拉答案。
> B04/B06 now establish explicit Amer Sports internal minima, separately traceable from the national-standard matrix and special principles. Effective grade uses the maximum; unresolved impacts, unknown internal inputs and reference-library limitations retain their existing confirmation safeguards.

> 当前 AmerSports-2.11 / 规则引擎1.3.0：D01 题干改为“系统收集、存储、使用、加工、传输、提供或删除哪些类型的数据？”。个人信息或敏感个人信息触发既有总人数子问题；敏感个人信息另填类别、人数；重要数据/核心数据分别填内容、用途和认定依据。所有明细均在D01内展开，选择后需完成才能计为已填写。原D02退役，用户总数现为D02，其他主问题顺延连续编号。历史字段/答案/来源编号保留，不重写数据库。
> D01 derives personal-information applicability from selected categories (sensitive personal information also implies personal information), overriding the retired Yes/No answer. Non-personal categories yield No; Unknown remains unknown. Older drafts without D01 retain a compatibility fallback. Deselected details remain saved but do not trigger current population alerts. Control-matching data.personal uses the same derivation; the grade matrix is unchanged.
> Demo仅移除退役的处理个人信息开关，保留原有人数与其他答案；模式适配后39道主问题全部可填入，旧模板备份保留。

> 当前 AmerSports-2.10：D02 人数子问题改为五档：0–1,000、1,001–10,000、10,001–100,000、100,001–1,000,000、超过1,000,000人，另保留不确定。100万整归第四档，超过100万从1,000,001人起。历史区间、数字与原上下界保留，不自动替换；现有Demo的10,001–100,000人仍适用。规模提示仍只由已知区间下界触发，不据此自动提高矩阵等级。
> The personal-information count now uses five contiguous bands plus Unknown. Historical values retain their original bounds; alerts use known lower bounds and do not raise the matrix grade.

> 当前 AmerSports-2.9：注册或授权用户总数移到 D03，后续 D 主问题顺延，存储键和原来源编号不变。Demo 已从用户指定评估的最新已保存草稿重新捕获，包含完整40题和交易题答案；记录来源版本与捕获时间，旧模板备份保留在 .syseval/backups。原组织范围、撤销、版本检查与显式确认不变。
> Registered users now appear at D03 with following questions renumbered. The Demo snapshot was refreshed from the authorized source assessment and covers all 40 visible questions, including transactions; provenance and the previous snapshot are preserved.

> 当前 AmerSports-2.8：C02 新增是否涉及交易（是/否/不确定），仅收集业务事实，不自动提高等级。registered_users 移至 D 末尾，模式编号 D12，界面按可见问题连续编号；原来源 C02 和历史答案不变。51个有效字段、最多46道主问题/组合，当前Demo条件下共40题。Demo固定快照原39题保持不变，不推断新增交易题答案，需手动补填。
> C02 now collects transaction involvement. Registered-user ranges move to D with stable storage keys and saved values. The original Demo snapshot remains unchanged; transaction involvement requires an explicit answer.

> 系统等级展示：移除“检查与初步结果”问卷步骤。末章完成后“下一步：查看系统等级”先保存、再自动调用确定性计算，进入独立结果界面；失败时保留问卷。结果展示两维度等级、特殊原则下限、决定最高等级的答案、六项损害程度计分条及原判断理由。未知值不作为0绘制；计分条仅展示，修改从问卷进入。参考库选择与等级独立，仍需显式确认，所有后端复核与版本检查保留。
> Completing the final questionnaire section saves answers and opens a separate grade screen automatically. Causal drivers and read-only severity bars reflect the server trace; unknowns remain distinct from zero. Existing explicit confirmation and review gates remain intact.

> Demo 模板：从用户指定评估 86a91743 的已保存问卷固定快照，含39道可见主问题、RTO/RPO、部门对接人和判断理由；不包含退役字段、附件引用、评估状态或控制库ID。仅向源组织的已授权评估用户提供。总流程条下方靠右“一键填入 Demo”仅修改本地草稿，可编辑、可撤销；保存沿用版本/组织/修订检查。历史退役答案保留，按钮不触发模型或自动确认。
> The frozen Demo snapshot is scoped to its source organization. Explicit fill changes editable local inputs only, with Undo; normal versioned saving and independent confirmation boundaries remain in force.

> 当前 AmerSports-2.7：A–E 五章节。E 更名“业务连续性与影响分析”，原 F 两组影响判断移为 E09/E10，其余六题退役。50个有效字段，最多45个主问题/组合；损害程度与客体完整解释直接显示于下拉选项，不再使用感叹号。历史答案和来源编号保留，定级矩阵及判断理由要求不变。
> Five sections now include impact judgments E09/E10 under Business continuity & impact analysis. Former scenario prompts are retired with saved answers preserved. Full bilingual explanations appear in dropdown options; matrix rules and rationale requirements remain unchanged.

> E02 更新：同时收集 RTO/RPO，单位小时，可填小数、0 或分别选择不确定；两项完成后才计为已填写。旧 maximum_tolerable_downtime_h 仅保存在历史数据中，不在 E02 显示，不自动映射为 RTO。新答案使用 recovery_objectives_h 字典的 rto/rpo，定级矩阵不变。
> E02 collects independent RTO/RPO targets in hours, including decimals, zero and Unknown. Historical tolerable downtime is preserved separately; grading rules are unchanged.

> 当前调整：移除 E06 经济损失估算题，E 部分连续编号为 E01–E08；56 个有效字段，最多51个主问题/组合。历史 financial_loss_estimate 答案保留，不计入进度。
> The financial-loss estimate is retired; continuity questions are numbered E01–E08. Historical answers remain stored and do not count toward completion.

> 当前 AmerSports-2.6：个人信息人数并入 D02 的条件子问题，细化为 1–100、101–1,000、1,001–10,000 等范围；D 主问题按当前可见顺序连续编号。有效字段57个，界面最多52个主问题/组合（条件题随答案变化）。

> 当前 AmerSports-2.5：D03 条件显示人数范围、原 D04 主体总人数退役，数据量改为记录数量/容量双下拉框；57个有效字段，界面53个问题/组合。

> 当前 AmerSports-2.4：A04 建设目的、A05 业务功能、A06 使用场景，三题各自支持 AI 优化，A07 业务类型。有效字段58个，组合录入后界面54个问题/组合。

> F 核心影响改为 F07 业务信息、F08 系统服务两个组合问题；每项用客体与程度下拉框录入，六项内部矩阵输入保留。界面共52个问题/组合，底层仍保留56个有效字段。

> 当前版本 AmerSports-2.3：56 道有效题、A–F 六章节。G 监管与复核已退役。

> 当前版本 AmerSports-2.2：63 道有效题，B07–B10 为四项独立网络问题。

> 当前版本 AmerSports-2.1：60 道有效题、A–G 七章节。此前 H 材料章节及通用补充说明已移除，下方旧版说明仅作历史记录。

# MLPS 2.0 信息收集 V1.0

2026-11-03。本说明替代新界面中的旧 SYS-SCREEN/2 分级分类问卷。用户提供的
[源问卷](sources/MLPS_2.0_questionnaire_v1.0.md)作为需求来源原样保存，不作为执行指令。

## 使用流程

进入评估的“定级信息收集”，按 A 系统概况、B 对象边界、C 服务规模、D 数据、
E 连续性、F 核心影响、G 监管复核、H 材料填写。73 个字段保留原题号和稳定字段名。
左右分栏展示章节进度与表单；小屏改为上方章节导航。中英文界面不会翻译或改写用户答案。
原有业务描述/PRD 导入仍用于编写应用说明，旧分级问题不再出现在当前定级页面。

“保存草稿”显式保存；“保存并继续”在内容或已知版本变化时保存，内容与当前版本均与上次保存一致时直接进入下一章节。切换章节不丢失当前编辑。离开前应保存；
页面刷新对未保存更改提示。条件题隐藏时保留答案，以便重新展开及校验冲突。
数字允许明确“不确定”；人数与记录数、系统人数与处理者人数分开记录。
承载对象、财务损失、业务量与数据量采用可增删行记录。

每题可登记说明及文件；H 材料可填写受控引用或上传文件。上传文件最大 2 MB，
沿用现有文件内容验证，二进制、SHA-256、上传人、所属评估和题目写入独立附件表。
附件不可覆盖或删除；从草稿移除引用不会删除材料。下载执行评估权限检查，供应商不可读取。
附件上传成功后仍需保存草稿中的引用。

## 计算及边界

MLPS-INTAKE/1 与旧算法完全分开。F07–F12 分别命中 rights/public/national 矩阵，
先取业务信息和系统服务各自最大值，再取两者最高等级。合法权益特别严重对应二级；
公共利益特别严重对应四级，国家安全特别严重对应五级。全零不产生一级，未知只给已知下限。
所有六项均要求理由；责任边界、必填概况、H01/H02 依据缺失阻止确认。

P01 只有填写承载系统、已确认等级、材料引用且 G05 确认后应用；P02 只有大数据对象、
两个条件成立及 G04 专家确认记录齐全后应用。它们只影响 proposed_level，不改写 base_level。
公网、系统人数 100 万/1000 万、处理者人数 1000 万等生成单独提示，不改变矩阵等级。
前述阈值是随本问卷版本固定的示例审核分档；本次未新增组织策略编辑器。

行业规则、国家安全影响保留待专业复核状态，不提供“接受提示即可通过”的绕过。
本次不实现完整行业规则注册/批准系统，也不实现专家、主管部门、公安备案的线上审批流程。
用户在 G 项记录复核资料；系统不自动宣称完成官方审批。四、五级保留真实结果，
不能继续使用二级、三级库替代；选择低于建议等级的库同样阻止确认。

校验覆盖必填、对象边界、未知/全零影响、个人信息矛盾、敏感人数超总数、公共影响矛盾、
国家安全复核、特殊对象证据和历史降级解释。自由文本中停机后果的一致性需人工核对，
不通过关键词推断损害程度。

## 保存、权限与升级

新草稿位于 System.draft.mlps_intake，旧 screening/tag_profile/问卷及历史文档保持原样。
保存已确认信息的变更通过既有 invalidate 路径产生修订，使后续文档及确认待更新。
确认重新计算服务端结果，保存问卷/规则版本、题库哈希、答案、解释、矩阵轨迹及来源名称；
保存和确认的完整快照进入现有 Audit 表。组织权限、版本冲突、CSRF、幂等命令保持不变。
控制匹配采用明确选择的 MLPS 来源库，新的矩阵不会被下游旧五题模型字段覆盖。

新增迁移 `mlps_intake` 接续 `direct_assessments`，仅创建 `mlps_intake_evidence`。
本地启动自动加表。升级前用 SQLite backup 保存一致性备份，运行数据仍为
Demo `.syseval/assessment.db`，禁止删除或重置。测试只使用隔离数据库。

API：GET/PUT `/systems/{id}/mlps-intake`；POST `.../preview`；
POST `.../evidence`；GET `.../evidence/{id}`；确认复用 classification-confirmations。

## English

The active classification page now uses the source questionnaire's 73 fields across eight sections.
Six independent impact judgments drive a level 1–5 matrix; exposure and population alerts never
raise the matrix result. Drafts, explanations and evidence are versioned and isolated by assessment.
Legacy records remain intact. Sector-rule approval and official expert/regulatory/filing workflows
remain external; unresolved cases cannot be confirmed automatically. Level 4–5 results are preserved
and cannot proceed through the current level 2/3 reference libraries.

## 验证记录

2026-11-03：297 项后端确定性回归、71 项前端测试、Ruff、TypeScript 与生产构建通过。
隔离数据库下的 Edge/Playwright 检查通过保存重开、附件上传、六项影响、未知拦截和
390px 窄屏无横向溢出。用例为 `frontend/evals/e2e/mlps-intake.spec.ts`，须显式设置
`SYSEVAL_MLPS_E2E=true` 并将 `SYSEVAL_E2E_URL` 指向隔离测试服务。
新增规则及 API 用例见 `evals/deterministic/test_mlps_intake.py`。

2026-11-03 流程调整：创建后先进入“系统定级”，确认初步建议后进入“系统信息录入”，保存描述后继续审查应用说明。未确认等级时系统信息入口不可用，旧 discovery 深链接跳转至定级页面。已保存描述与历史评估保持原样。

可读性更新：进度数字 44px、总数 23px、题目 20px、回答 18px、提示 16px，采用无衬线中文字体及深色文字；窄屏保留进度统计。分级方法页展示 3×3 矩阵、两维度六项题号、最大值计算示例、0/9 处理和 P/R/T 规则边界。

界面精简：问卷标题右侧不再显示版本/标准徽标；问卷及标准版本仍保存在评估记录中，分级方法页继续提供计算依据。

系统概况按用户审阅精简：A03 系统名称优先展示，A02/A05/A08 从当前问卷和进度计数移除，旧答案保留。A04 改为运动用品零售品牌部门多选（门店、零售运营、电商、商品采购、供应链、品牌营销、会员客服等），兼容旧责任文本；A04/A06 不再显示补充说明或附件。A07 选择其他后填写具体业务，服务端检查不能为空。原题号保持可追溯。


## Amer Sports 场景版 2.0

当前问卷采用 70 道有效题，按 A01–A05、B01–B10、C01–C08、D01–D13、E01–E08、
F01–F12、G01–G07、H01–H07 连续编号。条件题保留固定编号，隐藏不重新分配其他题的标识。
A01 系统名称（原 A03），A02 运营单位（原 A01），A03 涉及部门（原 A04），
A04 建设目的与功能（原 A06），A05 业务类型（原 A07）。退役三题使用 RETIRED 前缀存档。
每题保存 source_id 原题号，field_key 不变，附件归属和历史答案不迁移、不改写。

选项按运动用品品牌、门店、电商、商品采购、会员、供应链和经销商业务设计；通用技术对象、
敏感数据类别和六项法定影响维度继续保留。所有 70 题均有中英文填写参考，示例不自动填答，
不宣称 Amer Sports 实际部署、人数、法律认定或已确认等级。旧选项不再供新填报时选择，
已保存旧选项仍显示为历史答案并允许保存。其他选项提供手动说明入口。
问卷快照标识 AmerSports-2.0，记录当前题库哈希、原来源和场景 profile；矩阵计算逻辑不变。

界面精简：仅 B07 网络边界/拓扑与 H02 架构及网络拓扑材料题保留填写参考和附件上传，其他题目移除这两项入口。上传 API 同步限制到这两个字段；历史附件和下载权限继续保留，其他材料仍可填写受控引用，核心影响判断理由仍须填写。


## 七章节精简版 2.1

- 章节为 A 系统概况（5题）、B 系统部署与连接（9题）、C 服务与规模（5题）、D 数据与个人信息（13题）、E 业务连续性（9题）、F 核心影响判断（12题）、G 监管与复核（7题）。各章节重新连续编号，field_key 和 source_id 保存稳定映射。
- H 材料题退役，不再显示也不参与完成度和必填校验；网络拓扑上传仅保留 B07。已有材料继续保留及授权下载。
- 所有通用“补充说明、统计口径与证据”折叠区移除；六项核心判断理由、其他选项说明和 G 组专家/历史等级/行业条款的专用字段继续满足对应规则。
- “对象原则”改为“系统类型核查”，“事实与佐证”改为“系统情况”。
- 原 related_assets 的多资源属性与系统对接不是同一事实。原字段退役并保留历史；新增 system_interaction 询问系统间对接，不把“无对接”视为无效定级对象。责任主体校验继续保留；独立业务校验已于 2026-11-05 随原 G02 移除。
- 原 B08 系统依赖移为 E01，其余 E 题顺延为 E02–E09。B 组剩余题重新编号。
- C02 注册/授权人数改为 0、1–50、51–200、201–1000、1001–5000、5001–10000、10001–100000、100001–1000000、超过1000000及不确定；仅用于规模了解，不改变矩阵等级。历史精确数字仍可显示和保存。月活、并发、每日处理量退役，历史答案不删除。


## 部门对接人与 A04 AI 优化

A03 新增“信息安全部门”，按已选部门展示可选的对接人姓名/角色字段。对接人单独保存于
mlps_intake.department_contacts，并进入确认快照与输入哈希；取消勾选只隐藏，不删除已填文本。
服务端限制部门键及每条 500 字，部门对接人不会进入描述优化模型输入。问卷编号不变。

A04 原文编辑器旁提供 AI 优化模块，复用持久化 worker、OpenRouter、组织模型配置、用量记录、
版本校验、过期源拦截、采纳/保留原文/撤销。点击前先保存当前草稿；只读取已保存的 system_description。
模型不自动改写答案；修改原文后旧建议不可采纳。新 job 类型 narrative_refinement:mlps_description
有独立默认提示词，可在 AI 设置中调整（默认共 13 项提示词）。提示词允许适度扩写，但新增提议
须明确待确认，不能编造人员、接口、数量或等级。无需新增表或重置运行数据。

问卷精简：所有单选、多选题不再显示重复的“按实际情况选择；尚未核实的信息请选择不确定。”及对应英文提示。

切换问题维度、上一步或保存并继续后，自动滚动至新维度问卷标题，顶部留出导航空间；首次打开保持原有滚动位置。

B01 系统类型新增“人工智能应用 / Artificial intelligence application”。该选项使用现有六项影响矩阵，不因使用 AI 自动提高等级，也不自动触发云平台、工控或大数据平台专用题。


## 网络信息拆分 2.2

B07 拆为 B07 网络区域（network_zones_description）、B08 互联网入口（internet_entry_description）、
B09 外部单位连接（external_connections_description）、B10 系统间接口（system_interfaces_description）。
原 B08/B09 顺延 B11/B12，B 组共 12 题，全卷 63 道有效题，各题 source_id 保留原题号。
原 network_boundary_description 退役但允许原样保存；B07 可展开只读原始描述和旧材料引用，
不自动猜测拆分答案。仅 B07 网络区域提供拓扑上传，新附件使用新字段归属；旧附件仍可授权下载。

C02 人数选项精简为四档：0–100、101–1000、1001–10000、超过10000人，另保留不确定。旧细分档和精确数字仍按历史答案展示及保存，不自动转换。


D01 在敏感个人信息、重要数据、核心数据选项旁增加圆圈感叹号。鼠标悬停整张选项卡或
键盘聚焦时展示解释；点击图标（触屏）也可打开，Escape 可关闭。图标与复选框独立，点击解释
不会改变答案。提示为中英文简述，核心数据明确指国家核心数据，避免与企业重要业务数据混淆。
定义来源（2026-11-03 核对）：
- [个人信息保护法第28条](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)
- [网络数据安全管理条例第62条](https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm)
- [数据安全法第21条](https://www.cac.gov.cn/2021-06/11/c_1624994566919140.htm)

B02 改为询问哪家单位对系统安全负主要责任；B03 改为询问系统是否负责一项可单独说明的业务或服务，并提供会员管理、库存查询、统一登录例子。保留原字段、选项与判定逻辑。


## 移除 G 章节 2.3

G 组全部退役，不显示、计数或要求填写；已保存答案保留在快照中。当前计算忽略历史 G 输入，
不自动套用旧行业要求、关基认定或历史降级拦截，结果标记 sector_rules_status=not_collected，
不代表已核验或不适用行业规则。核心六项矩阵不变。支撑平台原则使用现有 B11 承载对象、
已确认等级及完整证据引用，无须填写已移除 G05；大数据特殊原则若待确认，复核提示指向
当前 D11，不指向已删除的 G04，也不自动应用已撤出的专家确认值。规则引擎版本 1.1.0。


## 核心影响的组合录入

F01–F06 事故场景题保持不变，F07 业务信息和 F08 系统服务分别使用“受侵害客体＋损害程度”
两个下拉框。三类客体为合法权益、社会秩序/公共利益、国家安全；程度为无侵害、一般、严重、
特别严重和无法判断。程度选项自带简要解释，选择后展示完整定义；圆圈感叹号可悬停、聚焦或
点击查看全部选项释义，支持 Escape 或点击外部关闭。小屏上下排列。

同一维度可添加不同客体，不允许重复选择。每项仍填写判断理由。未添加项不默认为0，保持未知；
用户需明确填写理由并点击“确认其余客体无侵害”后才将余项写入0。移除判断恢复未知，旧理由
保留但不替代答案。旧答案按原值恢复：非零/未知判断显示为行，无侵害余项可展开查看原理由。
内部仍使用 info/service × rights/public/national 六个稳定字段、原标准矩阵及最高值规则，
服务端重新计算，不接受浏览器自定等级。进度按两组组合是否三类均已回答计算；显示题号 F07/F08
与内部原题 F07–F12 有明确映射，结果轨迹保留每个客体的逐项命中。


B02 选择是后显示“主要负责单位或部门名称”，使用 notes.security_responsible_entity 保存。
草稿允许未填；确认前服务端检查非空。切换否或不确定仅隐藏输入，不清除原文。
以下仅保留历史来源说明；B03（原定级 G02）及其边界复核规则已于 2026-11-05 退役，不再参与当前问卷或判定。
B03 来源为用户提供问卷 B03（independent_business），对应 GB/T 22240—2020 第5.1.1条
“承载相对独立的业务应用”。当前问法为通俗改写，会员管理、库存查询和统一登录为界面示例，
并非标准原文或自动定级门槛。用于确认评估对象范围，不直接参与等级矩阵分值。
[标准信息](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=63B89FFF7CC97EBBBED8A403396F0F00)
[公开标准原文](https://www.iscn.org.cn/uploadfile/2025/0702/20250702030517349.pdf)


## A04 综合描述拆分 2.4

原 system_description 退役保留；新字段 system_purpose、system_functions、system_scenarios
依次对应 A04–A06，均为必填。原综合内容在 A04 可展开只读查看，不自动猜测或填入三题；
字段、原题号 source_id 与历史记录继续可追溯。A 组共7题，业务类型顺延 A07。

每题有独立 NarrativeRefinement 实例、提示词和 job 类型：mlps_purpose、mlps_functions、
mlps_scenarios（均带 narrative_refinement: 前缀）。生成前保存草稿，只发送当前题目文本，
不发送其他两题或部门对接人。保留预览、采纳、保留原文、撤销、过期文本拦截和 worker 源哈希。
历史 mlps_description 任务及提示词保留兼容。默认提示词共16项，新增3项在 AI 管理页分别命名。


## 数据规模范围录入 2.5

D03 仅 D02=是显示，选项为0、1–99999、100000–999999、1000000–9999999、10000000及以上人，另有不确定。
按区间下界触发 T02/T03 审核提示，不转换为准确人数，不直接提高矩阵等级。历史精确人数继续展示/保存。
敏感人数超过区间上界时才报矛盾，避免将区间下界当成总人数；隐藏答案仍保留，用于提示明确矛盾。
原 D04 personal_info_count_operator 退役，历史记录保留但不再触发当前问卷的主体规模预警。

D 组重新编号 D01–D12；原 D08 为 D07，改用 data_volume_ranges 字典分别保存 records/storage 范围。
记录数分为不足10万、10万至不足100万、100万至不足1000万、1000万及以上；容量为不足1、1至不足10、
10至不足100、100及以上TB，两项都提供不确定。两项独立，禁止将记录条数与人数或TB混算。
原 data_volume_records 列表退役但保留，并在当前题目下只读查看；新选择不覆盖旧列表。
进度在两项下拉框均已选择后计为该题已填写。规则引擎版本1.2.0，无数据库迁移或记录重置。

## AmerSports-2.6 / Personal information subquestion

人数作为 D02 选“是”后的子问题，不再独立编号或计入题目总数。D02 选“是”时，人数也填写后才计为已填写；隐藏子问题仍保留原答案。新人数范围增加小规模档位；历史数字及旧区间保持原值和原上下界，风险提示阈值不变。D 组主问题按当前显示顺序连续编号，来源编号和存储字段保持不变。

The personal-information count is nested under D02 and excluded from the main-question total. A Yes answer is complete when its count is supplied. Hidden values, historical numbers and former bands retain their original values and bounds. D main questions are numbered consecutively in their visible order; source references and storage keys remain stable.

## 2026-11-04: Public internet minimum updated

AmerSports-2.17 / AMER-INTERNAL/5 / 规则引擎 1.8.1：B06 公众可访问入口的内部下限由 1 级调整为 2 级，
无公网访问明确记录为 1 级；受控互联网入口仍为 2 级、仅 VPN/零信任接入仍为 3 级。
新计算继续取影响矩阵及全部内部下限最高值，未知项不按无公网处理。
中英文提示及 T01 风险提示同步更新。已确认历史结果快照不改写，需重新计算并确认后使用新规则。

Public ingress now establishes internal level 2; no internet ingress explicitly establishes
level 1. Existing controlled-ingress and VPN rules remain. Higher matrix results are preserved.
Historical confirmed snapshots retain their original rule version until explicit reconfirmation.


## 2026-11-04：部门对接人信息

每个所选部门可填写人员姓名、所属部门/公司（外包）、职务/职称、负责范围、联系方法（均可选，每项最多500字符）。department_contacts 支持 name、organization、title、scope、contact_method 对象；历史字符串按人员姓名展示，编辑时保留原姓名。取消部门选择不删除已填信息，重新勾选可恢复。PRD 初稿与正式文档按所选部门展示五项信息，语言切换保留原文。无需数据迁移。

Each selected department supports optional person name, department/company, position/title, responsibilities and contact method. Legacy strings remain readable as names; deselection preserves records. Both PRD views retain authored text.


## 2026-11-04：PRD 初稿功能只读展示

审查应用说明的“功能需求”直接展示当前分级问卷 A05（system_functions）答案，保留换行和来源标识。移除该章节的功能编辑、增加、删除及 AI 扩写入口；需要修改时返回分级问卷。历史功能草稿及扩写文本保留，不在该章节覆盖问卷答案。

The PRD draft function chapter displays the grading questionnaire answer as read-only source text. Function editing and AI expansion actions are removed from this chapter; historical drafts remain stored.

## 2026-11-04: Grade-first questionnaire

评估问卷先进入“优先定级”：集中独立定级条件、对接等级、网络入口、交易/公共服务/业务重要性、数据类别及条件明细、人数、数据规模与分类、跨境、外部影响、安全影响和两组影响矩阵。保留原题号、答案键、理由及历史记录；其余 A–E 章节不重复这些问题。

先保存草稿并计算初步等级，查看依据后继续填写其余问题。早期计算使用同一规则引擎，仅将后续非定级信息的必填检查留到完整问卷校验；缺失定级输入、未知影响、理由缺失和专业复核仍阻止采用完整初步建议。早期计算不创建已确认等级、应用说明或控制选择。完整问卷仍通过原确认接口重新计算与校验，随后审查应用说明，确认后按等级匹配控制项；默认自动选择对应等级参考库。修改已确认答案继续触发原有修订和下游失效机制。

The questionnaire starts with Grade first, preserving original question IDs, authored text and conditional details. A shared grading-field contract drives the first section and a separate early rule preview. Remaining sections omit those questions. Full validation and revision checks still gate final confirmation; controls are matched by grade after brief confirmation. No migration or runtime-data reset is required.

2026-11-04 工作流更正：新建系统使用九个独立阶段：系统定级、定级结果、系统信息收集、安全控制匹配、PRD复核及下发、供应商复核、影响评估、双方确认、开发进度追踪。定级题仅在第一阶段，剩余问卷和应用说明确认属于第三阶段。早期结果保留为草稿计算，完整问卷确认仍经过服务端校验。
New-system workflows expose nine separate stages. Grading inputs and remaining information use distinct routes; full server validation still precedes control matching.

定级页面使用独立 G01–G15 展示编号，保存键及历史来源不变。Demo 仅填充当前页面/章节及其条件子题，保留其他章节答案、说明及联系人；撤销同样仅恢复本次填入的字段。结果页不提供 Demo 填入。进度按当前阶段统计。
Grading uses independent G-prefixed display numbers. Demo fill and undo are scoped to the current page and its conditional children; other pages remain intact.

2026-11-04 Demo 范围更正：系统信息收集的 Demo 一次填入并保存 A–E 五维度全部非定级题及联系人；不再仅填当前章节。不改变定级答案、理由与参考库选择，不自动确认信息或匹配控制。撤销恢复并保存本次填入前的信息，失败时保留未保存提示。
Information-stage Demo fills and saves all five dimensions, preserving grading inputs and the current chapter. Undo also saves the restored draft.

2026-11-04：Demo 对接人模板已覆盖全部 13 个可选部门（含信息安全和外包“其他”），五项联系人字段均有虚构示例，姓名标注 Demo，邮箱使用 example.com。既有评估不自动改写；点击信息收集 Demo 后填入并保存。
Demo contacts cover all 13 department choices with five populated fields and fictional example.com addresses. Existing records change only through explicit Demo fill.

2026-11-04：移除应用说明/PRD 初稿中间页面。系统信息确认通过 information-confirmations 在同一事务内校验完整问卷、确认等级、从问卷建立可追溯 ContextRevision 并匹配控制，失败整体回滚。完成后直接进入控制匹配，确认控制范围后生成完整 PRD，沿用现有复核及下发权限。历史 brief 链接重定向至信息收集或控制页，不自动写入。
Information confirmation atomically validates questionnaire facts, creates the context revision and matches controls. No intermediate brief page remains; control scope confirmation generates the full PRD for review and dispatch.

系统信息收集的展示编号按可见主问题在 A–E 各章连续编号，当前 Demo 为 7+6+2+3+6=24 题；定级 G01–G15 独立统计。条件子题计入所属主问题的完成状态，不另占主问题数。历史答案键及来源编号保持不变。
Information display numbering is consecutive within each section; progress counts visible main questions only.

2026-11-04 控制适用性补充：信息收集新增软件开发/交付方式（多选）、外包运维、实体介质、介质运输、机房管理责任（含云商取证）、现场访客六题，不参与等级计算。Demo 信息题为30、定级题仍15。六字段新发布按来源编号固定匹配自行/外包开发、外包运维、介质存放/运输、机房管理与物理访客控制；unknown 留作候选，只有明确不涉及才自动排除。保留云扩展、备份与通用安全条目，不按控制域泛化删除。匹配快照保留规则、答案及来源，界面展示具体理由；修改问卷沿用修订失效机制，旧评估显式加载新控制库后确认信息。
Six scope questions drive versioned control applicability without affecting grading. Unknown answers remain candidates. Mixed development modes retain both sets; outsourced assurance is not a blanket exemption.


## 2026-11-05：移除问卷附加材料

已上传材料的下载链接旁增加“移除”，仅编辑者可用。移除立即保存，通过 system version、组织和评估归属检查，记录 evidence_id 审计；从当前问卷答案/备注取消引用，并排除后续拓扑快照与 PRD 生成。其他未保存的文字仍保留在编辑器，继续使用原保存流程。

采用逻辑移除，文件内容、历史问卷快照、旧 PRD 和基线保持不变；已确认的信息沿用修订失效流程，必须重新确认。重试有幂等保护，过期版本不会移除。被移除 ID 不能通过旧答案重新引用，需要重新上传。无需数据库迁移或运行数据重置。

`POST /systems/{id}/mlps-intake/evidence-removals` 接收 `version`、`evidence_id`；移除 ID 保存在系统 draft 的 `removed_mlps_evidence`，历史下载仍受原组织与评估权限控制。

English: Editors can detach uploaded evidence from the current questionnaire and future PRDs. Files and immutable history remain available; confirmed facts require revision and reconfirmation. Unsaved authored text survives removal and conflict responses. Version checks, authorization, audit and idempotency remain mandatory.
