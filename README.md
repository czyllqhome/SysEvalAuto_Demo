> 2026-11-05：统一全站字体、字号、控件与自适应内容宽度，减少宽屏留白。说明 / Unified interface: [docs/interface-design.md](docs/interface-design.md).

> 2026-11-05：新增管理员管理工作台。admin 登录默认进入 `/dashboard`，原台账位于 `/assessments`；当前组织评估、供应商协同、整改、待办、系统等级及部门分布均使用真实记录。中英文切换保留原文，无迁移或数据重置。见 [工作台说明](docs/admin-dashboard.md)。
> English: Admins now land on a live organization dashboard; the assessment ledger remains available separately.

> 2026-11-05 整改闭环：负责人保存决定后自动下发被打回项；后续轮次只整改这些项，已接受承诺和逐项决定保持锁定。高风险经负责人逐项接受后按中风险记录，原始来源及报告不改写。全部接受后自动冻结基线，双方独立确认同一 hash 后自动转为待开发、开放最终稿下载。详见供应商协同说明。
> English: Saving owner decisions opens a scoped remediation round or freezes an all-accepted baseline. Accepted risk is recorded as Medium without changing source ratings. Independent same-hash confirmation by both parties automatically finalizes development readiness.

> 2026-11-05：复核页移除独立“例外与排除项审查”及其必填限制；历史说明、来源风险和独立双签保留。本页新增可撤销的负责人审查 Demo，填入三条用户示例，不自动保存或调用 AI。Retired the separate exception field; review Demo remains editable and requires individual High-risk acknowledgement.

> 2026-11-05 补充：来源高风险的待澄清项也必须由负责人逐项决定；可接受并记录责任理由，或要求澄清。批量操作跳过这些项；决定绑定当前提交和报告，不修改来源风险、供应商答复或独立双签要求。
>
> English: source-High clarification requires an individual owner decision. Acceptance requires a rationale and is bound to the current submission/report; bulk actions skip it.

> 2026-11-05：供应商提交复核后仅保存不可变答复，直接进入负责人复核，不自动调用 AI 或排队影响分析。负责人默认查看开发项确认比例、部分/无法完成/待澄清数量，以及固定来源中高风险未确认项；后续规则/AI 审查按需显式发起，原双签及风险门槛保留。无需迁移或重置数据。详见[供应商协同说明](docs/supplier-prd-delivery.md)。
>
> English: submission now shows a pinned commitment summary without automatic analysis. Subsequent rule/model review is explicit; existing review gates and independent baseline confirmations remain intact.

> 2026-11-05：AmerSports-2.18 / 规则引擎1.8.2 移除原定级 G02（来源 B03，`independent_business`）及其 QA01 边界复核规则。定级页现为14题，展示编号顺延为 G01–G14；缺失、否、不确定均不再触发该题的必填或复核。历史答案、说明、已确认结果及基线保留；重新计算使用新规则。责任主体校验继续有效，无需数据迁移或重置。
>
> English: The former G02 independent-business question and its QA01 review rule are retired. Grading now has 14 questions. Historical answers and confirmed snapshots remain intact; new calculations ignore this field. Responsibility checks remain active.

> A04 综合描述已拆为 A04 建设目的、A05 业务功能、A06 使用场景，三题独立 AI 优化；A07 为业务类型。旧描述保留只读查阅。

> 当前问卷已移除 G 章节：A–F 六章节、56 道有效题；历史答案保留，未填 G 项不再阻止提交。

> 网络信息已拆分为 B07–B10 四题，当前有效题共63道；旧描述及附件保留。

> 当前问卷 AmerSports-2.1：60 道有效题、A–G 七章节；界面与校验调整见 docs/mlps-intake.md。

> 当前问卷已更新为 Amer Sports 场景版 2.0：70 道有效题、连续章节编号、业务选项和逐题填写参考；历史字段和答案保留。

> 2026-11-03：当前定级信息收集已更换为 MLPS V1.0 八步问卷；旧初筛界面退役、历史数据保留。见 [实现与使用说明](docs/mlps-intake.md)。

> 2026-11-03 Demo: 项目机制和控制库写入入口已停用；使用直接评估、CN MLPS 来源库和 PRD v2。Current behavior: [更新说明 / Current contract](docs/direct-assessment-mlps.md).

> Demo copy: see [DEMO.md](DEMO.md) for this copy's path, independent database and startup command.

# Scope: system assessment and supplier collaboration

2026-11-05：新增六组 Amer Sports 虚构演示场景，供 admin 工作台展示评估阶段、供应商协同及整改状态。原有记录保留；详见 [演示数据说明 / Fictional demo scenarios](docs/amer-sports-demo.md)。

