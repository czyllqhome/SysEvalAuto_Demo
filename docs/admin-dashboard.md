# 管理工作台 / Administrator dashboard

2026-11-05。Demo 中管理员登录后默认进入 `/dashboard`，原评估台账保留在
`/assessments`。其他组织成员和供应商保留原首页；直接访问管理工作台会被拒绝。
API 为 `GET /api/v1/admin/dashboard`，沿用现有登录、有效账号及管理员检查，
供应商身份即使误配管理员标记也不可访问。数据只属于当前管理员的客户组织。

界面参考深色导航、浅灰背景、白色指标卡、横向进度条及表格设计，包含：

- 评估总数、进行中、待办、双签开发基线、当前协同供应商五项指标。
- 两类系统的评估阶段分布、现有系统的整改状态与待处置风险。
- 可展开的供应商协同明细，直接打开关联评估。
- 可直接跳转处理的评估待办、风险复审提醒、交付证据审核任务。
- 已确认系统等级、业务部门分布；未定级和未明确部门单独统计。
- 全部/待开发/现有系统筛选、系统名称和部门搜索、刷新及新建评估入口。

## 统计口径

`q` 为最长 200 字符的系统名称/已确认部门文本搜索（不区分大小写，按字面匹配）；
`kind` 为 `''`、`new` 或 `existing`。所有卡片、图表、明细、待办使用相同筛选范围。
自动刷新间隔为 60 秒，并展示本次数据时间。加载失败显示重试，不用零值冒充成功数据。
指标快捷入口将当前名称/部门及类型筛选带入台账；台账支持 `q`、`kind`、`active=true` 和 `status` 深链接。

以未软删除的评估记录为单位，不合并独立评估轮次。已完成阶段包括
`PENDING_DEVELOPMENT`、`ASSESSMENT_COMPLETE` 和 `ACCEPTED_RISKS`；其中“已达成开发基线”
进一步要求当前基线已 finalized、双方确认方集合正确、不同账号独立确认相同 hash。
供应商按当前 `System.round_id` 及有效整改计划关联的组织去重，历史供应商轮次不计入。
同一评估可以涉及多个部门，部门内去重，因此部门数量之和可以大于评估总数。

整改只读取当前 revision 且通过现有 source-hash 校验的 `CurrentAssessment`。
同一缺口仅计一次；状态为已关闭、风险已接受、待复测、整改中、待确认计划、待制定计划。
风险接受不等同关闭，到期接受在概览中视为待处置，生成复审提醒，但读取不会改写历史接受记录。
逾期指未关闭且未接受风险的缺口，其关联计划 `due_on` 早于业务服务的当前 UTC 日期；
截止日当天不算逾期，无截止计划的缺口不推断逾期。待处置风险不包括已关闭及尚未到期的已接受风险。
供应商关闭率为该供应商计划关联缺口的关闭数/总数，无缺口时显示 `—`。
未分配计划的缺口仍计入组织整改总览。失效来源被排除并显示排除评估数。

待办按评估当前阶段生成，一份评估最多一条阶段待办；到期风险按评估追加一条提醒；
有效交付批次中 `IN_REVIEW` 项按批次追加一条审核待办。交付数量展示实际待审条目数，
只读读取沿用交付来源版本与 hash 校验。待办时间标明“评估更新”，不是伪造的任务创建日期。

## 权限与验证

新增代码不调用模型、不新增表、不修改业务状态、不改变审批或双签规则。
不添加示例供应商、不迁移或清空 `.syseval/assessment.db`。中英文仅切换界面文案，
组织、系统、供应商、部门原文保持不变。

后端离线测试 `evals/deterministic/test_admin_dashboard.py` 覆盖管理员/供应商权限、
组织隔离、软删除、筛选、当前/历史轮次、双签、交付来源失效、整改风险与只读保证。
前端 `frontend/src/admin-dashboard.test.tsx` 覆盖登录入口、权限门禁、原文保留、筛选、
刷新、新建窗口、供应商展开、台账入口和错误状态。

## English

Administrators land on `/dashboard`; `/assessments` retains the ledger. The read-only
`GET /api/v1/admin/dashboard` endpoint enforces current customer organization and administrator
access. Suppliers and non-admins cannot read this aggregate. All widgets share the text/type
scope and refresh every minute. Authored names remain unchanged when switching languages.

Current supplier rounds and source-validated remediation plans determine supplier counts.
Deleted assessments, historical supplier rounds and stale remediation/delivery sources are
excluded. Accepted risk is separate from closure; expired acceptance is surfaced without a
database write. Agreed baselines require finalized current records and independent same-hash
confirmations. Delivery review counts include only current valid batches. No migration,
model request, synthetic runtime records, approval change or data reset is introduced.
