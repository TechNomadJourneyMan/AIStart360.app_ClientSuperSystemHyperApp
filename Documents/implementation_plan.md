# Implementation Plan: AIStart360 Backend API & Multi-Agent AI Core

This plan synthesizes your requirements into a cohesive strategy that provides a **Master Architectural Blueprint** (Вариант 1 & 3) while prioritizing a **2-week Proof of Concept (PoC)** (Вариант 2).

## User Review Required

> [!IMPORTANT]
> **Feedback Needed:** I have proposed a combined 2-week PoC plan that lays the groundwork for the full enterprise architecture. Please review the architecture decisions (specifically using n8n vs. LangGraph in Next.js) and the 2-week sprint timeline. 
> 
> **Question:** Which variation is your absolute primary focus right now? 
> A) Creating the comprehensive blueprint for the whole team?
> B) Sprinting to build the PoC in 2 weeks yourself? 
> C) Setting up the heavy architectural framework first?
> 
> *I have leaned towards B in this plan, let me know if you agree!*

## 1. Architectural Blueprint (Вариант 3)

The architecture is designed to be **async**, **idempotent**, and **multi-tenant**.

- **A) Intake API**: Next.js Server Actions + Supabase Storage for secure, authenticated file uploads. Client portals fire webhooks to n8n upon upload completion.
- **B) Document Pipeline**: Next.js backend parses PDFs/Excel sheets (using `pdf-parse`, `xlsx`), normalizes text, and saves it to a `DocumentSummary` table before the heavy lifting starts. 
- **C) Agent Orchestration**: **n8n** handles the complex workflows (Routing -> Analysis -> Grading). 5 parallel AI agents hit the Claude API for specialized domains (Finance, Market, etc.), with a top-level Critic agent consolidating the output.
- **D) RAG System**: Supabase `pgvector`. Documents are chunked in Next.js using `@langchain/textsplitters` and embedded using OpenAI/Anthropic embeddings, then stored in a `DocumentChunk` table. n8n searches these chunks directly.
- **E) HITL (Human-in-the-Loop)**: n8n leverages a "Wait" node. The Next.js dashboard provides a UI for the expert. The expert clicks "Approve", which fires a webhook back to n8n to resume the flow.
- **F) Report Generation**: Next.js will use a headless browser or PDF library via an API route to generate beautiful, branded PDFs from the structured JSON data saved in Supabase by n8n.
- **G) Monitoring**: Track pipeline state in a `DiagnosticRun` Supabase table (Status: `pending` -> `analyzing` -> `hitl_review` -> `complete`).

---

## 2. 2-Week PoC Timeline (Вариант 2)

### Week 1: Intake, Parsing, and Basic AI Agent (Days 1-5)
**Goal:** Get data from the client, parse it, and generate a draft report through one agent automatically.

- **Day 1: Setup & Webhooks**
  - Create Supabase tables: `DiagnosticRun`, `DocumentChunk`.
  - Set up n8n instance and connect it to Supabase and Claude API.
- **Day 2: Next.js Intake API**
  - Implement `/api/diagnostics/trigger` route in Next.js to start an n8n webhook workflow.
  - Pass the uploaded file URLs and `client_id` to n8n asynchronously.
- **Day 3-4: Document Processing Pipeline**
  - Solidify parsing logic (`pdf-parse`, `xlsx`) in Next.js Server Actions. Text extraction should occur *before* passing the pure payload to n8n to reduce workflow complexity.
- **Day 5: Single-Agent Analysis (Claude API)**
  - Configure a LangChain AI Agent node in n8n.
  - Feed the document text to Claude 3.5 Sonnet to generate a structured JSON report. Save this JSON directly back to a `GriReport` row in Supabase via n8n.

### Week 2: RAG, HITL & PDF Export (Days 6-10)
**Goal:** Add context via RAG, verify with human QA, and export to PDF.

- **Day 6-7: RAG Implementation (pgvector)**
  - Implement chunking and embedding logic in Next.js upon document upload.
  - Insert vectors into Supabase. Setup the Supabase Vector Store node in n8n so the agent can do context lookups.
- **Day 8: Human-in-The-Loop (HITL) UI**
  - Add a "Wait for Webhook" node in n8n immediately following the AI step.
  - Create a Next.js Admin/Expert Review page where experts view the drafted JSON report, edit it if necessary, and click "Approve". 
  - The "Approve" button triggers the continuation webhook in n8n.
- **Day 9: Final PDF Generation**
  - After HITL approval, n8n sends the finalized payload to a Next.js `/api/generate-pdf` route.
  - Render a branded PDF report using `@react-pdf/renderer` or HTML-to-PDF, and save it to Supabase Storage.
- **Day 10: End-to-End Testing & Polish**
  - Perform stress tests from user onboarding to finalized PDF rendering. Add idempotency keys to webhooks so retries don't duplicate data.

## 3. Technologies & Key Configurations

- **Orchestrator**: `n8n` (Self-hosted or Cloud).
- **Core LLM**: Claude 3.5 Sonnet via Vercel AI SDK (`ai` package) and n8n Anthropic nodes.
- **Backend API**: Next.js API Routes / Server Actions.
- **Database + Embeddings**: Supabase (`pgvector`).
- **Observability**: `Langfuse` to monitor cost and traces of both Next.js and n8n Claude calls.

## Verification Plan

### Automated Verification
- Next.js API paths return 200 OK.
- n8n receives test webhook payload perfectly.
- Supabase RLS policies successfully sandbox `client_id` data.

### E2E Flow test
1. Upload mock PDF on Frontend.
2. Confirm vector extraction into `DocumentChunk`.
3. Confirm n8n process triggers and hits "Wait" status.
4. Verify HITL UI shows draft data. Approve it.
5. Verify PDF is generated and downloaded successfully.
