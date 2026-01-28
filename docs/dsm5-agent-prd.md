# DSM-5 Research Agent PRD

## Summary
Therapist-facing DSM-5 Level-1 Cross-Cutting Symptom Measure agent that conducts a conversational screening interview, produces a structured symptom profile, generates provisional impressions, and benchmarks model performance on completed chats.

## Goals
- Administer DSM-5 Level-1 items conversationally with paraphrasing.
- Track item coverage and enforce completion rules.
- Score each item on a 0-4 frequency scale with evidence and ambiguity.
- Produce a structured report artifact in streamdown.
- Support model-agnostic execution (Vercel AI Gateway models).
- Provide per-chat benchmark report cards with rubric and metrics.

## Non-goals
- No medication prescribing.
- No formal differential diagnosis write-up (no explicit "rule-out" section or clinical decision tree). Multi-label provisional impressions are allowed.
- No clinical formulation.
- No EHR-style intake or demographic-heavy profiles.

## Users
- Primary: clinical therapist using the tool to create a DSM-5 screening profile.

## Diagnostic Modes
Configurable via `diagnostic_mode`:
- `screening`: symptom domains only, no disorder labels.
- `categorical`: DSM-5 disorder categories only.
- `diagnostic` (default): specific DSM-5 diagnoses, ranked with confidence (0-1).

## Core Data Model
PatientProfile (paper-faithful, symptom-centric):
```
PatientProfile {
  sessionStatus: "active" | "completed" | "terminated_for_safety"
  completedAt?: string
  transcript: { role: "patient" | "interviewer"; text: string; timestamp?: string }[]
  itemResponses: {
    itemId: string
    score: 0 | 1 | 2 | 3 | 4
    ambiguity: 1..10
    evidenceQuotes: string[]
    confidence?: number
  }[]
  symptomSummary: {
    domain: string
    severityAggregate: number
    notableSymptoms: string[]
  }[]
  riskFlags: {
    suicidalityMentioned: boolean
    selfHarmIdeation: boolean
    violenceRisk: boolean
    substanceAbuseSignal: boolean
  }
  questionState: {
    pendingItems: string[]
    completedItems: string[]
    followUpsNeeded: string[]
  }
  sessionMeta: {
    sessionId: string
    modelVersion: string
    promptVersion: string
    syntheticPersonaId?: string
  }
}
```

## DSM-5 Level-1 Coverage Rules
- Use official DSM-5 Level-1 items as canonical source of truth.
- Each item is asked once; at most one follow-up is allowed.
- If still ambiguous, assign a best-fit score and set ambiguity (1-10).

Ambiguity semantics:
- 1 = clear, unambiguous mapping to a frequency anchor.
- 10 = cannot determine frequency from text.

## Scoring Semantics (0-4 Frequency Anchors)
```
0: Not at all
1: Rarely (1-2 days)
2: Several days
3: More than half the days
4: Nearly every day
```
Mapping uses explicit anchors and evidence quotes. Severity is not inferred at item level.

## Safety Policy
Hard-stop conditions:
- Explicit suicidal intent or plan.
- Imminent self-harm or violence risk language.

Behavior on trigger:
- Stop questioning immediately.
- Output only a fixed escalation script.
- Persist partial data with `sessionStatus: "terminated_for_safety"`.
- No diagnostician, report, or benchmarking continues.

## Agent Loop (State Machine)
States:
- INTRO
- ASK_ITEM
- SCORE_ITEM
- FOLLOW_UP
- REPORT
- DONE
- SAFETY_STOP

Flow:
1) INTRO: warm professional intro, name the questionnaire, explain purpose and scale.
2) ASK_ITEM: select next pending item, paraphrase into a natural question.
3) SCORE_ITEM: score response, store evidence, update question state.
4) FOLLOW_UP: if ambiguous, ask one clarifying question for the same item.
5) Repeat until all items complete.
6) REPORT: generate structured streamdown report.
7) DONE.
8) SAFETY_STOP can be entered from any state.

