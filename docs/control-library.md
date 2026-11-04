> 2026-11-03 Demo: 项目机制和控制库写入入口已停用；使用直接评估、CN MLPS 来源库和 PRD v2。Current behavior: [更新说明 / Current contract](direct-assessment-mlps.md).

# 标签分类与控制库维护

本功能在独立应用中提供组织级控制库草稿、版本发布、MLPS 导入、标准 Excel 往返和标签驱动分类。所有项目命令从 `A:\SysEvalAuto-v0.0.1` 执行。

## 开始使用

1. 更新依赖与构建：`uv sync --project backend --extra dev`、`npm --prefix frontend run build`，随后重启应用。
2. 进入“控制条目库”。组织管理员可维护草稿；其他客户成员可读取组织库。项目专属控制仍在评估内维护。
3. 选择“新增控制项”手工填写，或下载标准 Excel 模板后上传。MLPS 原始两表也可以直接上传。
4. 上传后查看逐条差异和错误，点击“合并到草稿”。这一步不发布控制。
5. 审核每条要求、适用条件和来源，勾选“已审核”。点击“预览发布”并确认，新评估才使用该版本。
6. 在系统“确认等级”页回答事实，预览内部等级和控制适用范围，再确认分类与画像。
7. 审核并确认应用说明后生成控制选择；未知条件保留为候选，必须明确纳入或记录排除理由。

没有发布控制库时保留人工等级入口。没有已审核的 `INTERNAL_BASIC` 条目时，L1 方案会明确报错；管理员需自行选定基础控制集。系统不会自动把 MLPS 二级条款全部标为 L1。

## 七列跨框架来源表（2026-10-29）

支持直接上传 `control_set_labeled.xlsx` 类型的多表工作簿。每张非空表第一行必须包含
`source, control_identifier, security_domain, security_control_point, control_requirement, assessment_procedure, label`，
按名称读取，顺序可调整，忽略表头大小写与空白/下划线差异。空白行忽略，重复表头、未知分类、
缺少来源/编号/原域/要求/标签均返回具体表和行，任一错误阻止整批合并。原标准模板和 MLPS 来源入口保持兼容。

`label` 映射为 `domain_code`，缺失的内置统一域在合并批次中一并注册双语定义。
已配置域可直接复用，自定义新域须先在“分类问题与标签”配置。`source` 映射为来源框架，
MLPS Level 2/3 归为 MLPS 并分别保留 source_level=2/3；NIST-SP800-53r5 工作表内的
NIST-SP800-53r数字 来源统一归为 NIST-SP800-53r5，以修正该底稿的递增填充问题，预览显示修正行数。
其他框架使用每行 source。来源文件摘要、工作表、行号、原始七列与坐标保存在不可变来源记录中。
正文保留空白和换行，不自动翻译；缺少 control point 时用原域与编号作为标题。
缺少评估方法时显示待补充，评估对象默认待确认。内部编号从框架和来源编号稳定生成，中文编号也可导入；
重排不改变身份。重复来源不覆盖旧条目，后续更新使用标准导出模板及修订校验。

七列表没有等级字段：MLPS 仅映射来源等级的方案，复用已知条款的确定性条件草案；其他框架
暂关联当前全部等级方案且不推断排除条件，预览明确提示这一默认行为。所有条目均标为待审核规则草案。
label 是分类而不是适用条件，发布前应检查各条方案、对象和规则。上传只预览，合并只改草稿，
发布仍为独立动作。新域随发布快照生效，旧评估不会自动更新。

## 其他 Excel 入口

**MLPS 来源适配**识别 `MLPS Level 2` 与 `MLPS Level 3`，按表头读取条款、对象和实施方法。等级来自工作表映射，不用 J 列推导。原条款编号和子项组成来源编码；文件摘要、工作表、行和原始 A–J 值随控制保存。