2026-11-05：开发进度追踪已更新为总览、状态筛选、任务卡和独立人工验收；支持保存并提交、退回补充及重新打开原因展示。中英文、原始记录与双方基线保留，无数据库迁移。见 [开发追踪说明](docs/development-tracking.md)。

English: Development tracking now combines progress, evidence submission, changes and independent acceptance in one workspace.

## Finding delivery evidence

After baseline agreement, open delivery tracking to collect screenshots/files per finding,
review immutable supplier submission rounds, request more evidence and complete delivery review.
Existing-system supplier remediation returns to customer retesting before gaps close.
See [the development and implementation record](docs/finding-delivery-evidence-development.md).
Deployments require the additive `delivery_evidence` migration; attachments stay in the
configured database. AI evidence assessment is available for immutable submitted files and
screenshots, with separate customer acceptance. See [supplier PRD and delivery workflow](docs/supplier-prd-delivery.md).

The control library now accepts seven-column labeled multi-framework Excel workbooks
directly. `source` supplies the framework filter and `label` supplies the domain filter.
Review the import's profile defaults, merge to draft, then explicitly publish.
See [the column contract and mapping rules](docs/control-library.md).

## 2026-10-29: administrator and project-manager authority

Administrators have full customer-side access to every assessment in their organization,
including progress, editing, review, role grants and direct task assignment. No manager
membership or second assignment by a manager is required for administrators.
Managers have full customer-side permissions within their assigned projects and can
replace or revoke operator, reviewer, viewer and supplier memberships. They cannot grant
manager/admin privileges or modify accounts that are administrators or managers.
Ordinary operators/reviewers still require task assignment and retain contribution checks.
Administrator/manager customer actions can span editing, review and final confirmation;
independent supplier identity, same-hash confirmations, source and version checks remain mandatory.
Project and task assignment is centralized in the left navigation's Projects & assignments
page, with existing assessment selection, instead of repeating on each workflow stage.
Account creation, password resets, activation and organization administration remain admin-only.
No migration or runtime-data reset is required.


Scope is a working local application with Chinese and English interfaces. It takes
a system from a natural-language business description to an agreed development
baseline. React provides the review workspace; FastAPI and SQLAlchemy persist its
records in SQLite locally or PostgreSQL in deployment.

## Run locally

The canonical local checkout is `A:\SysEvalAuto-v0.0.1`. See
[integration and recovery notes](docs/integration-recovery.md) for the consolidated
questionnaire, supplier CSV, project roles, imported accounts, and startup SOP.

Run these commands from this directory. They install only this application's dependencies.

```powershell
uv sync --project backend --extra dev
npm --prefix frontend ci
npm --prefix frontend run build
python run.py
```

