# Unified interface / 统一界面

2026-11-05：全站由 frontend/src/interface.css 统一装载样式。历史页面布局放入 features 级联层，共享视觉规则位于层外；组件不再单独导入 CSS，避免路由导入顺序改变外观。

字体统一使用 Segoe UI、Microsoft YaHei、PingFang SC 系统字体栈；正文与表单 14px，辅助文字 12px，卡片标题 16px，章节标题 20px，页面标题 26px，统计数字 32px。小屏页面标题 24px。代码与来源标识保留等宽字体。

内容区取消固定最大宽度，桌面左右内边距 24px，小屏 16px/12px。管理端、客户与供应商共用导航宽度。页面标题、卡片、按钮和表单采用统一尺寸。台账筛选和创建账号表单在宽屏并排、小屏堆叠。长表格与工作流导航在各自区域滚动；保留键盘焦点和新增跳转主要内容链接。

Shared typography, spacing, surfaces and responsive full-width layout apply across roles. Existing feature-specific grids and semantic risk/model labels remain. No business rules, authored text, database schema, confirmation gates or runtime records change.

Verification: frontend unit suite, production build, offline delivery browser tests (Chinese desktop and English mobile), backend deterministic suite and Ruff. Browser fixtures intercept API calls and do not touch runtime data.
