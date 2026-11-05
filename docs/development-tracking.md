# 开发进度追踪 / Development tracking

2026-11-06：标题为“安全审计 / Security audit”的可编辑开发项增加“一键填入 Demo”。它通过有上传权限的只读接口获取本评估真实审计事件摘录，生成带时间、角色、事件与记录引用的 PNG；账号、凭据和事件 detail 不进入图片。说明与环境/版本/采集日期填入可编辑草稿，图片沿用现有上传权限、条目版本及配额检查。单一验收条件关联该图片；多个条件继续由用户核对映射。填入不会自动保存、提交验收、调用 AI 或接受交付，撤销恢复填入前内容，已上传的附件记录保留。正式提交前仍须核验全用户覆盖、留存周期、防篡改和告警等截图未证明的部分。中英文正文不含“演示 / demo”等词，按钮仅作为填入入口。

English: The Security audit item can fill an editable draft from actual system-scoped audit events and attach a rendered log excerpt. The read-only preview requires supplier upload authority and an editable, current batch. It omits identities and event details, preserves references, and does not assert unverified retention or completeness. Uploading, saving, submission and independent human acceptance retain their existing checks. Undo restores prior authored input.

交付材料的采集日期与日志摘录统一按北京时间核验，避免凌晨将当天日期误判为未来日期；后续日期仍禁止提交。Collection dates use the Beijing calendar day in both UI and server validation.

2026-11-05，Demo 的开发追踪页采用深色导航、连续阶段条、白色任务卡及蓝/紫/浅金信息区。入口为左侧“开发进度追踪”及评估第九步。双方确认后的评估默认进入此步骤；已有批次直接在评估内展开。

## 使用流程

1. **开启追踪**：客户负责人在双方确认基线后开启。服务端继续检查双方独立确认同一 hash；只纳入已承诺 yes/partial 的开发项。无任务不自动视为完成。
2. **开发与取证**：供应商填写完成说明、环境、版本和采集日期，上传并选择材料，再为每条验收条件选择对应附件。页面逐项提示缺失内容。
3. **提交验收**：“保存草稿”可保存不完整输入。“保存并提交验收”先保存，再用响应中的最新 item version 正式提交；保存失败不提交，输入保留。提交失败时已保存草稿仍可继续提交。
4. **人工验收**：客户核对本轮不可变材料、条件与 AI 辅助结果，选择通过、要求修改或补充证据。通过仍要求全部条件及非空审核依据。AI 结果不能替代人工决定。
5. **补充与重交**：退回原因突出展示。供应商修改草稿后生成后继提交，旧提交及审核保持只读。已验收项可填写原因重新打开；新原因单独显示，不复用上一轮通过说明。
6. **完成审核**：全量开发项均已验收且非空时，客户完成批次。现有系统整改交付随后进入客户复测；只有原复测流程通过后才关闭差距。

## 界面与统计

- 总览显示总数、待提交、待验收、退回补充、已验收及当前待办；进度是已验收/全量开发项，不代表代码完成百分比。
- 搜索编号、开发要求和承诺负责人，可按状态或超出承诺日期筛选。筛选不改变总体分母；筛选、展开/收起及中英文切换保留未保存输入。
- 负责人及承诺完成日期来自固定承诺；未提供显示“未约定”。超期仅用于活动批次的未验收项，不生成日期，不修改原承诺。
- 蓝色区展示供应商证据，紫色区展示模型辅助，浅金区承载独立人工验收。原文、附件、条件、历史轮次、来源 hash 与 Word 最终稿可查阅。
- 活动批次每15秒读取进度，运行中的 AI 每2秒读取；错误时停止轮询并保留上次记录，可手动刷新。命令取消重叠读取并采用服务端响应；版本冲突不静默覆盖草稿。
- 失效来源只读；上传、审核、重新打开和完成操作由服务端权限控制。桌面并列证据与人工审核，手机端纵向排列。

## 实现与兼容

`DeliveryWorkspace.tsx` 管理入口与查询，`DeliveryBoard.tsx` 管理总览和筛选，`DeliveryItemPanel.tsx` 管理逐项操作，`DeliveryEvidence.tsx` 展示不可变材料与辅助分析，`deliveryModel.ts` 提供类型、提交前提示及筛选逻辑。样式仅作用于交付组件。

继续使用 draft/submissions/reviews/reopen/complete API。没有新增数据库表、字段或迁移。交付审计现在记录服务端确定的 item_id；只读 item 响应增加 `reopen_feedback`，从该组织、评估、条目最新的重新打开审计读取。历史事件若没有 item_id 不猜测归属，界面提供通用重新核验提示；旧记录和基线 hash 不改写。

English: Delivery tracking combines an overview, filters, evidence cards and independent customer review. Suppliers may save incomplete drafts or explicitly save and submit using the returned version. Metadata, dates, 1–10 files/100 MiB total, matching environment/version and criterion coverage are checked before submission; the server remains authoritative. Filters, collapsing and language changes preserve authored input. Source hashes, organization/role checks, immutable rounds and independent baseline confirmations remain mandatory. Reopening feedback is separate from earlier review decisions. No schema migration or runtime-data reset is required.

## 验证 / Verification

离线前端覆盖完整性、最新版本提交、保存冲突、筛选与语言切换保留输入、附件解除映射、独立人工审核、新提交使旧审核输入失效、嵌入入口、失效来源及空范围。后端回归验证重新打开原因的条目隔离、供应商可读、后继轮次及旧提交不变。

浏览器测试通过独立 Vite preview 和合成 API 验证客户/供应商交互、上传映射、完成与重新打开及手机布局；所有 API 被拦截，不访问运行库或在线模型。

```powershell
npm --prefix frontend run build
npm --prefix frontend exec -- playwright test --config frontend/playwright.delivery.config.ts
```

Default browser: installed Microsoft Edge; `SYSEVAL_E2E_CHANNEL` can select another installed channel. Screenshots are written to the ignored `artifacts/development-tracking/` directory.
