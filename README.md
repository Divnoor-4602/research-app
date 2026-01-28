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

## Complete System Architecture

### High-Level Architecture

```mermaid
flowchart TB
    subgraph Client["🖥️ Client (Browser)"]
        UI[React UI]
        ChatComponent[Chat Component]
        MultimodalInput[Multimodal Input]
        DSM5Toggle[DSM-5 Mode Toggle]
        ReportViewer[Report Viewer]
        BenchmarkCard[Benchmark Report Card]
    end

    subgraph API["⚡ Next.js API Routes"]
        ChatAPI["/api/chat"]
        ReportAPI["/api/report/generate"]
        BenchmarkAPI["/api/benchmark/run"]
        SessionAPI["/api/dsm/session"]
    end

    subgraph Agent["🤖 DSM-5 Agent"]
        StateMachine[State Machine]
        ToolOrchestrator[Tool Orchestrator]
        PromptBuilder[Prompt Builder]
    end

    subgraph Tools["🔧 Agent Tools"]
        CheckSafety[checkSafety]
        GetNextQuestion[getNextQuestion]
        ScoreResponse[scoreResponse]
        Diagnose[diagnose]
        GenerateReport[generateReport]
    end

    subgraph RAG["📚 RAG System"]
        Retriever[DSM Retriever]
        Embeddings[OpenAI Embeddings]
        VectorSearch[pgvector Search]
    end

    subgraph Database["🗄️ PostgreSQL + pgvector"]
        ChatTable[(Chat)]
        MessageTable[(Message)]
        DsmSession[(DsmSession)]
        DsmItemResponse[(DsmItemResponse)]
        DsmChunk[(DsmChunk)]
        BenchmarkRun[(BenchmarkRun)]
    end

    subgraph LLM["🧠 LLM Providers"]
        Gateway[Vercel AI Gateway]
        OpenAI[OpenAI]
        Anthropic[Anthropic]
        Google[Google]
    end

    %% Client to API
    UI --> ChatComponent
    ChatComponent --> MultimodalInput
    MultimodalInput --> DSM5Toggle
    MultimodalInput -->|"POST /api/chat"| ChatAPI
    ReportViewer -->|"POST /api/report/generate"| ReportAPI
    BenchmarkCard -->|"POST /api/benchmark/run"| BenchmarkAPI

    %% API to Agent
    ChatAPI -->|"isDsm5Mode=true"| Agent
    ChatAPI -->|"isDsm5Mode=false"| Gateway

    %% Agent internals
    StateMachine --> ToolOrchestrator
    PromptBuilder --> StateMachine
    ToolOrchestrator --> Tools

    %% Tools to subsystems
    CheckSafety --> DsmSession
    GetNextQuestion --> DsmSession
    ScoreResponse --> DsmItemResponse
    Diagnose --> RAG
    GenerateReport --> MessageTable

    %% RAG flow
    Retriever --> Embeddings
    Embeddings --> VectorSearch
    VectorSearch --> DsmChunk

    %% Agent to LLM
    Agent -->|"streamText()"| Gateway
    Gateway --> OpenAI
    Gateway --> Anthropic
    Gateway --> Google

    %% Response flow back
    Gateway -->|"Stream"| ChatAPI
    ChatAPI -->|"SSE Stream"| ChatComponent
    ReportAPI --> ReportViewer
    BenchmarkAPI --> BenchmarkCard
```

### Complete Request Flow (DSM-5 Mode)