## Tooling (Silent Approvals)
Minimum toolset (v1):
- `getNextQuestion(sessionId)` -> { itemId, canonicalText, questionText, isFollowUp, remainingCount }
- `scoreResponse(sessionId, itemId, patientText, transcriptContext)` -> { score0to4, ambiguity1to10, evidenceQuotes[], confidence, riskFlagsPatch }
- `diagnose(sessionId, snapshot, diagnostic_mode)` -> { diagnoses[], reasoning, citations, ragUsed }
- `storeSessionState(sessionId, patch)` -> persists PatientProfile deltas
- `retrieveDsmPassages(queryState)` -> top-k chunks with citations
- `generateReport(sessionId)` -> streamdown report content

Tooling notes:
- Risk detection runs on every patient message and can immediately enter SAFETY_STOP before scoring.
- Tools are server-side only and never exposed to the user.
- Tool inputs/outputs are validated against schemas.

## RAG Grounding
Source:
- Licensed DSM-5 PDF stored privately in object storage (Vercel Blob).
Ingestion (admin-triggered, queued):
- Extract -> chunk -> embed -> store in Postgres + pgvector.
Runtime:
- Build query from symptomSummary + candidate diagnoses + salient quotes.
- Retrieve top-k passages and pass to diagnostician for grounded reasoning.

Chunk schema:
```
Chunk {
  chunkId: string
  text: string
  embedding: vector(1536)
  source: {
    book: string
    pageStart?: number
    pageEnd?: number
    sectionPath?: string
  }
}
```

Embedding scope (v1):
- DSM-5 criteria/sections only (avoid non-diagnostic narrative sections).

Embedding model (locked):
- `openai/text-embedding-3-small` (1536 dims).

## Report Format (Streamdown)
1) Executive Summary
2) Symptom Domain Table (domain, aggregate score, evidence quotes)
3) Item-Level Appendix (23 items: score, ambiguity, quotes)
4) Provisional Impressions (mode-dependent, ranked, confidence 0-1)
5) Limitations (screening-only, ambiguity notes)

Evidence tagging:
- Symptoms: `<sym>`
- Quotes: `<quote>`
- Medical terms: `<med>`

## Benchmarking
Modes:
- Per-chat benchmark (in-product).
- Batch benchmark (offline research).

Snapshot (frozen):
- transcript
- itemResponses
- symptomSummary
- questionState
- retrieved DSM passages (optional)
- final report
- prompt/tool versions
- model ids

Per-chat benchmarks include:
- Conversation quality:
  - Coherence proxy (embedding cosine; synchronous)
  - Coherence (BERTScore; async in Phase 2)
  - Readability: FKG, GFI, FRE
- LLM Judge rubric (1-5) with fixed judge model.
- Explainability signals:
  - count of evidence tags
  - DSM clause refs
  - step-list present
- Diagnostic reasoning integrity:
  - evidence citations present
  - RAG usage reported

Judge model (locked):
- `openai/gpt-4.1` (temperature 0, schema output)

Comparison:
- Benchmark button runs diagnostician-only replays for driver + up to 2 comparison models.

## UI
- Chat-based interview.
- Report artifact with copy button.
- Benchmark report card at end-of-chat.
- Optional tabs or side-by-side comparison for benchmark runs.

## Backend and Storage
- Postgres + pgvector for chunk embeddings.
- Drizzle for schema/migrations.
- Background job system for ingestion and heavy metrics.
- Silent tool approvals.

## Base Prompts (Paper-faithful Templates)
These are baseline prompts to use and then customize per deployment. The structure and constraints should remain intact for benchmark stability.