MLPS 上传生成规则草案。远程管理、个人信息、开发模式、外包运维、邮件和边界控制有明确候选映射；其余保留为始终适用的待审核项，避免凭关键词缩小范围。所有条目都必须审核才可发布。自动生成不等于完成专业合规审核。

上传预览提供“下载带标签 MLPS 草稿”：保留原两表内容和格式，在 K–Y 追加映射字段及字典页。该文件可以继续编辑并作为来源草稿重新导入；已有条目的修改使用标准导出模板，避免重复创建来源编号。

**标准模板**包含 `Instructions`、`Controls`、`Conditions`、`Dictionary`：

- `create` 新增；`update` 修改；`retire` 停用。服务器分配稳定身份。
- 修改和停用要求导出的 control_id、expected_revision 及 change_reason。
- 模板绑定下载时的草稿版本。下载后库已变化时重新导出和预览，不能覆盖他人修改。
- 可选空值保留原值；显式清除填写 clear_fields。遗漏整行不会删除已有控制。
- 至少填写一种语言的完整标题、要求与评估方法。界面切换和另一语言的修改不会翻译或覆盖原文。
- Conditions 同组为 AND、组间为 OR；expected_value 使用 JSON 值，例如 `"yes"` 或 `["cloud"]`。前端条件构建器可生成相同结构。
- 单选域和事实标签提供字典下拉；多个方案/主题使用 `|` 分隔。
- 上传限制为 10 MiB、每表最多 10,000 条数据行；解压大小也受限。公式、宏、外部链接和不兼容模板被拒绝。源文本中以等号开头的普通字符串以文本导出。
- 所有行校验通过才合并整批；发布是另一个明确动作。错误清单可以下载。

## 标签与扩展

“分类问题与标签”页面维护问题、事实标签、安全域、主题和评估方案，也可调整分级的中断阈值。新增事实标签同时建立问题，配置类型、选项、双语标题和显示条件。系统校验类型、引用、条件循环，以及正在使用的标签。

内置分级输入保持稳定；新增标签默认仅影响控制适用性。首版使用确定性的最高影响规则，默认中断阈值为 240 / 1440 分钟。公网入口、出站上网、内网跨区和远程管理分别记录；没有公网入口不会排除内部边界或远程管理控制。

`unknown` 与 `no` 分开处理。AND 中出现否则不满足，OR 中出现是则满足；其余含未知的组合保留待确认。主题标签用于搜索，不参与隐式 AND 运算。

配置和控制在同一发布快照中固定。新增问题后，旧系统升级时缺失的事实保持未知，不自动补写回答。发布的新版本不会自动修改已有评估；分类页“检查控制库升级”可预览后重新确认。

混合部署可记录多个部署方式和责任层。当前条件匹配使用系统级画像；责任方式为客户、供应商、共享或按组件，具体组件责任仍需在应用说明/控制复核中落实。逐组件独立问卷与对象级匹配不属于本次实现。

## 版本与审计

草稿存于 `control_library_workspaces`，使用乐观锁版本；导入批次存于 `control_library_batches`。目录发布形成既有 `Catalog/Control` 行，以及 `control_library_releases` 和 `control_metadata`。稳定 control_id 与控制修订保存在 metadata；每次发布的数据库 Control.id 是该目录下的独立引用。

修改、配置、导入和发布记录组织审计。手动编辑、配置保存和发布接口支持 Idempotency-Key；导入确认按批次幂等。历史控制快照保留，重新匹配仅重建当前评估修订。人工加项或排除进入待复核；已停用但仍需复核的旧条目在控制列表中仍可访问。

新画像在 `System.draft.tag_profile` 保存，确认后进入 `System.classification`，包括事实、输入摘要、配置摘要、目录、内部等级及方案。模型生成的 Context 标签只作为建议；明确与已确认个人信息/生产管理事实冲突时要求重新分类。

改变画像或库版本使依赖的 PRD、报告和双方确认失效；历史记录不删除。最终仍使用原有独立客户/供应商同一 baseline hash 确认流程。

