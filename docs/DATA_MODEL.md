# Data Model

Draft contract for the first SQL migration. Prefer boring tables that make pipeline behavior auditable.

## pipeline_runs

Tracks each pipeline execution.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `status` | text | `pending`, `running`, `completed`, `failed` |
| `trigger` | text | `manual`, `schedule`, `fixture`, `remote` |
| `started_at` | timestamptz | Run start |
| `completed_at` | timestamptz | Run end |
| `error` | text | Failure summary |
| `metadata` | jsonb | Runtime details |

## signals

Stores raw and normalized source evidence.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `source` | text | `hacker_news`, `reddit`, etc. |
| `source_id` | text | Source-native ID when available |
| `url` | text | Canonical source URL |
| `title` | text | Source title |
| `body` | text | Extracted text when allowed |
| `author` | text | Public author handle when available |
| `published_at` | timestamptz | Source timestamp |
| `captured_at` | timestamptz | Ingestion timestamp |
| `tags` | text[] | Normalized tags |
| `score` | numeric | Optional heuristic or model score |
| `metadata` | jsonb | Source-specific details |

## theses

Stores synthesized thesis drafts.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `title` | text | Display title |
| `slug` | text | Stable URL slug |
| `status` | text | `draft`, `debating`, `published`, `archived` |
| `markdown` | text | Human-readable thesis draft |
| `profile` | jsonb | Structured thesis profile |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |
| `published_at` | timestamptz | Published timestamp |

## thesis_signals

Join table for thesis evidence.

| Column | Type | Notes |
| --- | --- | --- |
| `thesis_id` | uuid | References `theses.id` |
| `signal_id` | uuid | References `signals.id` |
| `relevance` | numeric | Optional relevance score |
| `notes` | text | Why this signal matters |

## debate_messages

Append-only stream of agent debate turns.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `pipeline_run_id` | uuid | References `pipeline_runs.id` |
| `thesis_id` | uuid | References `theses.id` |
| `round` | integer | Debate round |
| `role` | text | `bull`, `bear`, `synthesizer`, `moderator` |
| `agent_name` | text | Exact agent name |
| `content` | text | Message body |
| `claims` | jsonb | Optional structured claims |
| `created_at` | timestamptz | Insert timestamp |

## thesis_qa

Stores user follow-up questions and agent answers.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `thesis_id` | uuid | References `theses.id` |
| `target_agent` | text | `bull`, `bear`, or `synthesizer` |
| `question` | text | User prompt |
| `answer` | text | Agent answer |
| `status` | text | `pending`, `answered`, `failed` |
| `created_at` | timestamptz | Created timestamp |
| `answered_at` | timestamptz | Answer timestamp |

## Realtime Channels

Enable realtime for:

- `debate_messages` inserts.
- `theses` inserts and updates.
- `thesis_qa` updates only if Q&A is asynchronous.

## Indexes To Add

- `pipeline_runs(status, started_at desc)`
- `signals(source, published_at desc)`
- unique index on `signals(source, source_id)` where `source_id is not null`
- unique index on `signals(url)` where `url is not null`
- `theses(status, published_at desc)`
- `debate_messages(thesis_id, round, created_at)`
- `thesis_qa(thesis_id, created_at desc)`
