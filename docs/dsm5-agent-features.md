# DSM-5 Agent Feature Spec (Phase 1 + Phase 2)

This document breaks Phase 1 and Phase 2 into dependency-ordered features. Each feature builds on prior ones and defines scope, inputs/outputs, and acceptance criteria. After each feature, provide answers to the questions listed so we can refine the implementation details before coding.

## Phase 1 (MVP)

### Feature 1 — Session State + Core Data Model
**Goal:** Establish the server-side session state and PatientProfile model used by all later features.

**Depends on:** None  
**Builds for:** All later features (questionnaire loop, scoring, safety, reports, benchmarking)

**Scope**
- Define PatientProfile shape (sessionStatus, completedAt, transcript, itemResponses, symptomSummary, riskFlags, questionState, sessionMeta).
- Define storage location and lifecycle for session state (chat-linked).
- Add minimal CRUD operations for session state.

**Boundaries**
- No UI changes.
- No RAG or embeddings.
- No benchmarking.

**Inputs**
- `chatId`, `userId`, `sessionMeta`.

**Outputs**
- Persisted PatientProfile with `sessionStatus="active"` on creation.

**Acceptance criteria**
- A session can be created and fetched by chatId.
- Session state supports incremental updates without overwriting unrelated fields.

**Questions**
- Do you want one PatientProfile per chat, or allow multiple profiles per chat?
- Where should PatientProfile persist (new table vs reuse existing message metadata)?
- Should sessionMeta include prompt/tool version strings now or later?

---

### Feature 2 — DSM-5 Level-1 Item Registry
**Goal:** Store canonical DSM-5 Level-1 items with stable IDs and metadata.

**Depends on:** Feature 1  
**Builds for:** Questionnaire engine, scoring, reporting

**Scope**
- Canonical item list with IDs, domain labels, and item text.
- Retrieval methods for pending items and ordering.

**Boundaries**
- No paraphrasing yet.
- No scoring.

**Inputs**
- None (static registry).

**Outputs**
- Fetchable canonical item list.

**Acceptance criteria**
- Item list is versioned and stable.
- Each item has `itemId`, `domain`, `text`.

**Questions**
- Confirm the exact DSM-5 Level-1 item set and ID scheme.
- Do you want a fixed order or allow adaptive ordering by domain priority?

---

### Feature 3 — Questionnaire Engine (Loop + Follow-up)
**Goal:** Implement the conversational loop that selects the next item and issues paraphrased questions.

**Depends on:** Features 1–2  
**Builds for:** Scoring, reporting

**Scope**
- `getNextQuestion(sessionId)` tool.
- Track `pendingItems`, `completedItems`, `followUpsNeeded`.
- One follow-up max per item.
- Paraphrase canonical item into a natural question.

**Boundaries**
- No scoring yet (separate feature).
- No safety hard-stop yet.

**Inputs**
- PatientProfile questionState.

**Outputs**
- Next question payload: itemId + questionText + isFollowUp + remainingCount.

**Acceptance criteria**
- Each item asked at most once + one follow-up.
- State updates reflect item progression.

**Questions**
- Do you want a standardized intro + scale explanation in the first question payload?
- Should follow-up ask for frequency explicitly if ambiguity is high?

---

### Feature 4 — Scoring + Evidence Extraction
**Goal:** Score responses with 0–4 anchors, ambiguity 1–10, evidence quotes, confidence.

**Depends on:** Features 1–3  
**Builds for:** Reporting, diagnosing

**Scope**
- `scoreResponse(sessionId, itemId, patientText, transcriptContext)` tool.
- Anchor-locked frequency mapping.
- Update itemResponses and transcript.

**Boundaries**
- No diagnose or report generation.
- No RAG.

**Inputs**
- Item response text + context.

**Outputs**
- Score, ambiguity, confidence, evidenceQuotes.

**Acceptance criteria**
- Responses always map to a 0–4 score.
- Ambiguity is recorded 1–10 with defined semantics.

**Questions**
- Should evidenceQuotes be raw spans or sentence-level quotes?
- How many quotes max per item?

---

### Feature 5 — Safety Detection + Hard-Stop
**Goal:** Detect risk signals on every patient message and hard-stop the session.

**Depends on:** Features 1–4  
**Builds for:** Reporting (safety path)

**Scope**
- Risk detection on every patient message.
- Immediate transition to SAFETY_STOP state.
- Escalation script response.
- Persist partial session with `terminated_for_safety`.

**Boundaries**
- No diagnostics or report if safety triggered.

**Inputs**
- Patient message text.

**Outputs**
- Escalation response + sessionStatus update.

**Acceptance criteria**
- Any safety trigger stops the questionnaire flow.
- No report or benchmark generated after safety stop.

**Questions**
- Confirm the exact escalation message copy for v1.
- Should the system suppress all tool calls after safety stop?

---

### Feature 6 — Diagnostician Core (Non-RAG)
**Goal:** Generate provisional impressions using the stored PatientProfile (no RAG yet).