Open [the workspace](http://127.0.0.1:8000). Create a customer account and use
“Start with a service portal example” for an editable starting point. No account
or password is built into the product. Supplier accounts are created by an administrator with a project supplier role or through a
customer-issued invitation. Browser QA records are synthetic local test data.

The server persists records in `.syseval/assessment.db` and runs an embedded worker.
Restarting preserves drafts, invitations, submissions, and baselines. All runtime
storage belongs to this standalone application.

## What works

Account and project-role setup is explained in the [identity and roles guide](docs/identity-and-roles.md).
Administrators can create a project, create an account with initial manager/operator/reviewer/viewer
roles, or edit existing accounts using the visible project-role form. The make/remove-admin action grants or revokes full organization and project authority.

The previous demonstration questionnaire and starter controls remain retired. The new
versioned control library supports manual editing, Excel templates, MLPS import,
mapping review, and explicit publication. A published library enables its tag-driven
classification questionnaire. Before publication, manual classification remains available.
New workspaces receive no automatically published controls. See the
[control library guide](docs/control-library.md) for setup and version upgrades.

- Chinese/English forms, navigation, status labels, errors, and document scaffolding.
  Switching the interface preserves authored business text.
- Eight guided input topics, explicit local/model organization, editable application
  briefs, clarification questions, and customer confirmation of extracted facts.
  Original notes are entered once. After classification, a separate brief-review
  page organizes the saved notes, highlights gaps and grading conflicts, and matches
  controls only after explicit confirmation. Original notes stay read-only there.
- L1/L2/L3 rule evaluation, manual selection, unknowns, downgrade records, and renewed
  grading when confirmed model-extracted grading facts change.
- Bilingual starter controls, domain/text search, level inheritance, project-only
  controls, reasoned exclusions, conditional candidates, and atomic CSV publication.
- PRD business/control source coverage, immutable manual revisions, approval, and
  Word (.docx) downloads, with Markdown retained for preview and compatible API clients.
- Supplier invitations and link reissue, independent accounts, conditional forms,
  autosave, immutable submissions, and documented negotiation rounds.
- Impact findings with quoted evidence, customer decisions, exception review,
  same-hash two-party confirmation, and atomic `PENDING_DEVELOPMENT` finalization.
- Persistent jobs, leases, fencing, bounded retries, stale-result rejection,
  usage recording, a per-system token threshold, and audit history.

The historical starter fixture contains 15 proposed internal controls and is not enabled
for new workspaces. Imported MLPS tag mappings are drafts requiring review. Local rule-based drafts are explicitly labeled. They do not
call a model or silently replace a failed OpenRouter request.

## Enable OpenRouter

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in the server process environment,
then restart. `OPENROUTER_PROVIDERS` optionally restricts provider slugs;
`OPENROUTER_ZDR=true` restricts routing to compatible zero-retention endpoints.
Alternatively, save these `OPENROUTER_*` settings in the project-root `.env` file.
`python run.py` loads the OpenRouter settings from that file, preserving
explicit process environment values. Database and worker settings in a Compose
env file are ignored by the local loader; configure those through process variables.
Restart the server after changing settings, then refresh the page. The startup
message reports configuration status without displaying the key.
Select OpenRouter and an output language in the generation controls. Keys remain
on the server. Configuration detection does not verify provider credentials or quota.

The adapter requests strict JSON Schema output and independently validates source
references and completeness. Endpoint support must be verified for the configured
model/provider. Offline transport tests do not use a live key or paid model call.

For a model that supports reasoning token budgets, set
`OPENROUTER_REASONING_TOKENS=2048` to reserve more of the total output budget for
the document itself. This must be below `SYSEVAL_MAX_OUTPUT_TOKENS` (default 12000).
Leave it empty for providers/models that do not support this parameter. Truncated
responses are rejected with a specific error and their reported usage is recorded;
the worker does not repeat the same truncated request automatically.

## Develop and verify

```powershell
# Optional frontend hot reload; keep the API running separately
npm --prefix frontend run dev

# Backend and frontend checks
uv run --project backend --extra dev python -m pytest evals/deterministic -q
uv run --project backend --extra dev ruff check backend/app backend/migrations evals/deterministic run.py
npm --prefix frontend test
npm --prefix frontend run build
```

Vite proxies `/api` to port 8000. `SYSEVAL_PORT` changes the built application's
port; `SYSEVAL_DATABASE_URL` selects another database. Tests use fresh temporary
SQLite files, or isolated random PostgreSQL schemas when
`SYSEVAL_TEST_DATABASE_URL` points to a dedicated test database.

## Deployment and references

- [Operations](docs/operations.md) covers Compose, migrations, backups, configuration,
  deployment boundaries, and shutdown.
- [Implementation map](docs/implementation.md) explains actual modules, API commands,
  persistence, verification, and remaining production work.
- [Development specification](development-specification.md) preserves the acceptance
  plan and records the current implementation choices at its beginning.
- [CSV example](control-import.example.csv) demonstrates three fictional import rows.
- [Document index](docs/README.md) links the application documentation.

This release uses local account authentication. Enterprise OIDC, automatic email
delivery, PDF export, and production disaster-recovery/large-capacity validation
remain separate deployment work. Configure HTTPS before enabling secure cookies
and exposing the service beyond its loopback defaults.

Discovery now includes an optional “AI 优化描述 / Refine with AI” action for each of the eight topics. Review the suggestion and separate clarification questions, then accept to replace or keep the original. Acceptance can be undone before further edits. The action requires configured OpenRouter credentials and uses the existing background worker; ordinary typing and autosave do not call a model.

Current initial grading uses [SYS-SCREEN/2](docs/system-screening.md) without requiring a published library. Choose the desired frameworks and complete the core questionnaire. Published framework/level controls are required before control matching. This supersedes the earlier publication prerequisite for new assessments; existing MLPS-TAGS/1 assessments keep their original method.


## 2026-10-26: modern workspace, Demo input and AI administration

The existing React application now uses a blue/slate workspace theme, rounded cards,
responsive prompt navigation, and consistent native select styling (including multi-selects).
Native keyboard and screen-reader behavior is retained without a second UI framework.
Demo buttons fill editable service-portal notes, screening settings and supplier responses;
Undo restores the pre-fill values. Existing autosave still saves draft changes. The brief
page offers explicit local rule organization from saved notes. No Demo action approves a
PRD, submits supplier commitments, publishes controls, or confirms a baseline. A published
control library and independent supplier identity remain required for the full workflow.

Administrators open **AI models & prompts / AI 模型与提示词** from navigation.
`GET/PUT /api/v1/admin/ai-settings` manages organization-scoped OpenRouter model ID,
provider allowlist, ZDR, output/reasoning budgets and eleven editable system templates:
context organization, PRD generation, impact analysis and eight narrative-refinement topics.
`{language}` resolves to Simplified Chinese or English. Defaults can be restored per template
before saving. JSON schema, source identity, coverage, revision and confirmation validation
remain server-owned. The API rejects unknown fields and stale setting versions; updates
are recorded in administrator audit. Credentials are never returned or stored in this table:
configure `OPENROUTER_API_KEY` in the server environment/root `.env` and restart to change it.
The status indicator reports key presence, not verified provider availability or quota.

Settings use the additive `ai_settings` migration (local auto-create also creates the table).
Unset organization settings inherit server environment defaults. New model jobs snapshot
non-secret configuration and templates in job usage; retries retain that snapshot even if
an administrator edits settings. Local rule drafts remain separate and use no model.
Offline regression tests cover organization isolation, admin authorization, conflict handling,
invalid configuration, secret omission, pinned model/template transport and explicit Demo edits.


## 2026-10-26: focused account settings and audit navigation

Projects & roles now shows a searchable account list; selecting an account opens its
administration and project-role settings in a dialog. Existing readable assessments
show their project association separately. An unlinked assessment can explicitly create
a same-name project before role grants and assignment; this does not copy assessment
content or grant access automatically. See [identity and roles](docs/identity-and-roles.md).

Administration audit has its own `/audit` navigation entry, with action, actor and date
filters and pagination. List requests use summaries; record detail is loaded on demand.
Imported history remains available with keyword filtering. All audit requests retain
administrator and organization checks. Account/project names remain authored text when
switching Chinese/English. Offline tests use isolated databases.


## 2026-10-28: import existing Markdown PRDs

The description page now offers **从已有 PRD 导入 / Import an existing PRD**.
Select a UTF-8 `.md` file (up to 60 KB), preview it, and explicitly choose
**解析并自动填充 / Parse and autofill**. OpenRouter extracts all eight description
topics, fills untouched empty fields and leaves missing information blank.
Existing notes remain intact. Evidence, missing topics, source conflicts, import
history, selected updates and safe undo are available in the import panel.
Confirmed assessments require an explicit revision before applying imported changes.

Administrators can edit the new PRD extraction prompt in AI settings (12 templates).
The additive `prd_imports` migration stores source documents and application records;
local startup creates missing tables without clearing runtime data. Production deployments
must apply migrations before restarting workers. See [PRD import implementation](docs/prd-import.md).

## Project supplier accounts

Administrators can create a supplier with the exclusive `supplier` project role. Each managed supplier retains an independent organization and sees only explicitly assigned PRD tasks. Managers select authorized accounts when publishing an approved PRD; response, review and independent same-hash confirmation use the existing workflow. Revoking the project role removes task access. See [identity and roles](docs/identity-and-roles.md). Apply the additive `managed_suppliers` migration in deployments.

## 2026-11-01: existing-system assessment workflow

New-system and existing-system assessments now share creation, classification,
control matching and authorization. Existing assessments add evidence-backed
verification, reviewed reports, gaps, remediation plans, supplier same-hash
confirmation, risk acceptance and retesting. Development remediation links to the
existing PRD workflow; agreeing a development baseline does not close its parent gap.
See [the dual-workflow update](docs/existing-system-assessment-update.md) and
[implementation details](docs/implementation.md). Apply the additive
`existing_assessments` migration before deployment; local auto-create adds missing
tables on restart. Existing runtime records and baseline hashes remain unchanged.


## 2026-11-04：PRD v3 阅读与填写

默认 PRD 改为九章正文与可折叠附录，安全开发需求只按域展示控制内容；验收、项目实施说明与来源移至附录。联系人、数据范围与恢复目标使用可读格式；逐项编辑支持搜索和折叠。已有草稿可应用当前模板保存未批准新修订，保留需求 JSON、来源、生成方式与旧稿。无需迁移或重置数据。详见 [模板说明](docs/prd-template-review.md)。

English: PRD v3 groups control-only security content by domain and separates acceptance/provenance appendices. Applying a template creates an unapproved revision, preserving history, references, generation mode and approval boundaries.