```mermaid
sequenceDiagram
    autonumber
    participant User as 👤 User
    participant UI as 🖥️ React UI
    participant API as ⚡ /api/chat
    participant Auth as 🔐 Auth
    participant DB as 🗄️ Database
    participant Agent as 🤖 Agent
    participant Tools as 🔧 Tools
    participant LLM as 🧠 LLM
    participant RAG as 📚 RAG

    User->>UI: Types message
    UI->>UI: Check isDsm5Mode toggle
    UI->>API: POST /api/chat {message, isDsm5Mode: true}
    
    API->>Auth: Verify session
    Auth-->>API: User authenticated
    
    API->>DB: Get or create DsmSession
    DB-->>API: Session with questionState
    
    API->>Agent: Build DSM-5 interviewer prompt
    Agent->>Agent: Inject progress, current item, state
    
    API->>LLM: streamText() with tools
    
    loop Tool Execution Loop
        LLM->>Tools: Call checkSafety(message)
        Tools->>DB: Check risk flags
        Tools-->>LLM: {safe: true/false}
        
        alt Safety Triggered
            LLM->>API: Return escalation script
            API->>DB: Update sessionStatus = "terminated_for_safety"
        else Safe - Continue
            LLM->>Tools: Call scoreResponse(itemId, response)
            Tools->>DB: Store itemResponse with evidence
            Tools-->>LLM: {score, ambiguity, shouldFollowUp}
            
            alt Need Follow-up
                LLM->>Tools: Call getNextQuestion(isFollowUp=true)
            else All Items Complete
                LLM->>Tools: Call diagnose(snapshot, mode)
                Tools->>RAG: retrieveDsmPassages(query)
                RAG-->>Tools: Top-k DSM citations
                Tools-->>LLM: {impressions, reasoning, citations}
                
                LLM->>Tools: Call generateReport(diagnosisResult)
                Tools->>DB: Save report artifact
            else Next Item
                LLM->>Tools: Call getNextQuestion()
                Tools->>DB: Get next pending item
                Tools-->>LLM: {itemId, questionText}
            end
        end
    end
    
    LLM-->>API: Stream response chunks
    API-->>UI: SSE stream
    UI->>DB: Append to transcript
    UI-->>User: Display response
```

### Agent State Machine (Detailed)

```mermaid
stateDiagram-v2
    [*] --> INTRO: New Session Created
    
    INTRO --> ASK_ITEM: User responds to intro
    
    ASK_ITEM --> SCORE_ITEM: Patient responds
    ASK_ITEM --> SAFETY_STOP: Risk detected
    
    SCORE_ITEM --> FOLLOW_UP: ambiguity >= 7 OR score >= 2
    SCORE_ITEM --> ASK_ITEM: Move to next item
    SCORE_ITEM --> REPORT: All 23 items complete
    SCORE_ITEM --> SAFETY_STOP: Risk detected
    
    FOLLOW_UP --> SCORE_ITEM: Patient clarifies
    FOLLOW_UP --> SAFETY_STOP: Risk detected
    
    REPORT --> DONE: Report generated
    
    SAFETY_STOP --> [*]: Session terminated
    DONE --> [*]: Session complete

    note right of INTRO
        - Warm greeting
        - Explain screening purpose
        - Describe 0-4 scale
    end note
    
    note right of ASK_ITEM
        - Select next pending item
        - Paraphrase into natural question
        - Track remainingCount
    end note
    
    note right of SCORE_ITEM
        - Map response to 0-4
        - Extract evidence quotes
        - Update ambiguity (1-10)
    end note
    
    note right of FOLLOW_UP
        - One follow-up max per item
        - Ask for frequency/impact
        - Record in followUpUsedItems
    end note
    
    note right of REPORT
        - Call diagnose()
        - Retrieve DSM passages
        - Generate streamdown report
    end note
    
    note right of SAFETY_STOP
        - Immediate termination
        - Show escalation script
        - No further tools allowed
    end note
```

### Tool Execution Flow