**Depends on:** Features 1–5  
**Builds for:** Report generation, benchmarking

**Scope**
- `diagnose(sessionId, snapshot, diagnostic_mode)` tool.
- Output diagnoses + reasoning + citations placeholders (no DSM text yet).

**Boundaries**
- No RAG retrieval yet (Feature 8).

**Inputs**
- Frozen snapshot (transcript + itemResponses + symptomSummary).

**Outputs**
- Diagnoses list with confidence + reasoning.

**Acceptance criteria**
- Supports all three diagnostic modes.
- Multiple diagnoses allowed with confidence scores.

**Questions**
- Should citations be empty or use transcript quotes only in Phase 1?

---

### Feature 7 — Report Generation (Streamdown Artifact)
**Goal:** Generate final report artifact using diagnose() output.

**Depends on:** Features 1–6  
**Builds for:** Benchmarking UI

**Scope**
- `generateReport(sessionId, diagnosisResult)` returns streamdown.
- Sections: summary, domain table, item appendix, impressions, limitations.
- Evidence tags: `<sym>`, `<quote>`, `<med>`.

**Boundaries**
- No benchmarking yet.

**Inputs**
- PatientProfile + diagnose() output.

**Outputs**
- Streamdown report stored and rendered in artifact UI.

**Acceptance criteria**
- Report includes all required sections.
- Copy button available on artifact.

**Questions**
- Do you want the item appendix always expanded or collapsible in UI?

---

### Feature 8 — DSM RAG Ingestion + Retrieval
**Goal:** Ingest DSM PDF into pgvector and retrieve top-k passages for grounded diagnosis.

**Depends on:** Features 1, 6  
**Builds for:** Phase 2 benchmarking and improved diagnose()

**Scope**
- Admin-triggered ingestion job: PDF -> text -> chunks -> embeddings -> pgvector.
- `retrieveDsmPassages(queryState)` tool (top-k=5).
- Update diagnose() to include citations and ragUsed.

**Boundaries**
- No benchmarking yet.

**Inputs**
- DSM PDF (private blob).
- Query composed from symptomSummary + candidate diagnoses.

**Outputs**
- Retrieved chunks with citations used in diagnosis.

**Acceptance criteria**
- Ingestion job completes and indexes chunks.
- Diagnose() includes citations when ragUsed=true.

**Questions**
- Do you want chunking by section headings or fixed size only for v1?
- Confirm `k=5` and chunk size target (512/1024).

---

## Phase 2 (Benchmarking + Async Metrics)

### Feature 9 — Frozen Snapshot + Benchmark Run Model
**Goal:** Create frozen snapshot objects and storage for benchmark runs.

**Depends on:** Phase 1 Features 1–8  
**Builds for:** Benchmark execution + UI card

**Scope**
- Snapshot schema: transcript, itemResponses, symptomSummary, questionState, report, prompt/tool versions.
- BenchmarkRun schema: driver model, compared models (max 2), results per model.

**Boundaries**
- No evaluation metrics yet.

**Acceptance criteria**
- Snapshot is immutable after creation.
- Benchmark runs attach to chatId.

**Questions**
- Should benchmark runs be editable or append-only?

---

### Feature 10 — Benchmark Execution (Per-Chat)
**Goal:** Execute per-chat benchmarking pipeline on frozen snapshot.

**Depends on:** Feature 9  
**Builds for:** UI report card, async metrics

**Scope**
- Rerun diagnose() on driver + up to 2 comparison models.
- Compute readability metrics (FKG/GFI/FRE).
- Compute coherence proxy (embedding cosine).
- Compute explainability signals (tag counts, DSM clause refs, step list).
- Run judge rubric via fixed model.

**Boundaries**
- No BERTScore (async in next feature).

**Acceptance criteria**
- Benchmark run produces results for each model.
- Results persisted and retrievable by chatId.

**Questions**
- Should judge rubric run once per model or only for driver model in v1?

---

### Feature 11 — Benchmark Report Card UI
**Goal:** Display benchmark results in the chat UI and allow comparison.

**Depends on:** Feature 10  
**Builds for:** Async updates

**Scope**
- End-of-chat "Benchmark" button triggers a run.
- Render report card with key metrics per model.
- Optional side-by-side or tabbed comparison.

**Boundaries**
- No batch benchmark.

**Acceptance criteria**
- User can run benchmark and see results for up to 2 models.
- Report card updates when async metrics complete.

**Questions**
- Preferred comparison layout: tabs or side-by-side?

---

### Feature 12 — Async BERTScore Backfill
**Goal:** Compute true BERTScore asynchronously and append to benchmark results.

**Depends on:** Feature 10  
**Builds for:** Batch benchmarks (future)

**Scope**
- Queue job to compute BERTScore on transcript pairs.
- Append coherence_BERTScore to existing benchmark results.

**Boundaries**
- No batch aggregation yet.

**Acceptance criteria**
- Benchmark results update when job completes.
- UI indicates "pending" vs "complete" for BERTScore.

**Questions**
- Where should job status be surfaced: in report card or separate job panel?

