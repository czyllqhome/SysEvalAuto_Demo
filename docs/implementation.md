> 2026-11-05 补充：来源高风险的待澄清项也必须由负责人逐项决定；可接受并记录责任理由，或要求澄清。批量操作跳过这些项；决定绑定当前提交和报告，不修改来源风险、供应商答复或独立双签要求。
>
> English: source-High clarification requires an individual owner decision. Acceptance requires a rationale and is bound to the current submission/report; bulk actions skip it.

> 2026-11-05：供应商提交复核后仅保存不可变答复，直接进入负责人复核，不自动调用 AI 或排队影响分析。负责人默认查看开发项确认比例、部分/无法完成/待澄清数量，以及固定来源中高风险未确认项；后续规则/AI 审查按需显式发起，原双签及风险门槛保留。无需迁移或重置数据。详见[供应商协同说明](supplier-prd-delivery.md)。
>
> English: submission now shows a pinned commitment summary without automatic analysis. Subsequent rule/model review is explicit; existing review gates and independent baseline confirmations remain intact.

> 2026-11-05：AmerSports-2.18 / 规则引擎1.8.2 移除原定级 G02（来源 B03，`independent_business`）及其 QA01 边界复核规则。定级页现为14题，展示编号顺延为 G01–G14；缺失、否、不确定均不再触发该题的必填或复核。历史答案、说明、已确认结果及基线保留；重新计算使用新规则。责任主体校验继续有效，无需数据迁移或重置。
>
> English: The former G02 independent-business question and its QA01 review rule are retired. Grading now has 14 questions. Historical answers and confirmed snapshots remain intact; new calculations ignore this field. Responsibility checks remain active.

> 2026-11-04：移除独立系统信息录入步骤；确认分级后直接审查应用说明。历史 discovery 链接重定向；无历史描述时从已确认问卷预填，保留人工补齐与确认。

> 当前 AmerSports-2.16 / 规则引擎1.8.0：只以当前可见问卷字段进行分级。退役 B11 承载对象、B12 特殊边界及大数据平台适用性题，取消承载下限和相关结果卡片。历史答案保存但不参与当前结果。B04 对接等级、D01 数据类别明细仍按所选答案展开；未展开的旧答案不影响等级或复核。E09/E10 仅校验当前所选客体，其他客体不再要求补答或理由。旧个人信息开关不再决定当前字段显示或规则。Current grading uses visible questionnaire inputs only; historical answers remain stored.

> D03 已改为条件显示的人数范围，原 D04 主体人数移除，数据量使用双范围下拉框；旧数字和记录保留，规则按范围边界处理。

> A04 综合描述已拆为 A04 建设目的、A05 业务功能、A06 使用场景，三题独立 AI 优化；A07 为业务类型。旧描述保留只读查阅。

> F 组影响录入已改为两个下拉框组合，按业务信息/系统服务分别添加客体与程度；原六项字段、理由、未知处理和矩阵不变。

> 当前问卷已移除 G 章节：A–F 六章节、56 道有效题；历史答案保留，未填 G 项不再阻止提交。

> 网络信息已拆分为 B07–B10 四题，当前有效题共63道；旧描述及附件保留。

> A03 已支持按部门填写对接人，A04 已接入显式 AI 描述优化；实现与数据契约见 mlps-intake 说明。

> 当前问卷 AmerSports-2.1：60 道有效题、A–G 七章节；界面与校验调整见 docs/mlps-intake.md。

> 当前问卷已更新为 Amer Sports 场景版 2.0：70 道有效题、连续章节编号、业务选项和逐题填写参考；历史字段和答案保留。

> 2026-11-03：当前定级信息收集已更换为 MLPS V1.0 八步问卷；旧初筛界面退役、历史数据保留。见 [实现与使用说明](mlps-intake.md)。

> 2026-11-03 Demo: 项目机制和控制库写入入口已停用；使用直接评估、CN MLPS 来源库和 PRD v2。Current behavior: [更新说明 / Current contract](direct-assessment-mlps.md).

# Implementation map

## 2026-11-05: narrower domain rows

The domain-row control view caps its central panel at 760px on desktop, keeping the
scope summary adjacent instead of stretching each control across a wide screen.
Domain headings wrap their counts when needed. Small screens retain the single-column
layout; card view and selection behavior are unchanged.

## 2026-11-02: finding delivery evidence

