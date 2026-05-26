# Data Model

Durable storage contract for Forge's local JSON store and Supabase tables. Prefer boring records that make product context, opportunity ranking, builder behavior, and Forge self-improvement auditable.

The dashboard currently uses this model through `apps/dashboard/lib/db/repository.ts`. Local development writes a compatible JSON shape to `.forge-data/store.json`; hosted runs use Supabase migrations in `supabase/migrations`. Set `FORGE_STORAGE_BACKEND=local` to force the JSON store for isolated fixtures or rendered checks even when `.env.local` contains Supabase credentials.

When adding status values, metadata payloads, or artifact types, update this file, TypeScript DB types, and Supabase migrations together.

## projects

Stores the product workspace Forge is helping create or iterate on.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `owner_user_id` | text | Owner user reference; local dev defaults to `local-user` |
| `workspace_id` | text | Workspace reference; local dev defaults to `local-workspace` |
| `name` | text | Product or project name |
| `mode` | text | `connected_product`, `new_product` |
| `stage` | text | `idea`, `prototype`, `launched`, `internal` |
| `description` | text | Product context summary |
| `repo_url` | text | Existing product repo when connected |
| `product_url` | text | Live product or marketing site when available |
| `target_users` | text[] | Target users or buyers |
| `context` | jsonb | Product positioning, constraints, competitors, roadmap notes |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## users, workspaces, workspace_members, user_auth_identities

Stores the first ownership boundary for user-scoped projects and future auth.

| Table | Notes |
| --- | --- |
| `users` | Server-side user identity. Local dev creates a configurable `FORGE_USER_ID` user. |
| `workspaces` | Project container owned by a user. Local dev creates `FORGE_WORKSPACE_ID`. |
| `workspace_members` | Membership and role records for workspace-scoped access. |
| `user_auth_identities` | Mapping from hosted auth provider subjects to durable Forge `users.id` values. |

This is a contract layer around Supabase Auth, not a custom password provider. Hosted dashboard requests can derive the active subject by validating an `Authorization` bearer token, a configured `FORGE_AUTH_BEARER_COOKIE`, Forge's built-in `forge_supabase_access_token` cookie, or standard `sb-*-auth-token` cookies against Supabase Auth `/auth/v1/user`. The built-in `/signup` and `/login` email magic-link flow requests account links through Supabase Auth and validates the returned access token before setting Forge's httpOnly access and refresh cookies. GitHub account data is stored only as connector metadata after the Forge email account exists. Private beta deployments can configure `FORGE_ALLOWED_EMAILS` or `FORGE_ALLOWED_EMAIL_DOMAINS`; non-invited emails cannot receive Forge magic links, and validated Supabase tokens for non-invited emails do not become Forge request sessions. If cookie access validation later fails or the access cookie has expired out of the browser jar, the request-session bridge can use the refresh token to obtain and validate a fresh access token for that request. Hosted deployments should set `FORGE_REQUIRE_AUTH=1` so unauthenticated dashboard routes redirect before fallback local identity can load project data; direct data-layer identity fallback is also rejected unless `FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED=1` is set for a trusted background job. When Supabase is configured and explicit `FORGE_USER_ID` / `FORGE_WORKSPACE_ID` values are absent, the dashboard resolves that request subject or `FORGE_AUTH_SUBJECT` through `user_auth_identities` and derives the workspace from membership or owned-workspace records. If a signed-in hosted user has no mapping yet, the first write provisions a default `users`, `workspaces`, `workspace_members`, and `user_auth_identities` set. Local dev can set `FORGE_AUTH_SUBJECT`, otherwise it maps the active user id to itself.

Dashboard reads are scoped through the active `FORGE_USER_ID` and `FORGE_WORKSPACE_ID`: project lists, direct project bundles, and scheduler summaries only surface rows in the active workspace/user boundary. Hosted Supabase bulk reads first query projects by the active owner/workspace, then fetch project-owned child tables by those project ids instead of loading all opportunity/build/reflection rows into memory. When Supabase is configured, an empty hosted workspace stays empty rather than falling back to `.forge-data`. Legacy local rows with no ownership fields remain visible only in local JSON mode so older fixture data still loads during development.

`github_user_tokens` is intentionally excluded from generic store loads and project bundles. OAuth token rows are scoped by owner and are fetched only through the explicit server-side connection token lookup path.