```mermaid
flowchart TD
    subgraph Input["📥 Patient Message"]
        MSG[Patient Response Text]
    end

    subgraph Safety["🛡️ Safety Check (Always First)"]
        CS[checkSafety]
        CS -->|"Analyze for risk"| RISK{Risk Detected?}
        RISK -->|"Yes"| STOP[🚨 SAFETY_STOP]
        RISK -->|"No"| CONTINUE[Continue Processing]
    end

    subgraph Scoring["📊 Response Scoring"]
        SR[scoreResponse]
        SR --> SCORE[Score 0-4]
        SR --> AMB[Ambiguity 1-10]
        SR --> EV[Evidence Quotes]
        SR --> CONF[Confidence 0-1]
        SR --> FLAGS[Risk Flag Patch]
    end

    subgraph Decision["🔀 Next Action Decision"]
        DEC{What Next?}
        DEC -->|"ambiguity >= 7"| FU[Request Follow-up]
        DEC -->|"score >= 2 & no followup yet"| FU
        DEC -->|"items remaining"| NEXT[Get Next Question]
        DEC -->|"all 23 complete"| DIAG[Generate Diagnosis]
    end

    subgraph NextQ["❓ Question Selection"]
        GNQ[getNextQuestion]
        GNQ --> ITEM[Select pending itemId]
        GNQ --> PARA[Paraphrase question]
        GNQ --> COUNT[Update remainingCount]
    end

    subgraph Diagnosis["🔬 Diagnostic Analysis"]
        DIAGNOSE[diagnose]
        RAG[retrieveDsmPassages]
        DIAGNOSE -->|"Build query"| RAG
        RAG -->|"Top-5 chunks"| DIAGNOSE
        DIAGNOSE --> IMP[Impressions + Confidence]
        DIAGNOSE --> REASON[Step-by-step Reasoning]
        DIAGNOSE --> CITE[DSM Citations]
    end

    subgraph Report["📄 Report Generation"]
        GR[generateReport]
        GR --> SUM[Executive Summary]
        GR --> TABLE[Domain Score Table]
        GR --> APPEND[Item Appendix]
        GR --> IMPRESS[Provisional Impressions]
        GR --> LIM[Limitations]
    end

    MSG --> CS
    CONTINUE --> SR
    SR --> DEC
    FU --> GNQ
    NEXT --> GNQ
    DIAG --> DIAGNOSE
    DIAGNOSE --> GR
    GR --> ARTIFACT[(Save Artifact)]
```

### Benchmarking Pipeline

```mermaid
flowchart TD
    subgraph Trigger["🎯 Benchmark Trigger"]
        BTN[Run Benchmark Button]
        BTN --> API[POST /api/benchmark/run]
    end

    subgraph Snapshot["📸 Frozen Snapshot"]
        API --> SNAP[Create Snapshot]
        SNAP --> TRANS[Transcript]
        SNAP --> ITEMS[Item Responses]
        SNAP --> DOMAIN[Domain Summary]
        SNAP --> REPORT[Report Content]
        SNAP --> HASH[SHA256 Hash]
    end

    subgraph Deterministic["📐 Deterministic Metrics"]
        DET[Compute Deterministic]
        DET --> COV[Coverage Rate: items/23]
        DET --> FUV[Follow-up Violations]
        DET --> MQT[Multi-question Turns]
        DET --> EVID[Evidence Integrity]
        DET --> SAFE[Safety Compliance]
    end

    subgraph Text["📝 Text Metrics"]
        TXT[Compute Text Metrics]
        TXT --> FRE[Flesch Reading Ease]
        TXT --> FKG[Flesch-Kincaid Grade]
        TXT --> GFI[Gunning Fog Index]
        TXT --> DUP[Duplication Rate]
    end

    subgraph Coherence["🔗 Coherence Metrics"]
        COH[Compute Coherence]
        COH --> EMB[Generate Embeddings]
        EMB --> QA[Q/A Coherence Score]
        EMB --> ALIGN[Report Alignment]
    end

    subgraph RAGMetrics["📚 RAG Metrics"]
        RAGM[Compute RAG Metrics]
        RAGM --> PREC[Context Precision]
        RAGM --> DCOV[Domain Citation Coverage]
        RAGM --> PHAN[Phantom Citation Rate]
        RAGM --> GRND[Grounded Claim Rate]
    end

    subgraph Judge["⚖️ LLM Judge"]
        JDG[Run LLM Judge]
        JDG --> R1[Coverage: 1-5]
        JDG --> R2[Relevance: 1-5]
        JDG --> R3[Flow: 1-5]
        JDG --> R4[Explainability: 1-5]
        JDG --> R5[Empathy: 1-5]
        JDG --> STR[Strengths Top 3]
        JDG --> ISS[Issues Top 3]
        JDG --> REC[Recommendations]
    end

    subgraph Compare["🔄 Model Comparison Optional"]
        CMP[Run Comparison]
        CMP --> REPLAY["Replay diagnose per model"]
        REPLAY --> JAC[Jaccard Similarity]
        REPLAY --> SPEAR[Spearman Correlation]
        REPLAY --> DRIFT[Confidence Drift]
    end

    subgraph Result["📊 Benchmark Result"]
        RES[Aggregate Results]
        RES --> STATUS[PASS / WARN / FAIL]
        RES --> CARD[Benchmark Report Card]
        CARD --> UI[Display in UI]
    end

    SNAP --> DET
    SNAP --> TXT
    SNAP --> COH
    SNAP --> RAGM
    SNAP --> JDG
    SNAP --> CMP
    
    DET --> RES
    TXT --> RES
    COH --> RES
    RAGM --> RES
    JDG --> RES
    CMP --> RES
```

