> 2026-11-03：当前定级信息收集已更换为 MLPS V1.0 八步问卷；旧初筛界面退役、历史数据保留。见 [实现与使用说明](mlps-intake.md)。

# Demo 更新：直接评估、MLPS 来源控制库与 PRD v2

2026-11-03。本页取代此前文档中的项目创建/授权前置条件、可编辑控制库及旧 PRD 默认模板说明。

## 使用方式

- 管理员及组织负责人直接创建新建系统或现有系统评估，无须项目。评估保留组织、创建负责人和前序评估关联。
- “人员与权限”维护组织角色、账号启停、密码重置和评估成员。管理员管理本组织所有评估；负责人管理自己创建或历史授权的评估，可授权普通经办人、评审人和只读成员。评审人不能评审自己已有编辑贡献的评估。
- 供应商账号仍属于独立组织，只能读取明确分配的供应商任务。组织管理员可创建供应商账号或停用其访问；双方仍须独立确认同一基线哈希。
- 框架选项仅有 MLPS 2 级和 MLPS 3 级。控制范围由明确选择的框架决定，独立于内部 L1/L2/L3 风险初筛。低于内部初筛等级时继续记录差异。
- 控制库仅使用 CN 原文，中英文界面均展示中文控制内容。查看控制、手动纳入或有理由地排除仍可用；旧手动写入、CSV/XLSX 上传发布、批量删除及系统自定义控制入口已停用。
- 新 PRD 使用 `System_Assessment_PRD_v2.md` 默认布局，包含目标、责任角色、范围、流程、功能、权限、数据接口、MLPS 要求与原始测评步骤、验收追踪、交付运维、待决事项和供应商评审。人工细化项明确标为待确认；本地规则草稿和模型草稿保持区分。管理员仍可调整新模板。

## 来源与存储契约

仅保留 `backend/app/data/mlps/MLPS_level_2_CN.xlsx`（135 条）与 `MLPS_level_3_CN.xlsx`（211 条）。EN 文件及中英文编号匹配逻辑已移除。重启校验两个 CN 文件的 SHA-256；不变时复用当前发布。

以等级和控制编号建立 346 个控制身份，仅存储 zh 原文及其文件名、工作表、行号、七列原值和 SHA-256。界面语言不改变控制内容，英文 PRD 同样引用中文原始控制要求与测评步骤，不再产生英文来源缺失提示。新的发布代码为 MLPS-CN；历史双语发布和已确认文档仅作为审计记录保留，不改写历史快照。

发布使用组织范围内的 Catalog/LibraryRelease/Control/ControlMetadata，内容哈希判定幂等。部署启动与客户组织注册提供固定来源版本；历史发布保持不变。切换当前库前将旧编辑草稿保存为 ARCHIVED-DRAFT 发布，旧评估继续引用原 catalog；需要新控制库时显式刷新并重新确认分级。

## 数据保护与升级

运行数据仍仅为 Demo `.syseval/assessment.db`。升级前使用 SQLite backup 生成一致性备份；不得删除数据库、旧项目、旧分配、历史文档或确认记录。

新增 `organization_roles` 和 `assessment_members`，生产迁移为 `direct_assessments`（接续 `delivery_evidence`），本地启动自动创建表。首次升级逐账号复制有效历史项目授权为直接评估成员并固定组织角色；后续授权不再依赖项目。撤销访问不会被下一次启动重新授予。

旧组织 PRD 模板不再作为新生成默认布局；原值及历史 PRD 模板审计快照保留，新模板保存使用 generation 2。已有 PRD Markdown、修订、文档哈希及双方确认不修改。

## 验证

`evals/deterministic/test_direct_mlps.py` 覆盖真实来源数量、仅 CN 来源、幂等发布、停用写入入口、直接创建两类评估、权限边界、指定框架匹配和新 PRD 全覆盖。现有供应商、交付、整改、并发、修订和同哈希确认测试继续执行。

旧接口成功创建项目/发布任意控制库的测试断言与新需求相冲突，历史断言存于 `evals/archived_project_contracts/*.txt`；当前测试改为直接授权和来源只读契约。涉及旧历史发布的业务回归仍在隔离数据库中直接构建小型测试发布，不依赖已停用的公共写入接口。

前端 `direct-mlps.test.tsx` 验证 切换英文界面仍保留 CN 内容及无项目字段的组织账号创建；创建表单和初筛测试同步采用新契约。

## English

Assessments are created directly by organization managers and administrators. Projects are retired from the active workflow; historical records remain intact. Individual assessments grant operator, reviewer and viewer access. Supplier organizations and same-hash independent confirmations are preserved.