`delivery_models.py`, `delivery_rules.py`, `evidence_service.py`, `delivery_service.py`
and `delivery_routes.py` implement database-backed attachments, immutable per-finding
submission rounds, customer review, reopening and batch completion. `DeliveryWorkspace.tsx`
provides a bilingual customer/supplier workspace linked from navigation and assessments.
Apply the additive `delivery_evidence` migration after `existing_assessments`.
Original baseline hashes and independent confirmations remain unchanged.
New supplier remediation plans require this workflow; historical plans switch explicitly.
Completion only enters awaiting retest, never closes gaps without the existing customer retest.
See [design and implementation boundaries](finding-delivery-evidence-development.md#15-首版实施记录2026-11-02).

Control review presents controls in two columns of cards when the results panel
has enough width, falling back to one column below 680px. Cards in each row
stretch to equal height and align their evidence entry at the bottom. Control titles, body
text, evidence and selected-scope domain counts use larger, readable type. Search,
pagination, source details and inclusion/exclusion behavior are unchanged.

## 2026-10-29: compact description workspace

PRD intake is collapsed to a single disclosure row; expanding it exposes upload,
parsing, history and evidence review. Demo actions use a single button to the right of each applicable page title
(description, initial screening, brief organization and supplier response). Fill buttons
switch to Undo after use. All assessment steps share the same compact title spacing
below the workflow navigation. AI refinement controls sit below the original-note editor, with model
suggestions and clarifications in an adjacent review column on desktop (stacked
on narrower screens). Explicit parsing/refinement, acceptance, stale-source checks,
undo, bilingual copy and autosave retain their existing behavior.

The dashboard's descriptive copy, breadcrumb and statistics labels use one larger
type step (+2px), preserving statistic numeral sizing. The dashboard workflow overview
has been removed; the assessment ledger remains the main content below the statistics.

## 2026-10-29: labeled multi-framework Excel intake

`labeled_controls.py` adds an atomic seven-column adapter, selected before the legacy
MLPS parser. It registers known bilingual domain labels within the import snapshot,
preserves raw source evidence, normalizes the agreed NIST worksheet source, and returns
bilingual preview warnings for default profile mappings. Existing admin, organization,
batch revision, publication and downstream confirmation checks are unchanged.
Offline coverage is in `evals/deterministic/test_labeled_controls.py`.

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


## 2026-10-28: evidence-backed PRD intake

`prd_imports.py` and `PrdImport.tsx` implement Markdown intake, evidence validation,
eight-topic autofill, history, selected updates and safe undo. Durable
`prd_import_extraction` jobs pin the source document, mapping version, model settings
and initial edit counters. Workers only fill untouched empty fields; the narrative
page merges returned fields with unsaved local input. Source links survive in draft
snapshots and confirmed context revisions. Confirmed assessments require explicit
revision acknowledgement before import updates. The additive `prd_imports` migration
adds source and application tables; existing `ai_jobs` retain extraction snapshots.
See [PRD intake](prd-import.md) for API details, limits and verification boundaries.


## 2026-10-27: Markdown PRD templates

`prd_templates.py` manages organization layouts through GET/PUT `/admin/prd-template` with admin authorization, shared AISettings revision checks and audit. `PrdTemplateEditor.tsx` supports `.md` upload, editing and deletion. Job usage pins the template for local/model generation; immutable audit snapshots retain the template for successor manual PRD edits. Source coverage and supplier requirement identities remain server-owned. See [template review](prd-template-review.md) for the provided template assessment, adapted default and placeholder contract.

## 2026-10-25: visible project-role assignment

Project-role grants are now shown directly in the team page, separately from the global
admin toggle. Account creation can include a project and one or more fixed business roles;
the account, memberships and management audit events commit together. Invalid or cross-organization
grants leave no partial account. Existing-account grants retain the PUT membership contract.
Changing one's own access ends the local session immediately. Bilingual forms preserve authored
input and selected roles. See [identity and roles](identity-and-roles.md) for the current permission
map, setup instructions and differences from the archived questionnaire application's design.

`frontend/src/ProjectRoles.tsx` owns the role guide, initial-account grant form and visible
existing-account editor; `Team.tsx` owns administration actions, audit display and task assignment.

## 2026-10-25: versioned control library and MLPS tags

The application now includes organization-scoped control drafts, manual editing,
standard XLSX create/update/retire imports, MLPS source adaptation and annotated export,
review gates, immutable publication, and configurable questions/domains/topics/profiles.
Published configuration enables three-valued applicability and internal risk grading.
The implementation and API contract are documented in [control library](control-library.md).
Legacy CSV and retired test fixtures retain their existing behavior; descriptions below
of four fixed tags apply only to that legacy path. The new engine uses published facts.

New persistence uses additive tables in migration `control_library`; existing runtime
records are not cleared. Current assessments pin a catalog and configuration hash.
Profile edits or explicit catalog upgrades require new classification and downstream review.

Scope implements the customer/supplier workflow in an independent application.
Its packages, configuration, design assets, and runtime storage are self-contained.
The workspace top bar displays the localized System Security Assessment product name on every route;
the dashboard presents the assessment introduction without the decorative level compass.
Its statistics strip contains three equal-width counts; classification guidance is available on the method page.

## Code ownership

The 2026-10-24 integration adds `access.py` (project permissions), `integration.py`
(administration and intake routes), `intake/` (19-question classification and supplier
CSV round trips), `import_legacy.py` (repeatable account/evidence migration), and
`Questionnaire.tsx` / `Team.tsx`. These extend the original eight-step workspace.
See [integration and recovery](integration-recovery.md) for paths and migration details.

| Module | Responsibility |
|---|---|
| `frontend/src/App.tsx` | Account/session UI, assessment ledger, catalog administration, and method reference. |
| `frontend/src/Workspace.tsx` | System routing, progress navigation, job polling, and audit history. |
| `frontend/src/narrative.tsx` | Original eight-topic notes, autosave, and continuation to classification. |
| `frontend/src/BriefReview.tsx` | Structured brief review, required-field and grading checks, open questions, read-only evidence, and explicit confirmation. |
| `frontend/src/brief.ts` | Shared completeness and grading-fact helpers. |
| `frontend/src/discovery.tsx` | Classification, control review, and project-only controls. |
| `frontend/src/downstream.tsx` | PRD review/editing, supplier forms, impact review, and baseline confirmation. |
| `frontend/src/components.tsx` | Accessible dialogs, buttons, notices, generation settings, and commands. |
| `frontend/src/i18n.tsx` | Locale preference, topic prompts, domains, status names, and errors. |
| `frontend/src/style.css` | Independent paper/forest design, responsive layouts, typography, and focus treatment. |
| `frontend/src/review.css` | Distinct original-note and structured-review layouts. |
| `backend/app/db.py` | Relational persistence and isolated engine/session construction. |
| `backend/app/domain.py` | Classification, conditional forms, strict contracts, and source/coverage validation. |
| `backend/app/catalog.py` | Starter controls, CSV validation, normalized hashing, and atomic publication. |
| `backend/app/service.py` | Object authorization, workflow, revisions, submissions, and baseline invariants. |
| `backend/app/ai.py` | Local drafts, OpenRouter transport/schema, contact redaction, and Markdown rendering. |
| `backend/app/worker.py` | Job claims, leases, fencing, recovery, retries, and publication. |
| `backend/app/main.py` | HTTP/session boundary, CSRF, local login throttling, commands, and frontend serving. |
| `backend/app/local.py` | Local startup, model-only `.env` loading, and safe configuration-status output. |
| `backend/migrations/` | Initial schema and additive project-control scoping. |

The UI uses custom native controls and Lucide icons instead of Ant Design. This
keeps its visual direction independent. TanStack Query manages server data; React
Router manages navigation. Exact versions are recorded in `frontend/package-lock.json`,
`backend/uv.lock`, and the runtime export `backend/requirements.lock`.

## Actual API

Interactive schemas are available at `/docs`. All business paths start with `/api/v1`.

| Area | Command paths |
|---|---|
| Accounts | `/auth/register`, `/auth/login`, `/auth/session`, `/auth/logout` |
| Invitations | `/invitations/{token}`; invited users register with that token. |
| Systems | `/systems`, `/systems/{id}`, `/systems/{id}/history` |
| Discovery | `/systems/{id}/context-draft`, `/systems/{id}/context-confirmations` |
| Classification | `/systems/{id}/classification-confirmations` |
| Controls | `/controls`, `/systems/{id}/controls`, `/systems/{id}/custom-controls` |
| CSV | `/catalog-template`, `/catalog-imports`, `/catalog-imports/{id}/publish` |
| Jobs | `/systems/{id}/jobs`, `/jobs/{id}` |
| PRD | `/systems/{id}/prd-approval`, `/systems/{id}/prd-versions`, `/systems/{id}/prd-versions/{version}/document` |
| Suppliers | `/systems/{id}/supplier-rounds`, `/systems/{id}/supplier-invitations`, `/systems/{id}/supplier-draft`, `/systems/{id}/supplier-submit` |
| Reviews | `/systems/{id}/review-decisions`, `/systems/{id}/negotiation-rounds` |
| Baselines | `/systems/{id}/baselines`, `/baselines/{id}/confirmations`, `/baselines/{id}/finalize` |

The implementation consolidates the proposal's separate model-job endpoints into
one job command with three types: `context_organization`, `prd_generation`, and
`impact_analysis`. R1 discovery prompts and classification options are versioned
source definitions, rather than an online scheme-authoring interface.

The discovery sequence is now: describe once, confirm the level, review the organized
brief, and confirm before control matching. Only the description page edits original
topic blocks. Brief review saves the proposal without resending or clearing source
notes. Organization is explicit and uses existing notes; opening a page never starts
a paid model request. Required fields and changed grading facts block confirmation.
Original-note edits mark an existing proposal stale. Reorganizing or explicitly
reviewing and saving the updated brief clears that marker. Confirmation and new PRD
generation reject an unreviewed stale proposal. Previously confirmed versions and
downstream artifacts remain stored until an explicit revision command supersedes them.

Mutating system commands compare `version`, authorize the actor, and append an
audit event in the same transaction. Important commands accept `Idempotency-Key`;
changed input under a reused key is rejected. Supplier resubmission creates a new
round. Scope changes preserve prior artifacts while invalidating their current use.

## Persistence and document boundaries

Organizations, users, sessions, systems, context revisions, catalogs, controls,
selections, imports, PRD versions, supplier rounds/submissions, reports, jobs,
baselines, confirmations, audits, and idempotency receipts have relational tables.
PRD requirements/source mappings, supplier answers, and report decisions are
validated immutable JSON snapshots instead of additional normalized child tables.
Stable IDs and validation preserve their references. Reporting requirements may
justify normalizing those children in later migrations.

Raw drafts and confirmed context are separately retained. Model proposals remain
editable until customer confirmation. Business item IDs and control IDs form
independent PRD coverage sets. Markdown and browser preview reference the same
canonical PRD version and recorded renderer revision.

Changing the interface language never rewrites authored records. Generation language
controls scaffolding and model instructions. Local drafts cannot automatically
translate authored text. Starter controls carry both translations; imported/custom
controls fall back to supplied text when a translation is absent.

CSV tags are `external_access`, `personal_data`, `production_admin`, and `payments`,
combined with AND semantics. Unknown conditions become visible candidates and
block generation until explicitly included or excluded. New catalog publication
does not rematch existing pinned assessments.

## Verification and production boundaries

Offline cases cover rules, manual/unknown behavior, forms, source/coverage validation,
CSV atomicity, object isolation, concurrency, stale/fenced jobs, bounded retries,
project controls, conditional candidates, negotiation instructions, idempotent
submission, wrong hashes, and a complete two-party workflow. The suite runs against
SQLite and isolated PostgreSQL schemas. Frontend tests cover locale preservation,
explicit confirmation, dialog focus/Escape, submission gates, and logout cache clearing.
Browser QA additionally exercises the customer and supplier journey to a finalized
ready-for-development baseline. OpenRouter transport tests mock the HTTP response;
they do not imply a paid model/provider smoke test passed.

Verified on 2026-10-19:

- 44 deterministic backend cases passed on SQLite and again on PostgreSQL.
- Seven frontend behavior tests, TypeScript checking, production build, and Ruff passed.
- A deliberately reversed highest-risk rule failed its regression cases; the original
  source was restored before the passing runs and image build.
- The Docker image built and its PostgreSQL/API/separate-worker deployment completed
  the synthetic two-party workflow through `evals/integration/smoke_deployment.py`.
- Real browser QA completed the same workflow, including language switching and
  separate customer/supplier logins. The Playwright scenario under
  `frontend/evals/e2e/` is provided for subsequent automation; it was not executed
  in this verification session.

Enterprise OIDC, identity verification, centralized login throttling, worker alerts,
monetary-budget reservations, retention schedules, scheduled backups/restore drills,
and large-assessment batching/capacity validation remain production work. Available
usage/cost information is recorded. The current token threshold blocks new jobs after
recorded usage reaches the limit; it does not reserve a strict maximum before each
attempt. Exactly-once provider charging after an ambiguous timeout is not guaranteed.

On 2026-10-20, routing diagnostics identified a model-author name used as a provider
allowlist slug. Configuration now uses `qwen/qwen3.8-flash` with provider `alibaba`.
A live synthetic context-organization request passed the strict schema and source
reference checks. This verifies that model/provider combination for discovery,
not every model or generation stage. API errors distinguish routing failures,
invalid parameters, credentials, credits, access restrictions, and explicit refusals.
The expanded offline backend suite has 61 passing cases; frontend behavior tests
and the production build also pass.

R3 PRD transport schemas require a named content slot for every current business
function and selected control. The server binds slot IDs, origins, and database
source IDs, while the model writes the requirement content and acceptance criteria.
Dependency IDs are constrained to the assigned slots. Canonical documents retain
the existing requirement-array contract and pass the same coverage validation.
Optional reasoning budgets leave room for the visible document. Output-limit,
JSON, and schema failures have distinct errors;
reported usage survives these failures and successful recovery clears old errors.
The current offline suite has 76 passing backend cases, including incomplete-slot
rejection, server-owned source binding, failure usage, bounded retries, deadline
handling, and a worker lease longer than the provider deadline.
Live R3 PRD generation also passed in one attempt with complete business/control
coverage; the resulting document remained pending customer review.

On 2026-10-21, the single-entry discovery/review split passed 79 backend cases,
15 frontend behavior tests, TypeScript checking, production build, and Ruff.
Browser QA used a separate example to enter notes, confirm questionnaire answers,
organize locally, edit the structured summary, switch languages without losing the
edit, and explicitly confirm. No controls were matched before confirmation; ten
were selected afterward. The pre-existing system's PRD pointer remained intact.
Additional cases cover source-only/proposal-only saves, stale-review enforcement,
grading conflicts, and delayed-save responses preserving newer edits. This change
did not make a paid model call or reset runtime records.

2026-10-25 control browsing update: `LibraryBrowser.tsx` provides combined source/profile/domain
filters, evidence details, explicit empty states and read-only published snapshots using their
pinned configuration. Project managers can change the control scope in their assigned assessments;
these edits record contribution and retain separation-of-duties restrictions. See the control library guide.

## 2026-10-25: bulk draft deletion

Administrators can select controls across filtered pages and delete them from the draft with an explicit reason. The bulk-delete endpoint checks organization ownership and workspace revision, commits atomically, and records complete removed snapshots in administration audit. Published releases and assessment references remain immutable. Empty drafts remain editable but cannot be published.

Single-level MLPS imports now share worksheet discovery with annotated export, accept normalized worksheet-name separators, validate clause/source-level agreement, and append annotations without overwriting extra original columns. Covered by isolated upload/download/apply regression tests.

MLPS source import accepts the documented unified snake_case headers alongside legacy headers, rejects duplicate aliases and conflicting explicit source levels, and preserves named source fields. Source references follow actual column locations after reordering.

## 2026-10-25: conservative AI narrative refinement

Each discovery topic offers explicit AI refinement through durable `narrative_refinement:<topic>` jobs. Eight prompts in `backend/app/narrative.py` limit editing to grammar, ordering and clarity, preserve the original language and uncertainty, and forbid invented scope/commitments. Clarification questions remain separate from replacement text. Only the selected saved topic is sent through the existing redacted OpenRouter adapter. No automatic local fallback is used.

Suggestions are stored in job output with their original text and prompt version; generation never changes draft blocks. Users preview, accept or discard, and can undo acceptance while text is unchanged. Acceptance uses the existing autosave/version/permission path. Worker source hashes reject outdated results; the UI also blocks adoption after local edits. Existing job audit, token budget, retries, organization isolation and state checks apply. Prompt constraints reduce over-interpretation but do not guarantee semantic equivalence; human review remains required.

## 2026-10-25: narrative refinement R2

Supersedes the conservative copy-editing-only behavior above. The eight topic prompts now allow moderate content elaboration anchored in the supplied concept. Substantive new proposals must be labeled “建议补充（待确认） / Suggested additions (to confirm)”; specific people, numbers, integrations and commitments cannot be fabricated. The goal prompt covers purpose, audience, context and value rather than requiring an existing process problem. OpenRouter transport, human acceptance, original-text retention and stale-result protection remain unchanged.

## 2026-10-25: library-independent screening

`screening.py` implements SYS-SCREEN/2, a separate internal MLPS-inspired screening method. New assessments use it before publication; old MLPS-TAGS/1 snapshots retain their existing path. Framework/level/applicability filtering is shared by preview and materialized selections. Missing published coverage blocks control confirmation rather than inventing controls. See [system screening](system-screening.md) for thresholds, source references, versioning and limitations. Initial-stage name editing uses a versioned audited endpoint.

Question wording update: service-account and privilege-impact questions now use plain-language wording with bilingual examples. Existing default labels are adapted for display without changing stored answers or published snapshots; custom-authored labels remain intact.


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
content or grant access automatically. See [identity and roles](identity-and-roles.md).

Administration audit has its own `/audit` navigation entry, with action, actor and date
filters and pagination. List requests use summaries; record detail is loaded on demand.
Imported history remains available with keyword filtering. All audit requests retain
administrator and organization checks. Account/project names remain authored text when
switching Chinese/English. Offline tests use isolated databases.


Classification multi-value facts (hosting, delivery and responsibilities) use native
checkbox cards with persistent blue borders/backgrounds and checkmarks, including
when focus moves away. Unknown remains exclusive; clearing all choices restores
Unknown. Existing saved values, bilingual labels and fieldset permission controls
are retained. This replaces the native multi-select list in FactFields.


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
# 控制审查补充作答

`GET /api/v1/systems/{id}/applicability-questions` 返回当前修订未决候选引用的未知问题、可见性依赖和受影响控制。`PUT /api/v1/systems/{id}/applicability-answers` 接收 version、answers，沿用编辑权限、组织隔离、幂等及版本校验。仅 CONTROL_REVIEW 可写；非分级事实按锁定配置校验并重新匹配，分级依据变化须重新确认分类。历史修订、原控制库和应用说明保持可追溯，受影响人工决定要求复核。

## 2026-10-28: security assessment identity

Authentication and shared workspace navigation use the product name 系统安全评估 / System Security Assessment. The SCOPE logo and footer branding are removed. The slate theme (#202938) applies to the authentication panel, sidebar and primary actions, with lighter slate selection states. Login copy emphasizes defining security requirements before development. Document titles and mobile headers retain the localized product identity; authored assessment content is unchanged.

Classification topic tabs use a dedicated 24px top margin to separate them from the preceding framework target input.

Assessment workspace headings use 30px titles (26px on phones). Workflow navigation uses 14px labels, equal-width columns and aligned 28px step markers, wrapping into four or two columns on narrower screens.

## Enterprise interface copy

Page headings identify the function directly: system information, brief review, control scope review, PRD review, supplier responses, impact review and baseline confirmation. Dashboard, login helper text and related section headings use concise operational language in Chinese and English. User-authored content and generated documents are not rewritten.

PRD intake uses a compact upload/action toolbar with source preview and results below it. Topic, control-domain and prompt navigation share 14px labels, 44px minimum targets and slate selection styling; wider navigation columns accommodate the larger labels.

## Bulk control-domain exclusions

POST `/api/v1/systems/{id}/controls/exclude-domains` accepts the current `version`, a nonempty `domains` list and a shared `reason`. It uses existing control-selection permissions and requires CONTROL_REVIEW. All included selections in the chosen domains are excluded atomically within the current assessment revision, with the reason stored per control and a detailed domain/ID audit record. Existing exclusions and catalog records are preserved. Invalid domains or stale versions cannot partially apply. The UI previews affected and required-control counts across all pages before submission; required exclusions retain final exception review.

All assessment routes share a compact assessment header wrapping system metadata and workflow navigation. Common spacing and a 90px minimum heading keep step pages consistent; long names and narrow screens can expand naturally without clipping.

## Project supplier accounts

Administrators can create a supplier with the exclusive `supplier` project role. Each managed supplier retains an independent organization and sees only explicitly assigned PRD tasks. Managers select authorized accounts when publishing an approved PRD; response, review and independent same-hash confirmation use the existing workflow. Revoking the project role removes task access. See [identity and roles](identity-and-roles.md). Apply the additive `managed_suppliers` migration in deployments.

## PRD withdrawal

During PRD_REVIEW, editors or project managers can explicitly confirm withdrawal through POST `/systems/{id}/prd-withdrawal`, providing the current system version and PRD ID. This creates a successor assessment revision, copies current control selections and preserves context and historical PRDs, while clearing active downstream pointers and returning to CONTROL_REVIEW. New PRD generation and approval are required before supplier publication. Later stages and supplier/read-only/reviewer-only callers cannot withdraw; optimistic version checks and idempotency use the standard command contract.

## Template-aligned PRD preview

The PRD page renders the exact persisted Markdown returned by its version-specific download endpoint, using react-markdown and GFM tables. It does not rebuild the document with the current template or translate authored text when the UI language changes. Structured requirement review/editing remains available in a separate expandable panel. Raw HTML is skipped, unsafe links are filtered by the renderer, and remote images are represented by their alt text without external requests. Loading failures are explicit and retryable; no fixed-layout fallback silently replaces the template.

## 2026-10-29: compact blue workspace and review guidance

`workspace-theme.css` applies shared navy navigation, blue actions, white cards,
light gray-blue surfaces and system sans-serif typography after existing styles.
Impact review explicitly counts missing decisions and rationales, including filtered
findings, and shows missing exception rationale before saving. Selecting acceptance
alone does not satisfy review requirements; no decisions are filled automatically.

The assessment step navigation uses a continuous chevron track: a flat first edge,
interlocking arrow segments, a dark current step, and checkmarks plus stage numbers.
Narrow layouts scroll horizontally without wrapping stages; disabled steps remain distinct.


PRD model input now sends only `id`, `security_domain` and `control_requirement`
per control. Imported domain wording and current reviewed requirement text are used;
legacy/custom controls fall back to domain and description. Full snapshots remain
server-side for source validation and audit. Requirement slots preserve source IDs.
The input guard defaults to 1,000,000 UTF-8 bytes, increased from 100,000. Configure
`SYSEVAL_MAX_MODEL_INPUT_BYTES` as a positive integer in the server environment.
Compact JSON reduces overhead. The provider model must still support the combined
input/schema/output context size. Restart the backend and retry generation to apply.

Supplier questionnaires use 17px requirement titles, 16px requirement descriptions,
and 15px field labels and editable values. Status and progress text use 14px;
mobile fields stack vertically to accommodate the larger type.
Supplier response rows reserve a fixed status column so unanswered and completed
status labels align consistently regardless of requirement-title length.

Supplier responses use a responsive three-column card grid. Opening a card shows
the existing fields in an accessible dialog; edits remain in parent state and use
the existing draft autosave even after closing. Errors and save state appear in
the dialog. Customer visibility and supplier editing permissions are retained.

Supplier submission exposes only Submit responses, without model/language controls.
Submission starts the existing local rule pre-review and navigates to impact review;
customer-side analysis retains model selection. Incomplete-response counts explain
the disabled submission gate. Submitted rounds remain immutable.

Impact review now shows an overall risk overview. Partial supplier commitments map
 deterministically to medium and unavailable commitments to high risk, including model
outputs after evidence validation. Single-requirement AI assistance is explicitly
requested on unavailable items by a customer with write access. The endpoint checks
system/report revision before and after generation, sends only that requirement and
its redacted submitted answer, uses organization model settings, validates quoted
evidence and records usage in audit. Its advisory result is displayed separately and
does not change customer decisions or baseline confirmations.

Impact review uses three-column cards with dialog-based evidence and decision
review. Enlarged major/moderate counts filter the matching cards and open the
first matching finding. Typography matches the supplier questionnaire.
Impact filters show one Major risk option and All risks (low/medium/high/critical,
excluding unknown). Risk cards expand inline; unknown items retain dialog review.
Single-item model analysis supports partial and unavailable submitted commitments.

Impact risk cards emphasize the requirement/control title. High/critical use red,
medium orange, low yellow, and supplier-confirmed yes responses use pale green
when no known risk is assigned. Evidence-review labels remain visible. Overview
and summary counts share matching right-hand columns.
Impact detail evidence uses a white bordered panel and larger dark labels. Impact
and recommendation appear side by side on desktop; decision and rationale controls
share a 78px height, with white backgrounds and visible borders.

Impact cards are ordered by descending severity: critical, high, medium, low, unknown.

Unresolved control cards and the control-review header expose an explicit Complete
applicability information button opening the existing versioned question form in
a dialog. The inline form and manual include/exclude options remain available.

Applicability dialogs distinguish missing questionnaire facts from manual-review
candidates left by profile changes. When no questions exist, no required-field
instruction is shown. Profile-mismatched cards explain the mismatch explicitly;
manual inclusion/exclusion remains necessary and is never silently decided.

PRD review exposes Edit PRD in its header. The dialog edits title, summary,
requirement prose and acceptance criteria, assumptions and open questions using
the existing immutable revision API. Sources are retained and approval is renewed.

Unavailable/clarification supplier answers normalize a numeric zero duration to
null on submission. Yes/partial commitments continue requiring 1–10000 whole
workdays; frontend completeness now enforces that same positive integer range.

The overview shows a red MLPS Level 3 major-risk notice when high/critical findings
trace to MLPS3-coded or explicitly MLPS/source-level-3 controls. Internal L3 alone
does not trigger this notice.

When major findings exist, the overview displays red Not passed followed inline
by Major risk findings present. This is the rule-based assessment display.

Authorized suppliers can request advisory single-requirement risk analysis on
their visible current report; customer decision permissions remain unchanged.
The overview result and major-risk notice share the same typography.

Impact overview consolidates total findings and risk counts into one row. The
assessment result heading shows its failure reason underneath in smaller type;
the redundant review-summary block is removed.
Overview count labels stay on one line; the total-findings tile receives extra
width, with a stacked layout on narrow screens.

Impact cards show linked control original requirement text from pinned selections,
including the submitted PRD references visible to suppliers. AI requests include
that original text. Static impact/recommendation prose is removed from the cards;
explicit AI results show risks and recommendations separately as advisory text.

Impact cards label the quoted supplier response as Supplier feedback / 供应商反馈.

The impact total-count tile includes a PRD-derived breakdown of control requirements
and in-scope business functions; combined-origin requirements count in both groups.

Sidebar navigation groups links under Assessment, Rules and Configuration, with
existing role-based visibility preserved and empty configuration groups omitted.

Project managers can start assessments from the dashboard and choose an assigned
managed project. Creation can omit a separate operator: the creator is assigned
to the new assessment in that project. Project creation remains administrator-only;
organization, active-project and manager membership checks remain enforced.

## 2026-11-01: existing-system assessment and remediation

Both creation entry points use assessment_creation.py and AssessmentCreate.tsx.
ProjectPurpose, SystemAsset and AssessmentProfile add project defaults, stable asset
identity and assessment lineage without changing historical baseline payloads.
Apply the additive existing_assessments migration in deployments; local auto-create
creates the new tables. Existing records without metadata retain the new-system workflow.

existing_service.py owns current-state verification, reviewed report snapshots, risk
review, remediation plans, acceptance expiry, supplier confirmation, completion and
retests. existing_routes.py reuses the existing versioned command, CSRF, role and audit
boundaries. CurrentAssessment retains each assessment revision; AssessmentEvidence
stores immutable evidence registrations. Source changes prevent stale publication.
Delivery/retest evidence must be registered after plan approval. Failed retests reopen
tasks. Accepted risks remain distinct from repaired gaps and expire into disposition.

Development remediation creates a linked incremental assessment, reusing classification,
control snapshots, PRD generation, supplier rounds and independent same-hash confirmation.
It preserves parent assessment, plan hash and gap references. Agreeing a development
baseline never closes the parent gap: actual delivery and customer retest remain required.
Supplier access is restricted to assigned plans and revoked project memberships lose access.

The bilingual workspace provides creation, asset/type/date/status filters, evidence,
verification, reports, plans, supplier submissions, retests and follow-up assessments.
Reports export reviewed immutable Markdown snapshots; original findings remain separate
from later remediation outcomes. Evidence is registered text/controlled-source description,
not uploaded binary attachments or automatic scanning. Current-state conclusions are
human reviewed; local/model PRD generation keeps its existing explicit provenance labels.

Validation covers isolated API journeys, migration preservation of original baseline
hashes and confirmations, deterministic rule tests, frontend interactions and browser
journeys for the control library, original supplier workflow and existing-system closure.

Dashboard creation entries for new-system and existing-system assessments use the same primary button style and plus icon; each opens creation with its corresponding assessment type selected.

Supplier response cards are split into Business functions and Control requirements pages with per-category completion counts. Combined-origin requirements appear in both pages and share one answer. Autosave and final submission retain the complete round across both pages.

Impact review offers Accept all implementable items for submitted supplier yes responses, across business and control requirements. It fills only undecided findings, preserves authored rationale, supplies a bilingual default accountability/risk rationale, and leaves final persistence to Save review decisions. Existing exception review, revision checks and independent baseline confirmations still apply.

## 2026-11-04: PRD 初稿八范围 / Eight-part PRD draft

默认 PRD 按开发范围、角色权限、业务流程、功能需求、数据接口、安全要求、验收标准、上线计划组织。
分级问卷按当前可见字段逐题归类，保留题号、问题、原始答案及说明；未收集答案留空，退役和条件隐藏字段不参与新初稿。
部门/责任单位/用户归角色权限，典型场景/交易/替代机制归业务流程，部署方式归上线计划，RTO/RPO 归验收标准；
数据、外部连接及依赖归数据接口，网络边界与影响场景归安全要求。问卷没有收集的权限矩阵、上线日期等不自动补造。
已有业务需求、控制原文、验收条件和来源追踪继续保留；本地规则/模型草稿标识及评审要求保持不变。
变更适用于使用默认模板新生成的文档，历史 PRD 和已固定的自定义模板不覆盖，无数据库迁移。

The default draft groups visible grading questions and collected answers into eight sections.
Missing answers remain blank; retired and hidden answers are excluded. Authored text, source references,
requirement acceptance criteria and generation labels remain intact. Existing documents and custom
pinned templates are preserved. No database migration is needed.

## 2026-11-04: Administrator assessment deletion

Organization administrators can delete an assessment from its ledger row after reviewing
its name in a confirmation dialog (Chinese/English). DELETE `/api/v1/systems/{id}` requires
administrator authority, the same customer organization, CSRF and the current `version`.
Deletion stores `deleted_at`/`deleted_by` in the draft, advances revision/version to fence
old jobs, hides the ledger entry and blocks ordinary assessment access. Historical records,
source references, attachments and baseline hashes remain stored. Both assessment and
administration audit record the action. This is a soft deletion; no database migration or
runtime-data reset is required. There is no restore UI in this release.

## 2026-11-04: Eight-part application brief / 应用说明初稿八范围

第 2 步应用说明初稿同步使用开发范围、角色权限、业务流程、功能需求、数据接口、安全要求、验收标准、上线计划八个章节。
当前有效且可见的分级问题与答案归入对应章节，未收集内容留空，保留原有人工编辑与保存。
安全要求下的“安全开发需求”区域留空，控制适用条件以独立折叠审查项保留。
既有草稿和新评估直接使用新布局，无需重新生成或清除记录。

The application brief now shares the eight-part PRD structure. Visible questionnaire
facts are grouped by section, missing answers remain blank, and security development
requirements are left empty. Existing authored fields and confirmation behavior remain.

## 2026-11-04: PRD review refinements / 初稿审查调整

初稿及新生成的默认 PRD 不再列出 B03 独立业务、C04 公共服务判断和重复的 A05 功能原文。
角色权限保留部门信息，并从已确认问卷列出部门对接人；B02 使用其说明中实际填写的负责主体名称，未填写留空。
移除使用/审批角色、业务责任角色输入及其必填拦截，历史值保留。控制适用条件不再展示于初稿，历史条件与分级规则保持有效。
默认正式 PRD 同步移除角色/责任角色正文；功能需求、来源及安全开发需求的既有覆盖机制保留。

Drafts and newly generated default PRDs omit B03, C04 and duplicate A05 facts. Department
contacts and the named security-responsible entity come from confirmed questionnaire data.
Removed role inputs no longer block confirmation; stored historical values remain intact.

## 2026-11-04: Architecture and acceptance grouping

初稿和默认 PRD 第六章改为“系统开发架构”，B05 部署方式从上线计划移入该章。
E03/E04/E05 中断影响场景移至验收标准；B04.1、E06、E07 和全部 E09/E10 影响定级字段不进入 PRD。
这些变更仅调整文档展示，分级问卷、保存答案和定级规则不变；初稿安全开发需求保持空白。

Draft and default PRD section 6 is now System development architecture, including deployment.
Outage scenarios belong to acceptance criteria. Connected-system grade and impact-grading
fields are omitted from documents; questionnaire storage and grading rules are unchanged.

## 2026-11-04: Declarative PRD fact headings

初稿与默认 PRD 的问卷事项使用陈述式小标题，例如“系统的主要建设目的”，不显示题号或提问语气。
中英文标题共用 `backend/app/data/prd_fact_headings.json`，答案原文保持原样。
来源题号及字段在初稿 DOM 属性、Markdown 注释中保留；原分级问卷的问题文案不变。
默认 PRD 的事实段落改为小标题加正文，新生成文档生效，历史文档不重写。

Questionnaire facts now use shared bilingual declarative headings in draft and default PRD.
Source identities remain in DOM attributes and Markdown comments. Authored answers and
original questionnaire prompts remain intact.

## 2026-11-04: Remove duplicate department editor

初稿移除“涉及部门”输入框和必填拦截，保留问卷来源的“业务部门及对接人”表格。
默认正式 PRD 不再重复输出 context.departments；问卷部门、对接人与历史人工数据继续保留。
Department names are no longer a required context-confirmation field; the questionnaire
remains the displayed source for departments and contacts.

## 2026-11-04: Standalone security development section and SLA

初稿及默认 PRD 将“安全开发需求”提升为独立第七章，初稿内容留空。
原验收标准章节改为第八章 SLA，保留恢复目标和中断影响原文；上线计划顺延为第九章。
Security development requirements is now a top-level section. The former acceptance
section is titled SLA; existing criteria and source traceability remain preserved.

初稿不再展示“查看原始描述（只读）”折叠区域；原始描述仍存储并保留来源引用，整理操作仍使用原始数据。
The read-only original-notes disclosure is omitted from the PRD draft; stored source notes
and traceability remain available to the generation workflow.

初稿及默认 PRD 不再显示“系统间数据交换与功能对接”的是/否判断（B04），具体系统接口和外部连接说明继续保留；问卷与分级逻辑不变。
The integration yes/no fact is omitted from draft/default PRD; actual interface and external
connection descriptions remain included.

## 2026-11-04: Remove duplicate context text editors

初稿移除目标摘要、开发范围说明、业务流程、数据说明、系统集成五个输入区域，保留同章节问卷事实。
目标摘要不再作为确认应用说明的必填项。历史人工内容仍保存在 Context/草稿，不被页面修改删除。
默认正式 PRD 移除对应 summary/scope/workflow/data_and_integrations 槽位，缺失槽位不再自动追加到文末。
自定义模板显式引用上述槽位时仍读取已保存值；来源覆盖和功能需求校验保留。

The draft omits five duplicate context editors and retains questionnaire facts. Stored
manual text remains intact. Default PRDs omit the corresponding prose slots and do not
append them as fallback sections. Summary is no longer required for brief confirmation.

## 2026-11-04: Per-function AI description expansion

初稿每个功能说明旁新增“AI 扩写功能说明”。点击时先保存当前草稿，后台固定此功能的
ID、简述、现有说明及评估修订；只将该功能内容提交已配置 OpenRouter，使用专用
`narrative_refinement:function_expansion` 管理员提示词。任务使用已有持久化队列、预算、
配置快照、重试和来源哈希校验，job.kind 使用短哈希适配现有 40 字符列，无迁移。
普通编辑和打开页面不调用模型，本地规则模式不支持冒充 AI 扩写。
建议明确标为 AI 待确认，澄清问题单列，只有显式采纳才替换目标功能说明；简述、其他功能和
问卷答案不变。生成期间修改简述/说明、删除功能或修订评估会使旧建议不可覆盖新内容。
可撤销本次采纳；继续人工修改说明后不能用撤销覆盖修改。所有验证使用离线模型替身。

Each function has an explicit AI expansion action. Only that saved function brief and
existing description are sent. Suggestions require review and acceptance, support undo,
and cannot overwrite changed source text. Existing jobs, model budgets, permissions and
configuration snapshots remain in force. No database migration or runtime-data reset.

## 2026-11-04: Dedicated grading-result workflow node

客户侧评估导航在“系统定级”后增加“定级结果”，后续节点顺延。等级确认后启用，
`/systems/{id}/grade-result` 展示 classification.assessment 的已确认快照，复用等级、
影响矩阵、内部下限及待复核展示；不调用预览、确认、保存或模型接口。
页面的返回问卷与审查应用说明入口只导航。未确认结果显示空态；历史仅有等级而无详细结果时
说明缺少历史计算快照，不以现行规则擅自补算。供应商工作流不显示该客户节点。

A dedicated Grade result node follows System grading in customer workflows. It reads the
confirmed snapshot without recalculation or mutations. Legacy records without a detailed
snapshot show an explicit explanation. Existing permission and organization checks apply.

功能 AI 扩写允许在 CONTROL_REVIEW 和 PRD_REVIEW 阶段运行，独立于整份应用说明的重新整理权限。
任务只生成建议；确认内容与已有 PRD 保持原状，需采纳并重新确认应用说明才更新下游。
Per-function expansion remains available during control and PRD review. Suggestions do not
silently revise the confirmed context or published PRD.

## 2026-11-04: Evidence-card question and answer layout

定级结果和问卷预览的所有分级依据卡片统一为：粗体主标题展示完整问题，
滑动条上方同一行展示已选答案与对应等级。内部规则卡片和 E09/E10 影响矩阵卡片同步适用；
数据数量/容量卡片附具体分项，未知与无定级贡献仍分开显示。仅修改展示，不改变计算或快照。

All grading evidence cards show the full question as their bold heading and pair the
selected answer with its computed grade above the scale. Numeric rules and confirmed
snapshots are unchanged; unknown and no-contribution states remain distinct.
# PRD network topology images (2026-11-04)

The application brief shows PNG/JPEG/WebP evidence uploaded for B07 (`network_zones_description`) under **系统开发架构 / System development architecture → 网络拓扑图 / Network topology diagram**. The manifest uses persisted evidence for the assessment, including uploads whose questionnaire note reference has not yet been saved. No duplicate upload or database migration is required. Non-image attachments remain downloadable evidence and are not embedded as diagrams.

Image endpoints enforce the existing customer organization and assessment access boundaries; supplier users cannot browse raw questionnaire attachments. PRD jobs pin image IDs, filenames, MIME types and SHA-256 values in the source snapshot. Image bytes are excluded from model transport and are hydrated only on successful publication after revision/source checks. New PRD documents and manual revisions embed the original raster bytes as data URLs, so the authorized supplier document and Markdown download preserve the same topology. Existing immutable PRDs and baseline hashes are not rewritten. Legacy pinned templates without the new slot receive the diagram inside their architecture section, or an architecture section is appended.

The preview permits embedded PNG/JPEG/WebP only; remote images, SVG, raw HTML and unsafe links remain blocked. Regression coverage verifies image scope, original-byte embedding, source staleness, supplier document access, historical PRD immutability and both draft/formal image rendering.

## 2026-11-04: Grade-first questionnaire

评估问卷先进入“优先定级”：集中独立定级条件、对接等级、网络入口、交易/公共服务/业务重要性、数据类别及条件明细、人数、数据规模与分类、跨境、外部影响、安全影响和两组影响矩阵。保留原题号、答案键、理由及历史记录；其余 A–E 章节不重复这些问题。

先保存草稿并计算初步等级，查看依据后继续填写其余问题。早期计算使用同一规则引擎，仅将后续非定级信息的必填检查留到完整问卷校验；缺失定级输入、未知影响、理由缺失和专业复核仍阻止采用完整初步建议。早期计算不创建已确认等级、应用说明或控制选择。完整问卷仍通过原确认接口重新计算与校验，随后审查应用说明，确认后按等级匹配控制项；默认自动选择对应等级参考库。修改已确认答案继续触发原有修订和下游失效机制。

The questionnaire starts with Grade first, preserving original question IDs, authored text and conditional details. A shared grading-field contract drives the first section and a separate early rule preview. Remaining sections omit those questions. Full validation and revision checks still gate final confirmation; controls are matched by grade after brief confirmation. No migration or runtime-data reset is required.

2026-11-04 工作流更正：新建系统使用九个独立阶段：系统定级、定级结果、系统信息收集、安全控制匹配、PRD复核及下发、供应商复核、影响评估、双方确认、开发进度追踪。定级题仅在第一阶段，剩余问卷和应用说明确认属于第三阶段。早期结果保留为草稿计算，完整问卷确认仍经过服务端校验。
New-system workflows expose nine separate stages. Grading inputs and remaining information use distinct routes; full server validation still precedes control matching.

定级页面使用独立 G01–G15 展示编号，保存键及历史来源不变。Demo 仅填充当前页面/章节及其条件子题，保留其他章节答案、说明及联系人；撤销同样仅恢复本次填入的字段。结果页不提供 Demo 填入。进度按当前阶段统计。
Grading uses independent G-prefixed display numbers. Demo fill and undo are scoped to the current page and its conditional children; other pages remain intact.

## Deployment-based MLPS domains (2026-11-04)

六字段新发布为安全物理环境和云计算安全扩展要求添加互斥适用规则。问卷 deployment_model 中任一专有云、公有云、混合云、SaaS 优先归为云，即使同时选择本地部署：纳入同级全部云扩展条目，排除同级物理环境条目。明确本地数据中心、托管机房、门店或仓库部署时反向匹配；缺失、其他、不确定保留待确认，不静默排除。其他域及 risk_level 规则保持不变。

Derived hosting.models facts and rule answer references are pinned with classification and control snapshots. New releases apply the domain switch across levels 1–3. Historical releases remain unchanged; existing assessments explicitly load the latest catalog and reconfirm information. Named source replacement preserves raw uploads and immutable releases, rejects omitted controls or cross-file identity collisions, and updates only the authorized organization.

2026-11-04 Demo 范围更正：系统信息收集的 Demo 一次填入并保存 A–E 五维度全部非定级题及联系人；不再仅填当前章节。不改变定级答案、理由与参考库选择，不自动确认信息或匹配控制。撤销恢复并保存本次填入前的信息，失败时保留未保存提示。
Information-stage Demo fills and saves all five dimensions, preserving grading inputs and the current chapter. Undo also saves the restored draft.

2026-11-04：移除应用说明/PRD 初稿中间页面。系统信息确认通过 information-confirmations 在同一事务内校验完整问卷、确认等级、从问卷建立可追溯 ContextRevision 并匹配控制，失败整体回滚。完成后直接进入控制匹配，确认控制范围后生成完整 PRD，沿用现有复核及下发权限。历史 brief 链接重定向至信息收集或控制页，不自动写入。
Information confirmation atomically validates questionnaire facts, creates the context revision and matches controls. No intermediate brief page remains; control scope confirmation generates the full PRD for review and dispatch.

系统信息收集的展示编号按可见主问题在 A–E 各章连续编号，当前 Demo 为 7+6+2+3+6=24 题；定级 G01–G15 独立统计。条件子题计入所属主问题的完成状态，不另占主问题数。历史答案键及来源编号保持不变。
Information display numbering is consecutive within each section; progress counts visible main questions only.

控制匹配页展示所选参考等级原始条目、已纳入、豁免、待确认统计与逐条豁免原因；统计使用完整评估快照，不随分页/筛选变化。其他等级不算豁免，额外纳入单列，未知候选不算已豁免。云/非云规则原因与人工理由分别展示，豁免不替代后续例外审批。

控制匹配统计的“豁免原因”入口紧邻豁免条目指标，每条排除控制卡片在标题旁直接显示原因，不再要求展开匹配依据；其他等级排除明确说明不计入豁免。

2026-11-04 控制适用性补充：信息收集新增软件开发/交付方式（多选）、外包运维、实体介质、介质运输、机房管理责任（含云商取证）、现场访客六题，不参与等级计算。Demo 信息题为30、定级题仍15。六字段新发布按来源编号固定匹配自行/外包开发、外包运维、介质存放/运输、机房管理与物理访客控制；unknown 留作候选，只有明确不涉及才自动排除。保留云扩展、备份与通用安全条目，不按控制域泛化删除。匹配快照保留规则、答案及来源，界面展示具体理由；修改问卷沿用修订失效机制，旧评估显式加载新控制库后确认信息。
Six scope questions drive versioned control applicability without affecting grading. Unknown answers remain candidates. Mixed development modes retain both sets; outsourced assurance is not a blanket exemption.

控制匹配页面支持卡片与按控制域分组的横条视图切换，偏好保存在当前浏览器。两者复用同一页数据、筛选和选择状态；分组数量明确标为本页，不冒充全库数量。


## 2026-11-04：供应商 PRD 答复至交付验收

当前行为以 [供应商协同与 AI 交付说明](supplier-prd-delivery.md) 为准：PRD 原文下直接勾选可完成性、填写部分/无法完成原因；
来源 High 保持原等级，依据固定系统事实进行 AI 情境分析，低/中残余风险也须客户人工审查接受。
这替代早期按 no 永久判 High 失败及所有模型严重度强制覆盖的实现。
独立双签同一 hash 后可下载最终 Markdown 稿；开发项按已承诺的 PRD requirement 追踪，附件提交后自动
启动有配置的 AI 逐项评估，保留独立人工验收、来源校验、版本隔离和不可变证据。原运行数据不重置。

English: inline supplier PRD responses, evidence-bound contextual impact assessment, jointly confirmed
final export, and per-requirement delivery AI are implemented. AI does not approve on behalf of either party.


## 2026-11-04：PRD v3 阅读与填写

默认 PRD 改为九章正文与可折叠附录，安全开发需求只按域展示控制内容；验收、项目实施说明与来源移至附录。联系人、数据范围与恢复目标使用可读格式；逐项编辑支持搜索和折叠。已有草稿可应用当前模板保存未批准新修订，保留需求 JSON、来源、生成方式与旧稿。无需迁移或重置数据。详见 [模板说明](prd-template-review.md)。

English: PRD v3 groups control-only security content by domain and separates acceptance/provenance appendices. Applying a template creates an unapproved revision, preserving history, references, generation mode and approval boundaries.


## 2026-11-05：控制域分页数量说明

控制审查先按接口分页（每页最多 100 条），再按当前页进行选择状态过滤和域分组。横条域标题分别显示“本页显示”与“本域已选总数”，说明文案指引使用左侧域筛选集中查看；跨页已选数量始终来自评估完整控制范围。此次仅澄清统计口径，不修改控制选择、匹配、分页或 PRD 覆盖。

Control domain rows now distinguish visible page counts from total selected counts across pages, with guidance to use the domain filter. Selection, matching and PRD coverage remain unchanged.


## 2026-11-05：移除问卷附加材料

已上传材料的下载链接旁增加“移除”，仅编辑者可用。移除立即保存，通过 system version、组织和评估归属检查，记录 evidence_id 审计；从当前问卷答案/备注取消引用，并排除后续拓扑快照与 PRD 生成。其他未保存的文字仍保留在编辑器，继续使用原保存流程。

采用逻辑移除，文件内容、历史问卷快照、旧 PRD 和基线保持不变；已确认的信息沿用修订失效流程，必须重新确认。重试有幂等保护，过期版本不会移除。被移除 ID 不能通过旧答案重新引用，需要重新上传。无需数据库迁移或运行数据重置。

`POST /systems/{id}/mlps-intake/evidence-removals` 接收 `version`、`evidence_id`；移除 ID 保存在系统 draft 的 `removed_mlps_evidence`，历史下载仍受原组织与评估权限控制。

English: Editors can detach uploaded evidence from the current questionnaire and future PRDs. Files and immutable history remain available; confirmed facts require revision and reconfirmation. Unsaved authored text survives removal and conflict responses. Version checks, authorization, audit and idempotency remain mandatory.


## 2026-11-05：区分控制不适用与人工豁免

控制匹配统计新增“不适用”及独立原因列表。已确认条件经规则判定不适用、且没有人工排除理由的条目归入不适用；人工填写原因的排除归入豁免，仍需例外审查。未知适用条件以及需重新确认的候选保持待确认。原始条目 = 已纳入 + 不适用 + 豁免 + 待确认；跨等级、非固定控制库与额外自定义条目沿用原统计边界。

明确非云部署时云计算安全扩展要求归入不适用；云部署时自动排除的物理环境要求也采用相同口径。缺失、其他或不确定的部署不因未勾选云而自动判定不适用。匹配算法及控制范围没有更改，原有来源、版本和审批记录保留。统计卡片桌面五列、小屏换行，中英文文案同步。

English: Counts now separate rule-based non-applicability from manually reasoned exemptions. Non-cloud deployment makes cloud extensions not applicable; unknown deployment remains pending. Counts retain pinned-catalog/reference-level boundaries and do not alter selection or approval records.


## 2026-11-05：控制域紧凑表格

“控制域·横条”改为“控制域·表格”，每个域展示编码、控制点、要求、高风险四列。正文不再堆叠卡片；测评方法、预期证据、排除理由、原始内部编号和匹配依据默认折叠。选择按钮留在编码列，沿用原排除原因与权限流程。MLPS 显示编号来自固定 source_level 与 source_ref；高风险依据原始中文 risk_level=High，不能用必选、等级或翻译推断。域标题保留本页和跨页已选口径，窄屏可横向滚动。

English: Domain tables replace tall domain-row cards. Four columns show source code, control point, requirement and source High risk. Evidence and rationale are collapsed; selection, pending actions, permissions and pagination remain intact. Card view remains available. The earlier 760px row cap does not apply to the four-column table.


## 2026-11-05：完整控制域与折叠

控制域表格读取当前固定控制库查询的所有分页，全部成功后再应用已选/已排除筛选并分域展示。同一控制域不再跨页拆分，标题数量是当前搜索和状态筛选后的完整结果数；右侧仍为本域已选总数。加载期间显示状态，任一分页失败不展示不完整的域。卡片视图保留分页和当前页筛选。

域标题为支持键盘的展开/折叠按钮，默认展开，包含 aria-expanded 与内容关联。折叠仅隐藏表格，不改变控制选择、理由或评估版本，中英文切换保留原文。离线回归覆盖 126 条跨页数据中分散的 29 条云控制、已选/排除筛选及折叠还原。

English: Domain tables load every page of the pinned catalog query before selection filtering and grouping. Domains are complete and independently collapsible; headings count all filtered matches. Card pagination remains available. Collapsing is presentation-only and preserves selections and authored evidence.


## 2026-11-05：风险等级标签与默认筛选

控制域表格列名改为“风险等级”。固定控制库来源 risk_level 的 High 显示浅红底深红字“高风险”椭圆标签，Medium 显示浅橘底橘字“中风险”；英文对应 High risk / Medium risk。其他来源值沿用横线展示，不推断风险。进入控制审查默认选择“已选条目”，仍可切换全部或已排除，筛选不修改已选控制。

English: The risk-level column displays red High risk and orange Medium risk pills from pinned source metadata. Control review initially filters to selected controls; selection data remains unchanged.

2026-11-05：移除控制域表格工具栏下的折叠操作提示（中英文），保留标题折叠交互。 Removed the explanatory hint below the domain-table toolbar in both languages; heading toggles remain available.


## 2026-11-05：通用物理控制与云扩展的分类更正

本节取代此前将云部署下物理环境排除归入“不适用”的统计口径。安全物理环境属于通用控制：固定来源域为安全物理环境，且匹配快照确认 cloud/saas、hosting.models 规则未匹配时，归入“部署规则豁免”。明确非云部署时排除的云计算安全扩展要求仍归入“不适用”。人工原因优先保留为人工豁免；候选、未知条件、范围外条目不冒充部署豁免。统计、原因表和卡片/表格中的原因标签采用同一判断。

这是对已有匹配快照的展示分类，未改写适用规则、历史控制选择、PRD、来源版本或审批要求。离线回归覆盖 cloud、saas、混合部署、非云部署、未知/候选、跨等级及人工原因。

English: General physical-environment controls excluded by confirmed cloud deployment are deployment-rule exemptions, while cloud extensions excluded for non-cloud deployment remain not applicable. Manual reasons and pending/reference boundaries are preserved. This reporting correction uses pinned source and match evidence without rewriting historical decisions or baselines.


## 2026-11-05：控制项豁免机制说明页

规则导航新增 `/control-exemptions`，以当前系统信息收集的显示题号解释 7 个问题、9 条条件分支：B02 部署方式、A08 开发方式、B07–B11 运维及实体范围。说明条件、受影响控制、参考等级/条款和豁免或不适用结果，支持按等级与题号/活动/条款搜索，中英文同步。页面是当前应用规则说明；历史评估仍以已固定控制库为准，不修改匹配、授权或历史快照。

文案数据在 `frontend/src/control-exemption-guide.json`，组件为 `ControlExemptionGuide.tsx`。更新问卷、编号或适用规则时需同步该清单。离线 `test_control_exemption_guide.py` 将题目、选项和显示编号与问卷核对，再在隔离数据库发布 L1–L3 控制库，使用实际发布规则验证每个说明样例、不适用条件、保留条件及未知结果。前端回归验证等级筛选、条款展开、搜索与语言切换。

English: Rules navigation now includes Control exemption rules, explaining seven questionnaire inputs and nine branches with affected clauses, level filters and search. Offline regression checks the guide against questionnaire IDs and actual published rules; the page does not change assessment state.


## 2026-11-05：通用控制统一采用豁免口径

本节更正此前开发/运维范围排除标为不适用的说明。确认不涉及自行开发、外包开发、外包运维、实体介质管理/运输、机房管理或外部人员物理访问时，对应通用控制计入“范围规则豁免”。云部署下的物理环境控制仍为“部署规则豁免”；明确非云部署下的云扩展保持“不适用”。人工理由优先、未知/待确认、参考等级及固定控制库边界保持不变。

统计、原因表、卡片与表格理由共享判断，控制项豁免机制清单及中英文说明同步更新。判定使用已固定的匹配事实及规则，不修改规则引擎的 applicable/inapplicable 技术状态、不重算历史选择或基线。回归覆盖两类开发与五类运维范围、未知/缺失答案、人工原因及不同结果分类。

English: Confirmed out-of-scope general development and operations controls now count as scope-rule exemptions. Cloud-related physical controls remain deployment exemptions; non-cloud cloud extensions remain not applicable. Statistics and the guide use the same reporting terminology without rewriting pinned matches or history.


## 2026-11-05：豁免与不适用原因表展示来源原文

原因表用 Source、Identifier 替换内部条目编号，新增完整控制项原文列。内容读取已固定控制快照的来源字段，缺失时逐字段回退到来源条款或历史作者原文；切换中英文仅改变界面文案，不翻译或截断来源原文。缺失来源或标识明确显示未提供，不生成替代编号。

统计下增加部署规则、范围规则、人工排除的豁免数量分解。沿用当前分类：云部署下通用物理控制为部署规则豁免，不涉及开发/运维活动为范围规则豁免；非云部署下云扩展为不适用。未改写匹配规则、控制选择、历史来源或确认基线。当前云部署示例的20条豁免由15条物理环境和5条活动范围构成，29条云扩展已纳入，因此不适用为0。

English: Reason tables show source, identifier and complete pinned original requirements, preserving authored language and line breaks. Exemption counts now explain deployment-rule, scope-rule and manual components. Existing classification, selections and immutable history remain unchanged.


## 2026-11-05：供应商复核简化与按域分组

供应商端移除重复的 PRD 复核及下发导航，旧 PRD 路由转向供应商复核；客户九阶段及审批下发保留。答复列表按本轮固定控制来源域分组，支持搜索、域/状态筛选、分组折叠及完成/未填写计数。默认收起例外及验收输入；勾选可完成即可提交该项答复，异常项须说明原因，可补充补偿措施与工作日。原有方案、负责人、日期和历史承诺保留，工期范围与日期关系仍校验。

服务端 SupplierAnswer 与前端完整性同步；批量填入保护所有已有答复，包括无方案文本的已勾选项。本地影响预审在无实施方案时引用可追溯的 implementation_status，不制造证据，不自动批准风险。prd.requirement_domains 从本轮快照中的控制映射来源域，仅新增展示信息，不修改 PRD 内容/hash，不暴露客户全量控制。沿用版本、组织隔离、不可变提交及独立双方确认。无需迁移或重置运行数据。

English: Supplier navigation, compact domain grouping and checkbox-only commitments are implemented. Exceptions still require explanations and owner review. Pinned domain labels, historical text, version checks and immutable same-hash confirmations are preserved. See docs/supplier-prd-delivery.md for the current contract.

供应商答复的控制域改为左侧导航，按本轮 PRD 统计完成数/总数和高风险数量，支持与搜索、答复状态及“只看高风险”组合筛选。`prd.high_risk_requirements` 从供应商轮次固定控制快照推导，与来源风险审查共用 `high_source_controls`，按 CONTROL-SIX/1 中文原始 risk_level=High 标记；多来源需求任一来源高风险即标记，缺失值不推断。可完成答复不会清除来源风险标记。

供应商“一键填入 Demo”包含三项固定演示例外：远程管理鉴别信息保护为无法完成（20 个工作日用于方案评估验证）；防恶意代码软件与库更新为需要澄清（5 个工作日）；外部人员书面审批、开户及备案为需要澄清（3 个工作日）。按中文来源条款内容匹配，不依赖生成的 REQ 编号；英文界面填入对应英文样例，切换语言不会改写已有答复。样例显式标记为演示，含原因、补偿措施和计划，仍需负责人判断；仅填入/保存草稿，不自动提交或确认。其余需求保留原 Demo 可完成策略，撤销恢复填入前全部答复。

供应商需求域导航红圈统一表示“需关注项”：无法完成的全部需求，以及来源高风险且尚未承诺可完成的需求（部分完成、需要澄清、未填写）。计数、条目浅红背景和红色侧边、需关注筛选复用 answerNeedsAttention，按需求去重；已填写说明不表示高风险已解决。全部域显示分类总数，单域显示域总数，不受筛选影响。可完成的高风险项保留来源高风险标记及数量，但不计入红圈；答复状态直接显示部分完成/需要澄清/无法完成，不再把已填完的例外显示为绿色。答复完整度与交付可完成性独立。
