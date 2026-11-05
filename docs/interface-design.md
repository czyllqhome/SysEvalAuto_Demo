# Unified interface / 统一界面

2026-11-06：分级方法页保留当前应用矩阵、两个维度及企业内部下限三块内容；移除 E09/E10、计算示例、零损害/未知解释框、下限核实段及“从矩阵结果到初步建议”解释框。合法权益特别严重损害显示 3 级，与后端共用矩阵数据。侧栏移除品牌英文副标题，RBAC 职责矩阵移至“规则”，审计日志单列“审计”分组；中英文及管理员可见范围同步。

English: The method page now has three focused sections using the shared current matrix. Administrator RBAC belongs to Rules, Audit logs has a separate group, and the sidebar brand subtitle is removed. Existing access boundaries remain.

2026-11-05：全站由 frontend/src/interface.css 统一装载样式。历史页面布局放入 features 级联层，共享视觉规则位于层外；组件不再单独导入 CSS，避免路由导入顺序改变外观。

字体统一使用 Segoe UI、Microsoft YaHei、PingFang SC 系统字体栈；正文与表单 14px，辅助文字 12px，卡片标题 16px，章节标题 20px，页面标题 26px，统计数字 32px。小屏页面标题 24px。代码与来源标识保留等宽字体。

内容区取消固定最大宽度，桌面左右内边距 24px，小屏 16px/12px。管理端、客户与供应商共用导航宽度。页面标题、卡片、按钮和表单采用统一尺寸。台账筛选和创建账号表单在宽屏并排、小屏堆叠。长表格与工作流导航在各自区域滚动；保留键盘焦点和新增跳转主要内容链接。

Shared typography, spacing, surfaces and responsive full-width layout apply across roles. Existing feature-specific grids and semantic risk/model labels remain. No business rules, authored text, database schema, confirmation gates or runtime records change.

Verification: frontend unit suite, production build, offline delivery browser tests (Chinese desktop and English mobile), backend deterministic suite and Ruff. Browser fixtures intercept API calls and do not touch runtime data.

2026-11-05：`/team` 人员与权限页新增账号目录、状态和角色筛选、账号与评估概览、账号配置弹窗和逐评估授权表。桌面端充分利用内容宽度，手机端账号表格转为两行信息卡；中英文界面保留用户填写的姓名与登录名。权限提交仍使用原接口、组织边界与评估版本检查。

The People & access workspace uses the shared typography and surface scale. Its mobile directory becomes readable account rows; responsive checks cover desktop and mobile without runtime writes.

2026-11-06：`/team` 账号姓名由 14px 增至 16px，登录名、组织角色及状态统一为 14px。移除页面标题与账号目录标题下的两段说明（中英文同步）。头像取字跳过“【演示】”或“【演示虚构】”前缀及起始标点，以企业名或姓名首字显示；目录、评估成员表及配置弹窗共用同一规则，完整姓名和演示标记仍按原文展示。

English: People & access uses 16px account names and 14px usernames, roles and statuses. The page and directory descriptions are removed in both languages. Avatars use the first letter or character after a Demo prefix and leading punctuation; full authored names and Demo labels remain unchanged across the directory, assessment members and account details.

2026-11-05：`/library` 控制条目库采用统一的工作台样式：概览统计、发布状态、控制域导航、关键词及来源/风险/等级筛选、分页条目表和原文详情。管理员按需打开导入弹窗；无文件时不能提交。宽屏利用可用内容宽度，手机端表格转为信息卡并保持无横向溢出。界面标题和来源标签使用中英文通用名称，不显示来源缩写；控制编号、要求原文与来源行号仍保持可查。旧版只读发布通过原接口适配到相同浏览布局。筛选和查看不写入运行库，上传仍走原有校验接口。

English: The control library now uses the shared workspace design with overview metrics, domain navigation, search, filters, pagination and original-text details. Import stays explicit and admin-only. Source records, identifiers and row references are unchanged; the read-only legacy endpoint remains browsable. Desktop and mobile layouts were checked at a 487-row scale without changing runtime data.

## 2026-11-06: AI configuration workspace / AI 配置工作台

`/ai-settings` 使用与人员页、控制条目库一致的蓝灰主题、四列概览、白色分区和自适应布局。概览展示已保存模型、服务端密钥配置状态、当前 AI 场景数和配置修订；密钥已配置不表示连接或额度已验证。模型与路由、输出/推理预算和零数据保留分别呈现；预算越界或空提示词不能保存。未保存修改明确计数，支持放弃本页修改，保存失败保留输入。

提示词按实际业务入口分组，支持搜索和当前/历史/全部筛选：5 个当前可配置模板、2 个只读系统指令、12 个历史兼容模板。历史模板保留原文，不出现在默认列表；系统模板展示真实指令。旧版描述与应用说明入口不再伪装成当前场景。切换场景与中英文不会改写用户内容。PRD Markdown 版式作为独立折叠区，保留原上传、编辑与版本化保存。

English: The AI configuration workspace shares the existing blue/slate visual system. It separates routing, budgets, prompt applicability and document layout; displays honest credential status and unsaved changes; and preserves edits on errors and locale changes. Five editable prompts, two system-managed instructions and twelve historical templates are explicitly distinguished. Desktop/mobile browser fixtures intercept all API requests and reject writes.
