# Data Model

Draft contract for the first SQL migration. Prefer boring tables that make opportunity ranking and builder behavior auditable.

## user_preferences

Stores the explicit preference profile used by the dreaming loop.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
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
| `user_preference_id` | uuid | References `user_preferences.id` |
| `event_type` | text | `approved`, `rejected`, `edited`, `launched`, `feedback` |
| `opportunity_id` | uuid | References `opportunities.id` when applicable |
| `mvp_build_id` | uuid | References `mvp_builds.id` when applicable |
| `payload` | jsonb | Event details |
| `created_at` | timestamptz | Created timestamp |

## pipeline_runs

Tracks each opportunity or build pipeline execution.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `run_type` | text | `ranking`, `build`, `fixture`, `managed` |
| `status` | text | `pending`, `running`, `completed`, `failed` |
| `trigger` | text | `manual`, `schedule`, `fixture`, `remote` |
| `started_at` | timestamptz | Run start |
| `completed_at` | timestamptz | Run end |
| `error` | text | Failure summary |
| `metadata` | jsonb | Runtime details |

## signals

Stores raw and normalized source evidence or manual ideas.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
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

## opportunities

Stores normalized product opportunities that can be approved for build.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `title` | text | Opportunity title |
| `problem` | text | Problem statement |
| `target_user` | text | Primary user or buyer |
| `mvp_concept` | text | Candidate MVP shape |
| `score` | numeric | Overall ranking score |
| `score_rationale` | text | Why it scored this way |
| `status` | text | `proposed`, `approved`, `rejected`, `building`, `built`, `archived` |
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
| `evaluator` | text | `critic`, `bull`, `bear`, `preference_modeler`, etc. |
| `content` | text | Human-readable evaluation |
| `scores` | jsonb | Structured scoring dimensions |
| `created_at` | timestamptz | Insert timestamp |

## mvp_builds

Tracks managed builder work from approval through generated PR review.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `opportunity_id` | uuid | References `opportunities.id` |
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

## Realtime Channels

Enable realtime for:

- `opportunities` inserts and status updates.
- `mvp_builds` status updates.
- `build_artifacts` inserts.

## Indexes To Add

- `user_preferences(user_id)`
- `preference_events(user_preference_id, created_at desc)`
- `pipeline_runs(run_type, status, started_at desc)`
- `signals(source, published_at desc)`
- unique index on `signals(source, source_id)` where `source_id is not null`
- unique index on `signals(url)` where `url is not null`
- `opportunities(status, score desc, created_at desc)`
- `opportunity_evaluations(opportunity_id, created_at desc)`
- `mvp_builds(opportunity_id, created_at desc)`
- `mvp_builds(status, updated_at desc)`
- `build_artifacts(mvp_build_id, created_at desc)`