Hosted Supabase applies the same ownership boundary through `0009_workspace_rls_contract.sql` and `0010_auth_subject_identity_mapping.sql`. Those migrations define `forge_current_auth_subject`, `forge_current_user_id`, `forge_can_access_workspace`, and `forge_can_access_project`, then enable row-level security for project-owned runtime tables. Service-role server writes continue to work, while future browser/realtime access can use authenticated JWT subjects mapped to stable Forge user ids.

## github_connections

Stores GitHub App/OAuth account metadata without storing browser-exposed tokens. The same account may have both a
GitHub App installation connection and a GitHub OAuth connection because those grant different capabilities; uniqueness is
scoped by `(owner_user_id, provider, account_login)`, not only by account login.

Signed GitHub App installation webhooks update this table by `installation_id`: installation deletion marks matching rows `revoked`, suspension marks them `needs_reauth`, and creation/unsuspension/new-permission acceptance marks them `active`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key |
| `owner_user_id` | text | References `users.id` |
| `workspace_id` | text | Optional workspace scope |
| `provider` | text | `github_app` or `github_oauth` |
| `account_login` | text | User or organization login |
| `account_type` | text | `User` or `Organization` when known |
| `installation_id` | text | GitHub App installation id when using the App flow |
| `scopes` | text[] | OAuth/App permissions summary, not a token |
| `status` | text | `active`, `revoked`, `needs_reauth` |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## github_user_tokens

Stores server-side GitHub App user access tokens for user-account generated repo creation and refresh. These rows are never sent to the browser. Hosted Supabase writes require `FORGE_TOKEN_ENCRYPTION_KEY`; local development may keep plaintext-compatible rows for easier fixture work. RLS requires both `owner_user_id` and the referenced `github_connections` row to belong to the current Forge user.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key |
| `connection_id` | text | References `github_connections.id` |
| `owner_user_id` | text | User that owns the token |
| `access_token` | text | Server-side only access token, encrypted when `FORGE_TOKEN_ENCRYPTION_KEY` is configured |
| `token_type` | text | Usually `bearer` |
| `expires_at` | timestamptz | Access-token expiry |
| `refresh_token` | text | Server-side only refresh token, encrypted when `FORGE_TOKEN_ENCRYPTION_KEY` is configured |
| `refresh_token_expires_at` | timestamptz | Refresh-token expiry |
| `scopes` | text[] | Granted OAuth scopes |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## source_configs

Stores configured inputs for a project.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `connection_id` | text | Optional reference to `github_connections.id` for GitHub sources. Writes must use a connection owned by the active user, in the active project workspace, or already linked to the project. |
| `source_type` | text | `manual`, `feedback_form`, `github`, `github_generated_repo_target`, `hacker_news`, `reddit`, `web_search`, `social_search`, `competitor`, etc. |
| `name` | text | Human-readable source label |
| `config` | jsonb | Query terms, repo URLs, competitor URLs, channels, rate-limit settings |
| `status` | text | `active`, `paused`, `error` |
| `last_checked_at` | timestamptz | Last source scan |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

GitHub sources with `config.needs_connection = true` and no `connection_id` are setup placeholders, not runnable sources. Generic project-settings writes keep them `paused`; only the GitHub connection and repo-picker paths should link a scoped connection and make the source active.

`github_generated_repo_target` is not an ingestion source. It records the project-scoped GitHub connection that should own generated MVP repos for new-product builds. Organization installations can create the generated repo with an installation token when the App has Administration write permission; user-account targets use GitHub App user OAuth. `config.repo_creation` records `github_app_org_create`, `github_oauth_user_create`, or `precreated_only` so build/debug surfaces do not flatten those capabilities. `FORGE_GITHUB_TOKEN`/`GITHUB_TOKEN` is a local-dev fallback only when `FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1` and is ignored when `FORGE_REQUIRE_AUTH=1`; manual installation-id entry is available only when `FORGE_ENABLE_GITHUB_DEV_FALLBACK=1`.

## triggers

Stores rules for manual, scheduled, and signal-driven Forge runs.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `name` | text | Human-readable trigger name |
| `trigger_type` | text | `manual`, `schedule`, `volume_spike`, `sentiment_shift`, `competitor_change`, `release_followup` |
| `config` | jsonb | Schedule, thresholds, source filters, autonomy mode |
| `status` | text | `active`, `paused`, `disabled` |
| `last_run_at` | timestamptz | Last trigger fire |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## user_preferences