Only MLPS Level 2 and Level 3 are offered. The two CN workbooks provide 346 controls (135 and 211). EN files and bilingual matching are removed. Both interface languages display the Chinese source text; English PRDs cite the same CN evidence. Historical releases, documents and hashes remain unchanged.

2026-11-03：首页及空台账创建入口统一为“新建系统安全评估 / Create system security assessment”。打开统一创建窗口后，在“系统类型”选择“待开发系统”或“现有系统”；现有系统继续填写范围、基准日期、部署环境、版本及原因。底层 new/existing 类型和评估流程保持兼容。

创建窗口使用“待评估系统名称 / System name to assess”，不再包含示例预填选项和历史保留说明。需要 Demo 数据时，在后续“系统信息录入”页面使用现有 Demo 填入操作。

## 2026-11-04: Six-field replacement control source / 六字段控制来源

本次切换的组织使用 `CONTROL-SIX/1`：`source`, `control_identifier`, `security_domain`,
`security_control_point`, `control_requirement`, `risk_level`。旧控制业务结构退出该组织当前库，
历史发布、评估选择快照、PRD 及基线引用不删除。切换前必须 SQLite backup。
新增表 `six_field_control_libraries`、`six_field_control_uploads`、`six_field_controls`；
部署迁移 `six_field_controls`，本地启动自动创建。六字段为独立列，上传原文件字节、SHA-256、
上传者、工作表和物理行号另存为来源元数据，不再要求 assessment_procedure 或 label。

`GET /api/v1/source-controls` 供客户组织读取，`POST /api/v1/source-controls/uploads` 仅 admin 可用，
沿用 CSRF。支持 UTF-8 CSV / XLSX，以列名读取，允许重排列顺序，正文空白与换行原样保存。
六列全部必填；每文件最多 10 MiB、10,000 条；重复 source + control_identifier 拒绝整文件，
重复文件哈希幂等返回。多文件界面按文件逐一提交，前一文件成功不因后一文件失败而回滚。
宏、公式、外部链接及无效表头通过现有有界 Excel 校验拒绝。

切换标记阻止旧内置 CN 控制在重启时恢复，当前匹配库保持未发布，旧评估仍保留已固定来源。
新六字段只读写来源，不推断 risk_level 的 MLPS 等级含义；三文件所属等级/版本及适用范围映射
需要用户确认后接入新评估匹配。界面明确显示待配置状态，不制造验收步骤。

The switched organization uses six explicit source columns and a new upload store. Old
releases are archival references only; historical assessment evidence and baseline hashes
remain intact. Upload is admin-only, file-atomic and hash-idempotent. Applicability mapping
is deliberately pending confirmation of the three source files and the meaning of risk_level.

## 2026-11-04: Three MLPS source files and High-risk supplier gate

已确认 MLPS_level_1_CN / level_2_CN / level_3_CN 分别关联 1/2/3 级；工作表名不作为等级依据。
新 `six_field_level_mappings` 表记录文件等级，迁移 `six_field_levels`。上传时可显式选级，
规范文件名自动识别；选择等级与规范文件名矛盾时拒绝。risk_level 不参与系统定级或底稿选级。
六字段源数据保持原样，兼容发布由来源行派生，稳定身份使用 source + control_identifier。
MLPS1_REFERENCE 单独提供一级条款，不用内部基础控制集冒充一级底稿。新发布使用 MLPS-SIX，
上传和发布在同一事务；旧评估仍固定原 catalog，问卷中显式“加载最新控制库”后保存并重新确认才能升级。

用户提供的三文件为 55 / 135 / 211 条。High 分别为 0 / 16 / 63 条。
一级文件的工作表名为 MLPS Level 3 CN，等级按已确认文件名保存；三级 Medium 拼为 Meduim，保留原文。
来源没有 assessment_procedure，不生成伪造测评步骤。规则 PRD 中验收方法明确标记需双方细化。

供应商轮次固定所选控制来源快照，规则读取不可变提交而非可编辑草稿。
新增 `source_risk.py`：来源 risk_level（不区分大小写）为 High，答复 no 时直接判定 failed；
partial / needs_clarification / 缺失时为 pending 并阻止通过。其他风险等级仍走人工审查，
不能仅因模型 finding.severity=high 就触发六字段来源 High 硬拦截。
High 问题不能接受风险绕过；评审接受、冻结、双方确认和最终待开发入口都有后端检查。
模型改写风险严重度或当前库更新均不改变已固定的 High 规则。历史基线与独立同哈希确认保持不变。

English: file level and source risk are independent. The three six-field sources publish
immutable MLPS1/2/3 reference catalogs. High + unable fails supplier security assessment;
unresolved High commitments block acceptance and baseline progression. Evidence-based
customer acceptance still follows feasibility commitments. No assessment procedures are
fabricated from the six-column source. Historical assessments explicitly opt into new releases.
