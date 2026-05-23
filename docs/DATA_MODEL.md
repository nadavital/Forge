# Data Model

Draft contract for the first SQL migration. Prefer boring tables that make product context, opportunity ranking, builder behavior, and Forge self-improvement auditable.

The implemented ingestion migration is `supabase/migrations/0001_ingestion_agent.sql`. It creates the subset needed for the first Google ADK ingestion agent: `pipeline_runs`, `signals`, `opportunities`, `opportunity_signals`, and `opportunity_evaluations`.

## projects

Stores the product workspace Forge is helping create or iterate on.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `user_id` | uuid | Future auth user reference; nullable for single-user v1 |
| `name` | text | Product or sample project name |
| `mode` | text | `connected_product`, `new_product`, `sample_project` |
| `stage` | text | `idea`, `prototype`, `launched`, `internal` |
| `description` | text | Product context summary |
| `repo_url` | text | Existing product repo when connected |
| `product_url` | text | Live product or marketing site when available |
| `target_users` | text[] | Target users or buyers |
| `context` | jsonb | Product positioning, constraints, competitors, roadmap notes |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

## source_configs

Stores configured inputs for a project.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `source_type` | text | `manual`, `feedback_form`, `github`, `hacker_news`, `reddit`, `web_search`, `social_search`, `competitor`, etc. |
| `name` | text | Human-readable source label |
| `config` | jsonb | Query terms, repo URLs, competitor URLs, channels, rate-limit settings |
| `status` | text | `active`, `paused`, `error` |
| `last_checked_at` | timestamptz | Last source scan |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

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

Tracks each opportunity or build pipeline execution.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `project_id` | uuid | References `projects.id` |
| `trigger_id` | uuid | References `triggers.id` when applicable |
| `run_type` | text | `scan`, `research`, `ranking`, `review`, `build`, `reflection`, `fixture`, `managed` |
| `status` | text | `pending`, `running`, `completed`, `failed` |
| `trigger` | text | `manual`, `schedule`, `signal`, `fixture`, `remote` |
| `started_at` | timestamptz | Run start |
| `completed_at` | timestamptz | Run end |
| `error` | text | Failure summary |
| `metadata` | jsonb | Runtime details |

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
| `artifact_type` | text | `readme`, `test_result`, `screenshot`, `run_instruction`, `service_manifest` |
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

Enable realtime for:

- `opportunities` inserts and status updates.
- `decision_records` inserts.
- `prototype_options` inserts and status updates.
- `mvp_builds` status updates.
- `build_artifacts` inserts.
- `reflection_proposals` inserts when review is required.

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
