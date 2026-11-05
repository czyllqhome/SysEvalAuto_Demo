# Amer Sports 演示场景 / Demo scenarios

2026-11-05：为当前 admin 所在组织追加六组虚构业务数据。所有名称均标注 `【演示】`，供应商均标注 `【演示虚构】`；这些记录不代表 Amer Sports 的真实系统、供应商、风险或批准。

| 场景 / Scenario | 阶段 / Stage | 演示内容 |
| --- | --- | --- |
| 全球商品企划与需求预测 / Merchandise planning | DRAFT | 新建评估，待完善定级信息 |
| 门店运动体验预约平台 / Store experience booking | PRD_REVIEW | L1，规则生成需求草稿待审查 |
| 会员与售后服务平台 / Member and after-sales services | VENDOR_FILLING | L2，供应商已填写三项草稿，尚未提交 |
| 全渠道订单与退换货中台 / Omnichannel orders and returns | RESULT_REVIEW | L3，包含部分完成、无法完成和待澄清答复，待负责人复核 |
| 门店 POS 与支付接口安全整改 / Store POS remediation | REMEDIATING | L3，六项差距覆盖待计划、待确认、整改中、待复测、关闭、风险接受 |
| 全球库存可视化与仓配协同 / Global inventory collaboration | PENDING_DEVELOPMENT | L2，独立演示客户/供应商确认相同基线 hash；两项交付证据待验收 |

每个已定级场景抽取当前已发布来源库的六项匹配控制，保存来源快照及修订关系。这是有限演示抽样，不是完整等级合规评估。所有 PRD 和影响报告使用本地规则生成，保留规则模式标识；不调用付费模型。

整改计划相对导入当天设置：待复测和待确认计划分别逾期两天、一天；整改中计划十四天后到期；风险接受三十天后复查。关闭项先经过供应商提交、客户验收和独立复测，风险接受单独统计。日期随时间自然变化，不会自动重置演示状态。

新增一个客户演示身份和四个供应商身份，使用 `example.invalid` 邮箱、无可用密码且最终全部停用。admin 可访问评估和工作台；不改变现有账号、权限或凭据。后续若需以供应商身份操作，可由管理员在人员管理中显式管理这些演示身份。

## 导入与验证 / Import and verification

脚本：`scripts/seed_amer_sports_demo.py`。仅允许本 Demo 目录内已存在的数据库，要求没有正在排队或运行的 AI 作业。执行前须通过 SQLite backup 创建一致性备份，并先在数据库副本上演练。

```powershell
backend/.venv/Scripts/python.exe scripts/seed_amer_sports_demo.py --database .syseval/assessment.db
```

导入标记为 `amer-sports-dashboard-demo-v1`。单事务追加，提交前逐表比较全部原有行；任何原行发生变化则回滚。六条记录已存在时直接返回，不重复导入，不重置已推进的演示记录；部分记录缺失时停止以避免重复。

本次已验证：副本完整流转、重复运行无重复、所有新评估详情可读取、Dashboard 来源均有效、原有业务记录不变、真实 admin 页面展示正常。导入后 admin 组织共七份评估、五家协同供应商、一个已双签基线、六项整改差距、两项交付待验收。其他组织仍按权限隔离。

导入前备份：`.syseval/backups/before-amer-sports-demo-20261105-223949.db`。备份和数据库副本均在 Git 忽略目录内，不提交运行数据。

English: Six fictional scenarios were appended atomically without replacing existing rows. They span intake, PRD review, supplier drafting, customer review, remediation and an independently confirmed development baseline. Current published control references and source hashes are preserved. Demo identities have no usable password and remain disabled after import. Reports use offline rules only. Re-running the marker is idempotent; it never resets subsequent demo activity. Back up the existing SQLite database before running the script.
