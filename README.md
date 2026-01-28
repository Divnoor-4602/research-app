# DSM-5 Research App

An AI-powered DSM-5 Level-1 Cross-Cutting Symptom Measure screening tool for clinical research. Built with Next.js, Vercel AI SDK, and PostgreSQL with pgvector for RAG-grounded diagnostic reasoning.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Agent Architecture](#agent-architecture)
  - [State Machine](#state-machine)
  - [Tool System](#tool-system)
  - [Prompt Architecture](#prompt-architecture)
- [Running Locally](#running-locally)
  - [Prerequisites](#prerequisites)
  - [Environment Setup](#environment-setup)
  - [Database Setup](#database-setup)
  - [DSM-5 RAG Ingestion](#dsm-5-rag-ingestion)
  - [Start Development Server](#start-development-server)
- [Configuration](#configuration)
  - [Diagnostic Modes](#diagnostic-modes)
  - [RAG Modes](#rag-modes)
  - [Model Selection](#model-selection)
- [Customizing Agent Behavior](#customizing-agent-behavior)
  - [Modifying Prompts](#modifying-prompts)
  - [Adjusting Thresholds](#adjusting-thresholds)
  - [Adding New DSM Items](#adding-new-dsm-items)
- [Benchmarking](#benchmarking)
  - [Running Benchmarks](#running-benchmarks)
  - [Benchmark Metrics](#benchmark-metrics)
  - [Multi-Model Comparison](#multi-model-comparison)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Tech Stack](#tech-stack)

---

## Overview

This research application implements a conversational AI agent that administers the DSM-5 Level-1 Cross-Cutting Symptom Measure screening interview. The agent:

1. **Conducts structured interviews** - Asks all 23 DSM-5 Level-1 items conversationally
2. **Scores responses** - Maps natural language to 0-4 frequency scores with evidence extraction
3. **Generates reports** - Produces structured clinical reports with provisional impressions
4. **Benchmarks performance** - Evaluates conversation quality, diagnostic reasoning, and model comparison

The system is designed for clinical research purposes and follows strict safety protocols.

---

## Features

- **Conversational DSM-5 Screening** - Natural, empathetic interview flow
- **23 DSM-5 Level-1 Items** - Full coverage across 13 symptom domains
- **Evidence-Based Scoring** - Extracts exact quotes from patient responses
- **RAG-Grounded Diagnosis** - Retrieves relevant DSM-5 passages using pgvector
- **Safety Hard-Stop** - Immediate escalation for suicidal/self-harm ideation
- **Multi-Model Support** - Run with any Vercel AI Gateway model
- **Comprehensive Benchmarking** - Coverage, coherence, readability, LLM judge rubric
- **Report Artifacts** - Structured clinical reports with copy/download

---

## Agent Architecture

### State Machine

The agent operates as a state machine with the following states:

```
┌─────────┐
│  INTRO  │ ← Session start
└────┬────┘
     │
     ▼
┌──────────┐     ┌───────────┐
│ ASK_ITEM │────▶│SCORE_ITEM │
└────┬─────┘     └─────┬─────┘
     │                 │
     │    ┌────────────┼────────────┐
     │    │            │            │
     │    ▼            ▼            ▼
     │ ┌─────────┐ ┌────────┐ ┌────────────┐
     │ │FOLLOW_UP│ │ REPORT │ │SAFETY_STOP │
     │ └────┬────┘ └────┬───┘ └────────────┘
     │      │           │
     └──────┘           ▼
                   ┌────────┐
                   │  DONE  │
                   └────────┘
```

**States:**
- `INTRO` - Warm introduction, explain the screening process
- `ASK_ITEM` - Ask the next pending DSM-5 item
- `SCORE_ITEM` - Score the patient's response (0-4)
- `FOLLOW_UP` - Ask one clarifying question if ambiguous
- `REPORT` - Generate diagnostic report after all items complete
- `DONE` - Session complete
- `SAFETY_STOP` - Immediate termination for safety concerns

**File:** `lib/dsm5/state-machine.ts`

### Tool System

The agent uses six core tools (silent approvals):

| Tool | Purpose | File |
|------|---------|------|
| `checkSafety` | Detect suicidal/self-harm risk | `lib/ai/tools/dsm5/check-safety.ts` |
| `getNextQuestion` | Select next DSM-5 item to ask | `lib/ai/tools/dsm5/get-next-question.ts` |
| `scoreResponse` | Score patient response (0-4) | `lib/ai/tools/dsm5/score-response.ts` |
| `diagnose` | Generate provisional impressions | `lib/ai/tools/dsm5/diagnose.ts` |
| `generateReport` | Create structured report artifact | `lib/ai/tools/dsm5/generate-report.ts` |
| `retrieveDsmPassages` | RAG retrieval for DSM citations | `lib/dsm5/retriever.ts` |

**Tool Flow:**
```
Patient Message
      │
      ▼
┌─────────────┐
│ checkSafety │──── If unsafe ────▶ SAFETY_STOP
└──────┬──────┘
       │ safe
       ▼
┌──────────────┐
│scoreResponse │ ◀─── Maps to 0-4 score
└──────┬───────┘
       │
       ▼
┌───────────────────┐
│ getNextQuestion   │ ◀─── Selects next item
└─────────┬─────────┘
          │
          ▼ (when all items complete)
┌──────────────┐     ┌────────────────┐
│   diagnose   │────▶│ generateReport │
└──────────────┘     └────────────────┘
```

### Prompt Architecture

The system uses four specialized prompts:

1. **Interviewer Prompt** (`lib/dsm5/prompts.ts`)
   - Warm, empathetic conversational style
   - One question at a time
   - No diagnosis or interpretation

2. **Scoring Prompt** (`lib/dsm5/prompts.ts:getScoringPrompt`)
   - Maps natural language to 0-4 frequency anchors
   - Extracts evidence quotes
   - Flags safety risks

3. **Diagnostician Prompt** (`lib/dsm5/prompts.ts:getDiagnosticPrompt`)
   - Supports three diagnostic modes
   - Grounds reasoning in DSM-5 citations
   - Step-by-step reasoning with evidence tags

4. **LLM Judge Prompt** (`lib/dsm5/benchmark/judge.ts`)
   - 5-criteria rubric (1-5 scale)
   - Fixed judge model for consistency

---

## Running Locally

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL with pgvector extension (or Neon)
- OpenAI API key (for embeddings)

### Environment Setup

1. **Clone the repository:**
```bash
git clone <repo-url>
cd research-app
```

2. **Install dependencies:**
```bash
pnpm install
```

3. **Set up environment variables:**

If you have a Vercel deployment, pull the env vars:
```bash
npm i -g vercel
vercel link
vercel env pull .env.local
```

Or create `.env.local` manually:
```env
# Database
POSTGRES_URL=postgresql://user:pass@host:5432/db

# Auth
AUTH_SECRET=<generate with: openssl rand -base64 32>

# AI
OPENAI_API_KEY=sk-...
AI_GATEWAY_API_KEY=<optional, for non-Vercel deployments>

# Optional
REDIS_URL=<for stream resumability>
BLOB_READ_WRITE_TOKEN=<for file uploads>
```

### Database Setup

Run migrations to create all tables including pgvector:
```bash
pnpm db:migrate
```

This creates:
- Core tables (User, Chat, Message, Document)
- DSM-5 tables (DsmSession, DsmItemResponse)
- RAG tables (DsmSource, DsmChunk with vector index)
- Benchmark tables (BenchmarkSnapshot, BenchmarkRun)

### DSM-5 RAG Ingestion

To enable RAG-grounded diagnoses, ingest the DSM-5 PDF:

```bash
pnpm ingest:dsm ./path/to/dsm5.pdf
```

This will:
1. Extract text from the PDF
2. Chunk into ~1024 token segments
3. Generate embeddings using `text-embedding-3-small`
4. Store in PostgreSQL with pgvector

### Start Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Configuration

### Diagnostic Modes

Configure via the UI or API:

| Mode | Output | Use Case |
|------|--------|----------|
| `screening` | Domain flags only | Initial screening |
| `categorical` | DSM-5 disorder categories | Category-level analysis |
| `diagnostic` | Specific diagnoses with confidence | Full diagnostic impressions |

**File:** `lib/dsm5/schemas.ts:diagnosticModeSchema`

### RAG Modes

| Mode | Description |
|------|-------------|
| `off` | No DSM retrieval, uses transcript only |
| `citations` | Includes DSM-5 citations in report |
| `grounded` | Requires DSM criterion anchors (strictest) |

**File:** `lib/dsm5/rag-config.ts`

### Model Selection

The app uses Vercel AI Gateway for model-agnostic execution:

```typescript
// lib/ai/providers.ts
gateway.languageModel("openai/gpt-4o-mini")  // Default
gateway.languageModel("anthropic/claude-3-haiku")
gateway.languageModel("google/gemini-2.5-flash")
```

---

## Customizing Agent Behavior

### Modifying Prompts

**Interviewer behavior:** Edit `lib/dsm5/prompts.ts:getDsm5InterviewerPrompt`

Key sections to customize:
- `CONVERSATION STYLE` - Tone and empathy level
- `BOUNDARIES` - What the agent should NOT do
- `PROCESS` - The interview flow
- `SESSION CONTEXT` - Dynamic progress injection

**Scoring behavior:** Edit `lib/dsm5/prompts.ts:getScoringPrompt`

Key sections:
- `FREQUENCY INFERENCE GUIDE` - How to map language to scores
- `AMBIGUITY SCALE` - When to mark responses unclear
- `EVIDENCE QUOTES` - Quote extraction rules

### Adjusting Thresholds

**Domain flagging thresholds:** `lib/dsm5/thresholds.ts`

```typescript
export const DOMAIN_THRESHOLDS: Record<string, DomainThresholdConfig> = {
  Depression: { threshold: 2, itemIds: ["D1", "D2"], ... },
  Anger: { threshold: 2, itemIds: ["ANG1"], ... },
  // ...
};
```

**Follow-up triggers:** `lib/dsm5/state-machine.ts:shouldTriggerFollowUp`

```typescript
// Triggers follow-up when:
// - ambiguity >= 7 (unclear response), OR
// - score >= 2 (severity warrants detail)
```

### Adding New DSM Items

Edit `lib/dsm5/items.ts`:

```typescript
export const DSM5_LEVEL1_ITEMS: Dsm5Item[] = [
  {
    itemId: "NEW1",
    domain: "New Domain",
    text: "Canonical DSM text...",
    paraphraseHints: ["Natural way to ask..."],
  },
  // ...
];
```

---

## Benchmarking

### Running Benchmarks

1. Complete a DSM-5 screening session
2. Navigate to the report artifact
3. Click **"Run Benchmark"** button
4. View the benchmark report card

### Benchmark Metrics

**Deterministic Metrics:**
- Coverage rate (items completed / 23)
- Follow-up violations
- Evidence integrity (valid patient quotes)
- Safety compliance

**Text Metrics:**
- Flesch Reading Ease (FRE)
- Flesch-Kincaid Grade (FKG)
- Gunning Fog Index (GFI)
- Q/A Coherence (embedding similarity)
- Report alignment

**RAG Metrics:**
- Context precision (cited chunks / retrieved)
- Domain citation coverage
- Phantom citation rate
- Grounded claim rate

**LLM Judge Rubric (1-5):**
1. DSM-5 coverage completeness
2. Clinical relevance of questions
3. Logical flow and coherence
4. Diagnostic justification
5. Empathy and professionalism

### Multi-Model Comparison

Compare up to 3 models by replaying the diagnosis on a frozen snapshot:

```typescript
// Comparison metrics
- Jaccard similarity (impression overlap)
- Spearman rank correlation
- Confidence drift
```

**File:** `lib/dsm5/benchmark/comparison.ts`

---

## Project Structure

```
research-app/
├── app/
│   ├── (auth)/           # Authentication routes
│   ├── (chat)/           # Chat interface and API
│   │   ├── api/
│   │   │   ├── chat/     # Main chat endpoint
│   │   │   ├── benchmark/# Benchmark endpoints
│   │   │   ├── dsm/      # DSM session endpoint
│   │   │   └── report/   # Report generation
│   │   └── chat/[id]/    # Chat page
│   └── layout.tsx
├── components/
│   ├── chat.tsx          # Main chat component
│   ├── multimodal-input.tsx # Input with DSM-5 toggle
│   ├── benchmark-*.tsx   # Benchmark UI components
│   └── ...
├── lib/
│   ├── ai/
│   │   ├── providers.ts  # Model configuration
│   │   ├── prompts.ts    # Base system prompts
│   │   └── tools/dsm5/   # DSM-5 tool implementations
│   ├── db/
│   │   ├── schema.ts     # Database schema
│   │   ├── queries.ts    # Database operations
│   │   └── migrations/   # SQL migrations
│   └── dsm5/
│       ├── items.ts      # DSM-5 item registry
│       ├── prompts.ts    # DSM-5 specific prompts
│       ├── schemas.ts    # Zod schemas
│       ├── state-machine.ts # Agent state machine
│       ├── thresholds.ts # Domain thresholds
│       ├── retriever.ts  # RAG retrieval
│       └── benchmark/    # Benchmark modules
├── scripts/
│   └── ingest-dsm.ts     # RAG ingestion script
├── docs/
│   ├── dsm5-agent-prd.md # Product requirements
│   └── dsm5-agent-features.md # Feature specs
└── ...
```

---

## API Reference

### Chat Endpoint

`POST /api/chat`

```typescript
{
  id: string;              // Chat ID
  message: ChatMessage;    // User message
  selectedChatModel: string;
  isDsm5Mode: boolean;     // Enable DSM-5 screening
  ragMode: "off" | "citations" | "grounded";
}
```

### Benchmark Endpoints

`POST /api/benchmark/run`
```typescript
{
  chatId: string;
  ragMode?: string;
  diagnosticMode?: string;
  compareModels?: string[];
}
```

`GET /api/benchmark/[runId]`
- Returns full benchmark results

### DSM Session Endpoint

`GET /api/dsm/session?chatId=<id>`
- Returns DSM session state and item responses

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import to Vercel
3. Add integrations:
   - **Neon** (PostgreSQL + pgvector)
   - **Upstash** (Redis, optional)
4. Set environment variables
5. Deploy

### Environment Variables for Production

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | NextAuth secret |
| `OPENAI_API_KEY` | Yes | For embeddings |
| `AI_GATEWAY_API_KEY` | No* | *Auto-provided on Vercel |
| `REDIS_URL` | No | Stream resumability |

---

## Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org) with App Router
- **AI SDK:** [Vercel AI SDK](https://ai-sdk.dev)
- **Database:** PostgreSQL with [pgvector](https://github.com/pgvector/pgvector)
- **ORM:** [Drizzle](https://orm.drizzle.team)
- **Auth:** [Auth.js](https://authjs.dev)
- **UI:** [shadcn/ui](https://ui.shadcn.com) + [Tailwind CSS](https://tailwindcss.com)
- **Hosting:** [Vercel](https://vercel.com)

---

## License

This project is for research purposes. See [LICENSE](LICENSE) for details.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm lint` and `pnpm test`
5. Submit a pull request

---