Stores the explicit preference profile used by the product and reflection loops.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `user_id` | uuid | Future auth user reference; nullable for single-user v1 |
| `preferred_markets` | text[] | Markets or domains to favor |
| `preferred_buyers` | text[] | Buyer/user types to favor |
| `excluded_categories` | text[] | Categories the user does not want |
| `risk_tolerance` | text | `low`, `medium`, `high` |
| `stack_preferences` | text[] | Optional; builder may ignore if opportunity calls for another stack |
| `notes` | text | Freeform taste and constraints |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## preference_events

Stores behavior signals used to adjust future ranking.

Review actions also mirror the current opportunity lifecycle status in both local JSON and Supabase storage when `opportunity_id` is present: `approved` -> `building`, `rejected` -> `rejected`, `ignored` -> `watching`, and `feedback` -> `researching`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `user_preference_id` | uuid | References `user_preferences.id` |
| `event_type` | text | `approved`, `rejected`, `edited`, `launched`, `feedback`, `ignored`, `prototype_opened`, `prototype_selected`, `build_failed`, `reflection_accepted` |
| `opportunity_id` | uuid | References `opportunities.id` when applicable |
| `mvp_build_id` | uuid | References `mvp_builds.id` when applicable |
| `payload` | jsonb | Event details |
| `created_at` | timestamptz | Created timestamp |

## pipeline_runs

Tracks each product discovery, research, review, build, or reflection pipeline execution.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `research_brief_id` | text | Optional reference to `research_briefs.id` for brief-launched runs |
| `trigger_id` | uuid | References `triggers.id` when applicable |
| `run_type` | text | `scan`, `research`, `ranking`, `review`, `build`, `reflection`, `fixture`, `managed`, `discovery` |
| `status` | text | `queued`, `pending`, `running`, `in_progress`, `completed`, `failed` depending on local/Supabase compatibility |
| `trigger` | text | `manual`, `scheduled`, `schedule`, `onboarding`, `managed_agent`, `signal`, `fixture`, `remote` depending on local/Supabase compatibility |
| `started_at` | timestamptz | Run start |
| `completed_at` | timestamptz | Run end |
| `error` | text | Failure summary |
| `metadata` | jsonb | Runtime details |

Approved AI intake briefs create a queued run before managed research starts. The run metadata includes
`source = "research_brief"`, `research_brief_id`, and `queued_for = "pipeline_worker"`. A secured worker transitions the
run to `running`, updates agent task rows, then completes or fails the run.

Completed brief-research run metadata stores the managed research response under `metadata.managed_research`. When present,
`metadata.managed_research.evidence_summary` records candidate counts, build-ready counts, needs-more-evidence counts, and
short reasons so the dashboard can explain why an approved brief produced build-ready candidates or requires more source
collection before build.
`metadata.managed_research.opportunity_count` counts all managed research candidates returned by the service.
`metadata.managed_research.promoted_opportunity_count` counts candidates actually written to `opportunities`.
`metadata.managed_research.unpromoted_opportunities` may preserve thin candidate titles, evidence-gate reasons, and
DecisionAgent recommendations for audit without surfacing them as recommendation cards.
`metadata.managed_research.source_plan`, `source_plan_routing`, and `media_sources` preserve the approved brief's source
plan, the collectors/targets it routed to, and the counts of collected public media by source so the dashboard can show
what the AI/user conversation actually sent agents to inspect.

## idea_conversations and idea_messages

Stores the AI-led product conversation that guides new-product research without using a hardcoded questionnaire.

| Table | Notes |
| --- | --- |
| `idea_conversations` | Project/user-scoped thread with `active`, `brief_ready`, `researching`, or `closed` status. |
| `idea_messages` | User, assistant, and system messages plus optional compiler metadata. |

The conversation is intake and steering. The durable product artifact is the compiled `research_briefs` row. Conversation status follows the latest brief lifecycle: `needs_context` keeps it `active`, `ready_for_research` marks it `brief_ready`, `approved`/`running` marks it `researching`, and `completed` closes it.

## research_briefs

Stores the structured brief compiled from the AI/user conversation and approved before research agents run.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key |
| `project_id` | uuid | References `projects.id` |
| `conversation_id` | text | Optional reference to `idea_conversations.id` |
| `status` | text | `needs_context`, `ready_for_research`, `approved`, `running`, `completed` |
| `hypothesis` | text | Testable product hypothesis |
| `target_users` | text[] | Specific users to research |
| `pain_area` | text | Pain area to investigate |
| `constraints` | text[] | User and Forge build constraints |
| `source_plan` | text[] | Source/search plan for research agents |
| `disqualifying_evidence` | text[] | Evidence that should stop or downrank the idea |
| `mvp_boundaries` | text[] | Allowed v1 scope and non-goals |
| `user_taste_notes` | text[] | Taste/preferences inferred from the conversation |
| `open_questions` | text[] | Remaining unknowns |
| `confidence` | numeric | Compiler confidence |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## agent_tasks