## 实现路径与接口

- `backend/app/control_rules.py`：版本化定义、事实校验、三值规则、内部分级。
- `backend/app/control_library.py`：草稿校验、编辑、原子发布、匹配与方案。
- `backend/app/control_workbooks.py`：标准 XLSX 和 MLPS 适配、标注导出。
- `backend/app/library_routes.py`：组织和系统 API；既有命令处理器承担系统权限、修订及审计。
- `frontend/src/ControlLibrary.tsx`、`TagClassification.tsx`：维护、规则构建、问卷和预览。

主要接口为 `/api/v1/library`、`/library/config`、`/library/controls`、`/library/rule-preview`、`/library/export`、`/library/imports`、`/library/publish`、`/library/history`、`/control-template`，以及 `/systems/{id}/tag-profile`、`/tag-profile/preview`、`/catalog-upgrade-preview`。分类确认复用 `/systems/{id}/classification-confirmations`，指定 `scheme=MLPS-TAGS/1`。

历史 CSV 接口与旧回归夹具保留兼容性；新控制库使用上述共同草稿/发布服务及 XLSX 模板。旧 CSV 入口不会自动翻译成新标签方案。

## 数据迁移与检查

新增迁移 `control_library` 仅增加表；本地 `SYSEVAL_AUTO_CREATE=true` 启动时也会创建缺失表。部署模式执行：

```powershell
uv run --project backend alembic -c backend/alembic.ini upgrade head
```

连接由现有 `SYSEVAL_DATABASE_URL` 选择，默认仍为 `.syseval/assessment.db`。部署先按现有运维流程备份；不重置任何运行记录。

后端和前端使用项目规定的四项检查。额外浏览器测试需显式设置 `SYSEVAL_LIBRARY_E2E=true` 和指向隔离数据库实例的 `SYSEVAL_E2E_URL`；可用 `SYSEVAL_E2E_CHANNEL=msedge` 选择已安装浏览器，再执行 `npm --prefix frontend run test:e2e -- control-library.spec.ts`。该测试使用合成组织与控制，不应指向实际工作数据库。

## 浏览、筛选与项目补充

控制域筛选固定向下展开，长选项列表在面板内滚动；支持方向键、Home/End、
Enter/空格选择、Escape 关闭和键入定位，点击外部或移出焦点关闭。

来源框架下拉框将 MLPS 按来源等级显示为 `MLPS Level 2` 与 `MLPS Level 3`，
选择一个选项即可筛出相应等级，无需再选择来源标准等级。现有和历史库均按
`source_framework=MLPS` 与 `source_level` 组合展示，无需重新导入或改写历史数据。
初筛仍选择 MLPS 框架，未指定测评目标时 L2 匹配二级方案、L3 匹配三级方案，
各方案内继续评估适用条件。明确指定的 MLPS 测评目标仍优先决定 MLPS 方案。

控制库默认显示当前草稿的条目、要求、来源条款、控制域、适用方案与评估证据；
可切换到已发布版本，只读浏览其控制及当时的配置。筛选可组合来源框架、来源标准等级、
系统适用等级、评估方案、控制域、主题、审核状态和全文搜索；筛选后重新从第一页显示。
来源框架来自条目数据，支持 MLPS、NIST、内控或其他自定义框架。
来源等级（例如 MLPS 二级、三级）与内部 L1/L2/L3 分开；内部等级按评估方案的显式映射检索，
不会从来源等级推断，也不会隐式继承。具体适用性仍由确认后的系统事实与条件规则决定。

空库与无筛选结果分别提示。没有条目时需新增或导入；系统不会恢复已停用的演示库或自动植入
标准条文。NIST、内控底稿可整理为已有标准 Excel 模板，保留来源框架、版本及条款引用；
任意原始底稿并不保证可以直接识别。导入合并、专业审核、发布仍是独立动作。

