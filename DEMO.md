> 2026-11-03：当前定级信息收集已更换为 MLPS V1.0 八步问卷；旧初筛界面退役、历史数据保留。见 [实现与使用说明](docs/mlps-intake.md)。

> 2026-11-03 Demo: 项目机制和控制库写入入口已停用；使用直接评估、CN MLPS 来源库和 PRD v2。Current behavior: [更新说明 / Current contract](docs/direct-assessment-mlps.md).

# SysEvalAuto Demo v0.1

本副本位于 `A:\SysEvalAuto_Demo_v0.1`，复制自 `A:\SysEvalAuto-v0.0.1`。

- 启动：`powershell -ExecutionPolicy Bypass -File A:\SysEvalAuto_Demo_v0.1\Start-Demo.ps1`
- 访问：http://127.0.0.1:8010
- 数据：本目录 `.syseval/assessment.db`，由原数据库通过 SQLite backup 创建一致性快照，保留原账号和业务记录。后续数据与原项目独立。
- 模型配置：本目录 `.env`；凭据仅保存在本地服务端配置中。
- 日志：`.syseval/demo.stdout.log` 与 `.syseval/demo.stderr.log`。
- 原项目的备份和历史测试输出保留在原目录；本副本不包含 Git 历史或临时测试输出。依赖环境已独立安装，前端已重新构建。

This is an independent local Demo copy with its own database snapshot and dependency environment.
Start with `Start-Demo.ps1`, then open http://127.0.0.1:8010.