Stores planned or completed agent work launched from a project run or research brief.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key |
| `project_id` | uuid | References `projects.id` |
| `pipeline_run_id` | uuid | Optional run reference |
| `research_brief_id` | text | Optional brief reference |
| `agent_role` | text | `SourceCollector`, `Researcher`, `TasteCritic`, `BullAgent`, `BearAgent`, `DecisionAgent`, etc. |
| `status` | text | `queued`, `running`, `completed`, `failed` |
| `prompt` | text | Task prompt or brief excerpt |
| `result` | jsonb | Validated task output |
| `error` | text | Failure summary |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## signals

Stores raw and normalized source evidence or manual ideas.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `source_config_id` | uuid | References `source_configs.id` when applicable |
| `source` | text | `manual`, `hacker_news`, `reddit`, etc. |
| `source_id` | text | Source-native ID when available |
| `url` | text | Canonical source URL |
| `title` | text | Source title or manual idea title |
| `body` | text | Extracted text when allowed |
| `author` | text | Public author handle when available |
| `published_at` | timestamptz | Source timestamp |
| `captured_at` | timestamptz | Ingestion timestamp |
| `tags` | text[] | Normalized tags |
| `metadata` | jsonb | Source-specific details |

## research_digests

Stores bounded research summaries from Deep Research or other research agents.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `topic` | text | Research question or market area |
| `summary` | text | Human-readable research digest |
| `citations` | jsonb | Source URLs, titles, timestamps, and snippets when allowed |
| `findings` | jsonb | Structured claims, trends, sentiment notes, competitors, gaps |
| `created_at` | timestamptz | Created timestamp |

## opportunities

Stores normalized product opportunities that can be approved for build.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `title` | text | Opportunity title |
| `problem` | text | Problem statement |
| `target_user` | text | Primary user or buyer |
| `mvp_concept` | text | Candidate MVP shape |
| `score` | numeric | Overall ranking score |
| `score_rationale` | text | Why it scored this way |
| `status` | text | `proposed`, `watching`, `researching`, `approved`, `rejected`, `prototyping`, `building`, `built`, `archived` |
| `profile` | jsonb | Structured opportunity data |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

`profile.evidence_state` should be preserved when present. `brief_only` means a user-approved AI intake hypothesis without market evidence; `source_collected` means public-source records are linked; `repo_evidence` means repository evidence drove the card. The dashboard labels these states separately. Build readiness is stricter than the label: source-collected market opportunities need at least two linked signals plus one cited URL, while repo-evidence opportunities need at least one linked repo signal.

## opportunity_signals

Join table for opportunity evidence.

| Column | Type | Notes |
| --- | --- | --- |
| `opportunity_id` | uuid | References `opportunities.id` |
| `signal_id` | uuid | References `signals.id` |
| `relevance` | numeric | Optional relevance score |
| `notes` | text | Why this signal matters |

## opportunity_evaluations

Stores critique and ranking evidence for opportunities.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `opportunity_id` | uuid | References `opportunities.id` |
| `evaluator` | text | `taste_critic`, `bull`, `bear`, `decision_agent`, `preference_modeler`, `build_reviewer`, etc. |
| `content` | text | Human-readable evaluation |
| `scores` | jsonb | Structured scoring dimensions |
| `created_at` | timestamptz | Insert timestamp |

## decision_records

Stores the recommended and chosen action for an opportunity review.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `opportunity_id` | uuid | References `opportunities.id` |
| `recommendation` | text | `watch`, `research_more`, `prototype`, `build`, `reject` |
| `rationale` | text | Why this action is recommended |
| `confidence` | numeric | Decision confidence |
| `human_decision` | text | Human override or final choice when available |
| `metadata` | jsonb | Evidence, tradeoffs, or review-card payload |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## prototype_options

Stores generated UI or prototype directions before or alongside a full generated repo build.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `opportunity_id` | uuid | References `opportunities.id` |
| `decision_record_id` | uuid | References `decision_records.id` when applicable |
| `title` | text | Prototype direction title |
| `prototype_type` | text | `generative_ui`, `static_mock`, `clickable_demo`, `repo_branch`, `generated_repo` |
| `summary` | text | What the prototype explores |
| `artifact_url` | text | URL for rendered prototype, screenshot, branch, or repo when available |
| `artifact_payload` | jsonb | Structured UI schema, prompt, screenshots, or generated files metadata |
| `status` | text | `proposed`, `generated`, `selected`, `rejected`, `failed` |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## mvp_builds