### Database Entity Relationships

```mermaid
erDiagram
    User ||--o{ Chat : owns
    Chat ||--o{ Message : contains
    Chat ||--o| DsmSession : has
    Chat ||--o{ Document : has
    Chat ||--o{ BenchmarkSnapshot : has
    
    DsmSession ||--o{ DsmItemResponse : contains
    
    DsmSource ||--o{ DsmChunk : contains
    
    BenchmarkSnapshot ||--o{ BenchmarkRun : triggers
    
    User {
        uuid id PK
        varchar email
        varchar password
    }
    
    Chat {
        uuid id PK
        uuid userId FK
        text title
        timestamp createdAt
        varchar visibility
    }
    
    Message {
        uuid id PK
        uuid chatId FK
        varchar role
        json parts
        json attachments
        timestamp createdAt
    }
    
    DsmSession {
        uuid id PK
        uuid chatId FK
        varchar sessionStatus
        varchar diagnosticMode
        json transcript
        json symptomSummary
        json riskFlags
        json questionState
        json sessionMeta
        timestamp completedAt
    }
    
    DsmItemResponse {
        uuid id PK
        uuid sessionId FK
        varchar itemId
        int score
        int ambiguity
        json evidenceQuotes
        json evidence
        real confidence
    }
    
    DsmSource {
        uuid id PK
        text name
        text version
        text checksum
        varchar status
        int totalChunks
    }
    
    DsmChunk {
        uuid id PK
        uuid sourceId FK
        int chunkIndex
        text content
        vector embedding
        int page
        text sectionPath
        int tokenCount
    }
    
    Document {
        uuid id PK
        uuid userId FK
        uuid chatId FK
        text title
        text content
        varchar kind
    }
    
    BenchmarkSnapshot {
        uuid id PK
        uuid chatId FK
        text hash
        json payload
    }
    
    BenchmarkRun {
        uuid id PK
        uuid chatId FK
        uuid snapshotId FK
        json config
        varchar status
        json metricsDeterministic
        json metricsText
        json metricsRag
        json judgeResult
        json comparisons
    }
```

### RAG Ingestion & Retrieval Pipeline

```mermaid
flowchart LR
    subgraph Ingestion["📥 Ingestion (Admin)"]
        PDF[DSM-5 PDF]
        PDF -->|"pdf-parse"| EXTRACT[Extract Text]
        EXTRACT -->|"Chunk ~1024 tokens"| CHUNKS[Text Chunks]
        CHUNKS -->|"text-embedding-3-small"| EMBED[Generate Embeddings]
        EMBED -->|"Batch insert"| STORE[(DsmChunk Table)]
    end

    subgraph Runtime["🔍 Runtime Retrieval"]
        QUERY[Query from diagnose]
        QUERY -->|"Build query text"| QEMBED[Embed Query]
        QEMBED -->|"Cosine similarity"| SEARCH[pgvector Search]
        SEARCH -->|"Top-k=5"| RESULTS[Retrieved Chunks]
        RESULTS -->|"Format citations"| CITE[DSM Citations]
    end

    subgraph Storage["🗄️ PostgreSQL + pgvector"]
        STORE
        SEARCH --> STORE
        INDEX[IVFFlat Index]
        STORE --- INDEX
    end

    CITE -->|"Inject into prompt"| DIAG[Diagnostician LLM]
```

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