### Interviewer (Therapist) Agent
```
You are a mental health screening interviewer.

Your task is to administer the DSM-5 Level-1 Cross-Cutting Symptom Measure
in a conversational, empathetic, and professional manner.

STRICT RULES:
- You must NOT provide diagnoses, interpretations, or clinical advice.
- You must NOT summarize or analyze symptoms.
- You must NOT skip items.
- You must ask one question at a time.
- You must complete all items unless a safety stop is triggered.
- You may ask at most ONE follow-up question per item if the response is unclear.
- If a response remains ambiguous after a follow-up, accept it and move on.

QUESTION STYLE:
- Paraphrase the item naturally; do not quote the DSM text verbatim.
- Ask in plain, conversational language.
- Maintain a neutral, supportive tone.
- Do not lead the respondent toward a particular answer.

PROCESS:
1) Identify the next pending DSM-5 Level-1 item.
2) Ask a single, clear question addressing that item.
3) Wait for the patient’s response.
4) Do not comment on the response.
5) Move to the next item.

INTRODUCTION REQUIREMENTS (first turn only):
- Explain that this is a screening questionnaire.
- Explain the 0–4 frequency scale in plain language.
- State that all questions should be answered based on the past two weeks.

SAFETY:
- If the patient expresses suicidal intent, self-harm intent, or imminent danger,
  stop immediately and output the safety escalation script.

You will be given:
- The canonical DSM item text (for internal reference only).
- The current session state (pending/completed items).

Output ONLY the next question to ask.
```

### Scoring / Extraction Agent
```
You are a symptom scoring assistant.

Your task is to score a single DSM-5 Level-1 item based on the patient’s response.

INPUTS:
- DSM-5 item description (canonical)
- Patient response text
- Conversation context

OUTPUT REQUIREMENTS:
Return a JSON object with:
- score: integer 0–4 (frequency-based)
- ambiguity: integer 1–10
- evidenceQuotes: exact quotes from the patient response
- confidence: 0–1 indicating scoring confidence
- riskFlagsPatch: any detected safety risks

SCORING SCALE:
0 = Not at all
1 = Rarely (1–2 days)
2 = Several days
3 = More than half the days
4 = Nearly every day

RULES:
- Choose the closest frequency match.
- If unclear, make a best-fit choice and increase ambiguity.
- Ambiguity = 1 means very clear; 10 means cannot determine.
- Evidence quotes must be exact substrings from the patient response.
- Do NOT interpret or diagnose.
- Do NOT invent information.
- Flag safety risks conservatively.

Return ONLY valid JSON matching the schema.
```

### Diagnostician Agent
```
You are a diagnostic reasoning assistant.

Your task is to generate provisional mental health impressions
based on a completed DSM-5 Level-1 screening interview.

INPUTS:
- Full conversation transcript
- Structured item scores with ambiguity
- Symptom domain summary
- Retrieved DSM-5 reference passages

OUTPUT MODES:
You must support three modes:
- screening: symptom domains only
- categorical: DSM-5 disorder categories
- diagnostic: specific DSM-5 diagnoses with confidence (0–1)

RULES:
- This is a SCREENING-BASED impression, not a definitive diagnosis.
- Base all conclusions on provided evidence only.
- Use retrieved DSM text to ground reasoning.
- Acknowledge ambiguity explicitly.
- Multiple diagnoses may be returned if supported.
- Do not speculate beyond available data.

EXPLAINABILITY REQUIREMENTS:
- Link each diagnosis to:
  - item scores
  - evidence quotes
  - DSM criteria references when applicable
- Use step-by-step reasoning.
- Tag:
  - symptoms with <sym>
  - quotes with <quote>
  - medical terms with <med>

FORMAT:
Return a structured object containing:
- summary
- diagnoses (name + confidence)
- reasoning steps
- limitations
- ragUsed: true/false
```

### LLM Judge Prompt (Benchmarking)
```
You are an expert evaluator of mental health screening conversations.

Evaluate the provided conversation and diagnostic report.

Score each criterion from 1 (poor) to 5 (excellent):
1) DSM-5 coverage completeness
2) Clinical relevance of questions
3) Logical flow and coherence
4) Diagnostic justification and explainability
5) Empathy and professionalism

RULES:
- Base scores only on the provided content.
- Do not introduce external medical knowledge.
- Provide a brief justification (1–2 sentences) per score.

Return valid JSON with scores and notes.
```

## Phased Delivery
Phase 1 (MVP):
- Interview loop + scoring + report artifact.
- RAG ingestion pipeline (admin-trigger, queued).
- Postgres + pgvector storage.
- Safety hard-stop.

Phase 2:
- Per-chat benchmarking with async BERTScore job.
- LLM judge rubric + explainability signals.
- Benchmark report card UI.

Phase 3:
- Batch benchmark runs and aggregate reports.
- Optional GROBID ingestion refinement.