Tracks managed builder work from approval through generated PR review.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `opportunity_id` | uuid | References `opportunities.id` |
| `prototype_option_id` | uuid | References `prototype_options.id` when applicable |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `status` | text | `queued`, `briefed`, `building`, `reviewing`, `completed`, `failed`, `blocked` |
| `build_brief` | jsonb | Internal build brief approved by opportunity approval |
| `template_repo_url` | text | Source template repo |
| `generated_repo_url` | text | Generated MVP repo |
| `branch` | text | Generated branch |
| `pr_url` | text | Generated PR |
| `logs` | text | Builder log summary |
| `error` | text | Failure summary |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## build_artifacts

Stores reviewed generated PR artifacts.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `mvp_build_id` | uuid | References `mvp_builds.id` |
| `artifact_type` | text | `readme`, `test_result`, `screenshot`, `run_instruction`, `service_manifest`, `build_brief`, `build_review` |
| `content` | text | Summary or rendered artifact text |
| `url` | text | Artifact URL when applicable |
| `metadata` | jsonb | Structured details |
| `created_at` | timestamptz | Created timestamp |

## reflection_runs

Stores Forge self-improvement runs. Reflection is about improving Forge behavior, not inventing more product opportunities.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `status` | text | `pending`, `running`, `completed`, `failed` |
| `summary` | text | What Forge learned about its own behavior |
| `evidence` | jsonb | Prior events, failures, ignored alerts, user corrections, eval results |
| `created_at` | timestamptz | Created timestamp |
| `completed_at` | timestamptz | Completion timestamp |

## reflection_proposals

Stores proposed memory, rubric, skill, prompt, scoring, or trigger-policy changes.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `reflection_run_id` | uuid | References `reflection_runs.id` |
| `proposal_type` | text | `memory`, `preference`, `source_weight`, `rubric`, `prompt`, `skill`, `trigger_policy`, `eval_case` |
| `risk_level` | text | `low`, `review_required`, `blocked` |
| `title` | text | Short proposed change |
| `rationale` | text | Why the change should improve future runs |
| `patch` | jsonb | Structured patch or target file/change description |
| `status` | text | `proposed`, `accepted`, `rejected`, `applied` |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## Realtime Channels

Project pages now subscribe to project-scoped status tables when hosted Supabase URL, anon-key config, and a valid
Supabase Auth session are present. The browser receives a short-lived access token for Realtime RLS checks, while
service-role credentials and refresh tokens stay server-side. The page refreshes server-rendered details on
`postgres_changes` messages. If realtime is disabled, no authenticated realtime token is available, or the socket cannot
subscribe, the existing polling bridge remains active.

Enable realtime for:

- `pipeline_runs` status updates.
- `idea_conversations` status updates.
- `research_briefs` status updates.
- `agent_tasks` status updates.
- `opportunities` inserts and status updates.
- `prototype_options` inserts and status updates.
- `mvp_builds` status updates.
- `reflection_runs` status updates.

## Indexes To Add

- `projects(user_id, updated_at desc)`
- `source_configs(project_id, source_type, status)`
- `triggers(project_id, trigger_type, status)`
- `user_preferences(project_id)`
- `user_preferences(user_id)`
- `preference_events(user_preference_id, created_at desc)`
- `preference_events(project_id, created_at desc)`
- `pipeline_runs(project_id, run_type, status, started_at desc)`
- `signals(source, published_at desc)`
- `signals(project_id, captured_at desc)`
- unique index on `signals(project_id, source, source_id)` where `source_id is not null`
- unique index on `signals(project_id, url)` where `url is not null`
- `research_digests(project_id, created_at desc)`
- `opportunities(project_id, status, score desc, created_at desc)`
- `opportunity_evaluations(opportunity_id, created_at desc)`
- `decision_records(opportunity_id, created_at desc)`
- `prototype_options(opportunity_id, status, created_at desc)`
- `mvp_builds(opportunity_id, created_at desc)`
- `mvp_builds(status, updated_at desc)`
- `build_artifacts(mvp_build_id, created_at desc)`
- `reflection_runs(project_id, created_at desc)`
- `reflection_proposals(reflection_run_id, status, created_at desc)`