业务负责人可在本人负责评估的控制审查阶段手动纳入、排除或新增项目专属控制。
此授权不扩展到组织库编辑、其他项目、原始资料编辑或 PRD 生成。控制编辑计入贡献者，
仍禁止其评审或最终确认同一评估；需要由符合职责分离的其他负责人完成最终确认。
管理员继续负责组织库草稿维护与发布。新权限沿用系统版本检查与业务审计。

## 批量删除草稿控制

管理员可在当前草稿逐条勾选，或选择全部筛选结果（包括其他页），点击“批量删除”，检查所选条目并填写原因后确认。改变筛选或查看版本会清空选择。已发布版本只读，不提供删除入口。

删除将条目从当前草稿移除，整批原子提交，校验组织权限和草稿版本；删除原因与条目完整快照保存在审计中。已发布目录及历史评估引用保持不变，重新发布后新版本才排除这些条目。允许清空草稿，但空库不能发布，须补充控制后再发布。导入批次不撤销；旧模板、旧导入预览会因版本变化失效，需要重新导出或上传。

接口：`POST /api/v1/library/controls/bulk-delete`，请求包含 `version`、`control_ids` 和非空 `reason`；支持 `Idempotency-Key`。

## 单等级 MLPS 文件

MLPS 二级或三级可分别上传，不再要求同一文件同时包含两张表。工作表名接受 `MLPS Level 2` / `MLPS Level 3`，也接受大小写及下划线、短横线变体（如 `MLPS_level_3`）。等级来自工作表名，不从文件名或 High Risk 列猜测；条款前缀与等级不一致会拒绝导入。原始表头中的连续空白会归一化。缺失表头会列出名称。标注导出在原有列之后追加字段，保留第 11 列及其他原始列。

此修复仍使用原始 MLPS 表头；建议的 snake_case 统一来源模板尚未作为新的上传格式启用。

## 统一来源表头兼容

来源表第一行现在兼容此前约定的 11 列：security_domain、security_control_point、clause_number、subitem_number、control_requirement、assessment_object、assessment_procedure、assessment_method、risk_level、is_high_risk、source_level。原始英文表头继续兼容；按名称读取而不是列位置，大小写及空白/下划线差异可归一化。重复语义列拒绝导入。source_level 非空时必须与工作表等级一致。

测评方式、风险等级和高风险标记保存在来源字段及原始单元格中，并在带标签来源文件中保留；它们尚不是标准 Controls 模板的独立列或自动适用规则。此前“统一表头尚未启用”的说明由本节替代。来源编号仍须为 MLPS 条款编号及子项，不能用行序号代替。


## 一键发布 / Direct publication

管理员可在工具栏或发布预览中点击“一键发布”，直接发布当前所有有效草稿，
无需逐项勾选审核或额外确认。原“确认发布”保留逐项审核要求。两条路径都检查
组织权限、草稿版本、条目结构、来源、配置引用和非空控制集；正在编辑时须先保存。
一键发布保留真实 review_status，不把草稿伪装为已审核。发布审计记录 publication_mode
和未审核控制 ID；发布历史显示发布方式。已有评估仍需显式加载新库并重新确认分类。

`POST /api/v1/library/publish` accepts `publication_mode: "direct"` with `version`.
Omitting the mode retains reviewed publication. Both modes support idempotency,
atomic publication and organization isolation. Direct publication keeps authored text,
source references and per-control review status, recording its mode in release metadata
and audit. No existing assessment baseline or confirmation is changed automatically.

## 控制条目显示方式 / Control display modes

浏览工具栏支持“卡片 / 列表”（Cards / List）切换。卡片用于并排浏览，列表按单行条目展示要求、来源与评估方案。两种视图共享筛选、版本、分页、选择及编辑权限；切换不会改变控制内容或清除当前选择。窄屏列表自动纵向排列，评估证据与适用条件仍可展开查看。

“清除筛选”位于筛选区域末尾，与筛选控件底部对齐；结果栏保留匹配数量与显示方式切换。
