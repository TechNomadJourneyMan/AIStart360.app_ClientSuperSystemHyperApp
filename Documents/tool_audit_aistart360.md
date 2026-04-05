# 🛠️ AIStart360.app — Comprehensive Tool Audit
**Platform:** B2B Diagnostic Client Portal SaaS  
**Stack:** Next.js · Supabase/PostgreSQL · n8n · Claude API · Docker  
**Market:** Kazakhstan/CIS · SME clients · Multi-Agent AI Diagnostics

---

## 📊 Priority Matrix

| Category | Must-Have | Nice-to-Have |
|---|---|---|
| MCP Servers | Supabase, GitHub, Filesystem, n8n | Playwright, Brave Search |
| Boilerplates | Makerkit / Supastarter | ShipFast |
| AI Orchestration | Vercel AI SDK, LangGraph.js | Mastra |
| Observability | Langfuse | Helicone |
| Document Processing | pdf-parse, Tesseract.js | Unstructured |
| Auth/RBAC | @supabase/supabase-js | Casbin |

---

## 1. 🔌 MCP Servers — Must-Have for Claude Dev Workflow

> These connect your Claude Code / Cursor directly to your tools.

| Name | GitHub | ⭐ Stars | Why it matters for AIStart360 | Install Command |
|---|---|---|---|---|
| **Supabase MCP** | [supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp) | ~2.5k | Manage DB schema, RLS policies, Edge Functions, Storage — directly from Claude. Essential for Supabase-first dev. | `npx -y @supabase/mcp-server-supabase@latest` |
| **GitHub MCP** | [github/github-mcp-server](https://github.com/github/github-mcp-server) | ~7k | Manage repos, PRs, issues, branches from AI. Critical for CI/CD automation in multi-branch SaaS dev. | `npx -y @modelcontextprotocol/server-github` |
| **Filesystem MCP** | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | ~15k | Secure local file access with path whitelisting. Foundational for Claude to read/write project code. | `npx -y @modelcontextprotocol/server-filesystem /path/to/AI-Portal` |
| **n8n MCP** | [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp) | ~16.6k 🔥 | Gives Claude deep knowledge of ALL n8n nodes, properties, operations. Lets AI build/debug n8n workflows for diagnostic pipelines. | `npx -y n8n-mcp` |
| **Playwright MCP** | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | ~5k | Browser automation for E2E testing client portal flows, scraping competitor sites, automating onboarding QA. | `npx -y @playwright/mcp@latest` |
| **Brave Search MCP** | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search) | ~15k | Real-time web search for Claude. Useful for market research modules in diagnostic reports. | `npx -y @modelcontextprotocol/server-brave-search` |
| **Sequential Thinking MCP** | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | ~15k | Forces step-by-step reasoning. Critical for complex diagnostic logic and multi-agent planning tasks. | `npx -y @modelcontextprotocol/server-sequential-thinking` |

### 📄 Claude Desktop Config (`~/.claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--read-only"],
      "env": { "SUPABASE_URL": "...", "SUPABASE_SERVICE_ROLE_KEY": "..." }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/ansarisenoff/AI-Portal"]
    },
    "n8n": {
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": { "N8N_API_URL": "http://localhost:5678", "N8N_API_KEY": "..." }
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
```

> [!WARNING]
> **Never** connect Supabase MCP to production DB during development. Always use `--read-only` flag or a staging project.

---

## 2. ⚡ n8n Nodes & Templates — AI Agent Workflows

| Name | Type | URL | Why it matters for AIStart360 |
|---|---|---|---|
| **AI Agent Node** (Built-in) | Core Node | [n8n docs](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/) | The brain of the diagnostic pipeline. Supports tool-calling with Anthropic/Claude API natively. |
| **Supabase Vector Store** | Built-in | [n8n docs](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.vectorstoresupabase/) | Embeds/retrieves documents for RAG. Store diagnostic knowledge base in pgvector. |
| **PDF Extract** | Community Node | `n8n-nodes-document-generator` | Parse uploaded client documents (PDFs, DOCX) for diagnostic intake. |
| **Pinecone Assistant** | Built-in | [n8n docs](https://docs.n8n.io/integrations/builtin/cluster-nodes/) | All-in-one RAG pipeline — skips manual chunking/embedding. |
| **HTTP Request → Webhook** | Core | Native | Connect n8n workflows to Next.js API routes for HITL notifications and report delivery. |
| **Wait / Human-in-the-Loop** | Core | Native | Pause workflow for expert review — essential for HITL diagnostic approval. Maps directly to your Expert Review Dashboard. |
| **Firecrawl** | Community | [n8n-nodes-firecrawl](https://github.com/nicholasgriffintn/n8n-nodes-firecrawl) | Scrape competitor sites or market data for client diagnostic context. |

### 🔗 Key n8n Template IDs to Clone

```
# RAG Document Q&A Workflow
https://n8n.io/workflows/1960-rag-ai-agent-with-supabase-vector-store/

# AI-powered intake form processor 
https://n8n.io/workflows/2204-ai-powered-web-scraping-with-anthropic-claude/

# HITL Review with Wait Node
https://n8n.io/workflows/2148-human-in-the-loop-ai-review-workflow/
```

---

## 3. 🏗️ GitHub Boilerplates — Next.js + Supabase + Auth + AI

| Name | GitHub | ⭐ Stars | Key Features | Best For | Get Started |
|---|---|---|---|---|---|
| **Makerkit** (Paid) | [makerkit/next-supabase-saas-kit](https://github.com/makerkit/next-supabase-saas-kit) | ~3.5k | Multi-tenancy, RBAC, Team Management, Stripe, shadcn/ui, App Router | **B2B SaaS** ← Best for AIStart360 | `git clone` after purchase |
| **Supastarter** (Paid) | [supastarter/nextjs](https://supastarter.dev) | ~2k | i18n, RBAC, Billing, Admin Panel, Magic Link | Enterprise portals | Purchase at supastarter.dev |
| **next-saas-starter** (Free) | [leerob/next-saas-starter](https://github.com/leerob/next-saas-starter) | ~13k 🔥 | Vercel-optimized, Postgres, Stripe, Auth, App Router, TypeScript | Free baseline | `npx create-next-app -e https://github.com/leerob/next-saas-starter` |
| **Basejump** (Free) | [usebasejump/basejump](https://github.com/usebasejump/basejump) | ~1.5k | Supabase-native multi-tenant accounts, RLS helpers | Supabase-first portals | `npm install @usebasejump/next` |
| **Taxonomy** (Free) | [shadcn-ui/taxonomy](https://github.com/shadcn-ui/taxonomy) | ~20k 🔥 | shadcn/ui, Next.js App Router, MDX, TypeScript, Prisma | UI-focused starter | `npx create-next-app -e https://github.com/shadcn-ui/taxonomy` |

> [!IMPORTANT]
> For AIStart360's B2B multi-tenant architecture with RBAC, **Makerkit** is the top recommendation. It handles OrganizationID isolation out of the box — which maps directly to your client portal model.

---

## 4. 🧩 VS Code / Cursor Extensions — Full-Stack SaaS Productivity

| Name | Marketplace ID | Category | Why it matters |
|---|---|---|---|
| **Prisma** | `Prisma.prisma` | Database | Schema highlighting, IntelliSense, auto-format for `.prisma` files |
| **ESLint** | `dbaeumer.vscode-eslint` | Code Quality | Enforce Next.js rules, catch issues before build. Already in your stack. |
| **Prettier** | `esbenp.prettier-vscode` | Formatting | Format on save — keep codebase consistent across team |
| **GitLens** | `eamodio.gitlens` | Git | Blame annotations, commit history, PR context inline. Already active in your workflow. |
| **Thunder Client** | `rangav.vscode-thunder-client` | API Testing | Test Supabase REST/RPC calls, n8n webhooks without Postman |
| **Error Lens** | `usernamehw.errorlens` | DX | Shows TypeScript errors inline — critical for Next.js App Router |
| **Tailwind CSS IntelliSense** | `bradlc.vscode-tailwindcss` | Styling | Autocomplete for Tailwind classes — if using shadcn/ui |
| **Database Client** | `cweijan.vscode-database-client2` | Database | Browse Supabase PostgreSQL tables directly in VS Code |
| **Console Ninja** | `wallabyjs.console-ninja` | Debugging | See `console.log` output inline, next to code — zero context switch |
| **REST Client** | `humao.rest-client` | API | `.http` file-based API testing — good for documenting n8n webhook specs |
| **Excalidraw** | `pomdtr.excalidraw-editor` | Architecture | Sketch DB schemas and agent workflow diagrams inside VS Code |
| **GitHub Copilot** | `GitHub.copilot` | AI Coding | Inline autocomplete + `/explain` + `/fix`. Combine with Cursor for agentic tasks |

### 🔧 `.cursorrules` for AIStart360

Create `/Users/ansarisenoff/AI-Portal/.cursorrules`:

```markdown
# AIStart360 Development Rules

## Stack
- Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui
- Supabase (Auth + PostgreSQL + pgvector + Edge Functions)
- Prisma ORM for type-safe DB access
- Vercel deployment (stateless functions, no daemons)

## Architecture
- Multi-tenant by client_id — always include row-level security
- Never expose service_role key to client-side code
- Use server components by default, client components only for interactivity
- All AI calls via Vercel AI SDK (ai package) with streaming

## Naming Conventions
- Components: PascalCase, feature folders (e.g., /components/dashboard/admin/)
- API routes: /app/api/[resource]/route.ts
- DB queries: server-only via Supabase server client

## When writing code
- Always add TypeScript types, never use `any`
- Use Zod for all form validation
- Prefer server actions over API routes for mutations
```

---

## 5. 📦 npm Packages — Multi-Agent, Document Processing, Auth

### 🤖 AI Orchestration & Multi-Agent

| Package | npm | Why it matters for AIStart360 | Install |
|---|---|---|---|
| **ai** (Vercel AI SDK) | [vercel/ai](https://github.com/vercel/ai) ⭐20k | Core SDK for Claude integration in Next.js. Streaming, tool-calling, multi-step agents. Already your best bet with Vercel. | `npm install ai @ai-sdk/anthropic` |
| **@langchain/langgraph** | [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) ⭐5k | State machine-based multi-agent orchestration. Model `intake → analysis → HITL → report` as a graph with checkpointing. | `npm install @langchain/langgraph @langchain/core` |
| **mastra** | [mastraai/mastra](https://github.com/mastraai/mastra) ⭐7k | TypeScript-first all-in-one: agents + RAG + workflows + evals + memory. Integrates with Vercel AI SDK. | `npm install @mastra/core` |
| **@anthropic-ai/sdk** | [anthropic-ai/anthropic-sdk-js](https://github.com/anthropic-ai/anthropic-sdk-js) ⭐5k | Direct Claude API access when Vercel AI SDK abstraction isn't needed (e.g., complex tool use, vision). | `npm install @anthropic-ai/sdk` |

### 📄 Document Processing & RAG

| Package | npm | Why it matters for AIStart360 | Install |
|---|---|---|---|
| **pdf-parse** | [npm](https://www.npmjs.com/package/pdf-parse) | Parse uploaded client PDFs for diagnostic intake. Extract text from financial reports, business plans. | `npm install pdf-parse` |
| **tesseract.js** | [naptha/tesseract.js](https://github.com/naptha/tesseract.js) ⭐35k 🔥 | OCR for scanned documents. Handle Kazakhstan clients who upload image-based PDFs. | `npm install tesseract.js` |
| **@langchain/textsplitters** | [langchain-ai](https://github.com/langchain-ai/langchainjs) | Recursive character text splitting for RAG chunking. Works with pgvector in Supabase. | `npm install @langchain/textsplitters` |
| **mammoth** | [npm](https://www.npmjs.com/package/mammoth) | Extract text from `.docx` files — common business document format in CIS markets. | `npm install mammoth` |
| **xlsx** | [SheetJS](https://github.com/SheetJS/sheetjs) ⭐34k | Parse Excel files from clients (financial statements, KPI tables). | `npm install xlsx` |
| **sharp** | [lovell/sharp](https://github.com/lovell/sharp) ⭐29k | Image processing for document thumbnails, chart generation in reports. | `npm install sharp` |

### 🔐 Auth, RBAC & Multi-Tenancy

| Package | npm | Why it matters for AIStart360 | Install |
|---|---|---|---|
| **@supabase/supabase-js** | [supabase/supabase-js](https://github.com/supabase/supabase-js) ⭐7k | Core client. Use service role server-side, anon key client-side. Set up as @supabase/ssr for App Router. | `npm install @supabase/supabase-js @supabase/ssr` |
| **@usebasejump/next** | [usebasejump/basejump](https://github.com/usebasejump/basejump) | Pre-built Supabase multi-tenant account management with RLS helpers. Maps to your client isolation model. | `npm install @usebasejump/next` |
| **zod** | [colinhacks/zod](https://github.com/colinhacks/zod) ⭐33k 🔥 | Schema validation. Use for all form inputs, API payloads, env vars. Essential for type-safe onboarding flows. | `npm install zod` |
| **next-auth** | [nextauthjs/next-auth](https://github.com/nextauthjs/next-auth) ⭐24k | If you need OAuth providers (Google, LinkedIn). Supplement Supabase Auth. Already in your stack. | `npm install next-auth` |
| **casbin** | [casbin/casbin.js](https://github.com/casbin/casbin.js) ⭐2k | Fine-grained RBAC/ABAC beyond Supabase RLS. For complex permission rules (Admin > Expert > Client). | `npm install casbin` |

### 🎨 UI & Onboarding Wizard

| Package | npm | Why it matters for AIStart360 | Install |
|---|---|---|---|
| **react-hook-form** | [react-hook-form](https://github.com/react-hook-form/react-hook-form) ⭐41k 🔥 | Performant form management. Use for multi-step onboarding wizard. Already standard with shadcn/ui. | `npm install react-hook-form` |
| **@hookform/resolvers** | [react-hook-form/resolvers](https://github.com/react-hook-form/resolvers) | Connect Zod schemas to react-hook-form. Required for type-safe validation. | `npm install @hookform/resolvers` |
| **stepperize** | [stepperize/stepperize](https://github.com/stepperize/stepperize) ⭐1.5k | Headless type-safe stepper for wizard flows. Handles branching logic (e.g. industry-specific onboarding paths). | `npm install @stepperize/react` |
| **react-dropzone** | [react-dropzone](https://github.com/react-dropzone/react-dropzone) ⭐10k | Drag-and-drop file upload for Document Upload module. | `npm install react-dropzone` |

---

## 6. 🔭 LLM Observability & Monitoring — AI Agent Workflows

| Tool | GitHub | ⭐ Stars | Why it matters for AIStart360 | Integration |
|---|---|---|---|---|
| **Langfuse** | [langfuse/langfuse](https://github.com/langfuse/langfuse) ⭐10k 🔥 | Open-source, self-hostable. Track every diagnostic agent trace, cost per client, prompt versions. **Best for data sovereignty in CIS market.** | `npm install langfuse` |
| **Helicone** | [helicone/helicone](https://github.com/helicone/helicone) ⭐3k | Proxy-based logging — zero code change. Semantic caching saves Claude API costs. Drop-in for Anthropic SDK. | Change base URL to Helicone proxy |
| **LangSmith** | [langchain-ai/langsmith-sdk](https://github.com/langchain-ai/langsmith-sdk) ⭐1.5k | Best if using LangGraph.js for orchestration. Deep trace visualization for multi-step agent workflows. | `npm install langsmith` |
| **Portkey** | [portkey-ai/portkey-sdk](https://github.com/Portkey-AI/portkey-node-sdk) ⭐2k | Multi-LLM gateway with fallback routing. Route Claude → GPT-4 if rate limited. Cost guardrails per client. | `npm install portkey-ai` |
| **OpenTelemetry + Vercel** | [@vercel/otel](https://github.com/vercel/otel) | Native Vercel tracing. Use `waitUntil` for post-response telemetry without blocking user requests. | `npm install @vercel/otel` |

### 🛡️ Langfuse Self-Hosted Setup (Recommended for CIS data compliance)

```yaml
# docker-compose.yml addition for local/staging
langfuse:
  image: langfuse/langfuse:latest
  environment:
    - DATABASE_URL=postgresql://user:pass@postgres:5432/langfuse
    - NEXTAUTH_SECRET=your-secret
    - NEXTAUTH_URL=http://localhost:3002
  ports:
    - "3002:3000"
```

```typescript
// lib/ai/langfuse-client.ts
import Langfuse from "langfuse";

export const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  baseUrl: process.env.LANGFUSE_HOST, // self-hosted
});
```

---

## 7. 🔮 Claude/LLM-Specific Tools — Prompt Management & Evals

| Tool | Link | Why it matters |
|---|---|---|
| **Anthropic Workbench** | [console.anthropic.com](https://console.anthropic.com) | Test diagnostic prompts with real-time token counting. Free. Use for prompt iteration before production. |
| **Langfuse Prompt Management** | Built into Langfuse | Version-control prompt templates (diagnostic frameworks, report generators). Hot-reload without deploys. |
| **PromptFoo** | [github.com/promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) ⭐5k | Automated prompt evaluation/regression testing. Essential for ensuring diagnostic quality across updates. |
| **Braintrust** | [braintrustdata.com](https://braintrustdata.com) | LLM eval platform with dataset management. Good for A/B testing different diagnostic prompt strategies. |
| **Instructor** | [instructor-ai/instructor-js](https://github.com/instructor-ai/instructor-js) ⭐1k | Structured outputs from Claude using Zod. Force Claude to return typed JSON for diagnostic reports. |

---

## 🗺️ Architecture: How It All Connects

```
Client Portal (Next.js + Supabase)
    ↕ [Vercel AI SDK + @anthropic-ai/sdk]
    ↕ [Langfuse traces every call]
    
n8n Orchestration Layer
    ├── Intake Agent → pdf-parse + tesseract.js → pgvector
    ├── Diagnostic Agent → LangGraph.js → Claude API
    ├── HITL Wait Node → Expert Review Dashboard
    └── Report Agent → mammoth + xlsx → PDF generation

MCP Servers (Claude Code Dev Workflow)
    ├── Supabase MCP → manage DB schema, RLS
    ├── GitHub MCP → manage PRs, issues
    ├── n8n MCP → build/debug workflows
    └── Filesystem MCP → read/write project files

Observability Stack
    ├── Langfuse (self-hosted) → traces, costs, prompts
    ├── Vercel Analytics → frontend performance
    └── @vercel/otel → distributed tracing
```

---

## 🚀 Immediate Action Plan (Priority Order)

```bash
# Phase 1: MCP Setup (Today)
npm install -g @modelcontextprotocol/inspector  # debug MCP connections

# Phase 2: Core npm packages
npm install ai @ai-sdk/anthropic @anthropic-ai/sdk
npm install @supabase/ssr @supabase/supabase-js
npm install zod @hookform/resolvers react-hook-form
npm install pdf-parse mammoth xlsx tesseract.js sharp

# Phase 3: Observability
npm install langfuse @vercel/otel

# Phase 4: Multi-Agent (when scaling)
npm install @langchain/langgraph @langchain/core
# OR
npm install @mastra/core  # alternative if staying TypeScript-native
```

## 8. 📚 Awesome Lists & Data Engineering Resources

| Repository | Category | Why it matters |
|---|---|---|
| [kyrolabs/awesome-agents](https://github.com/kyrolabs/awesome-agents) | AI Agents | Curated list of AI Agent resources, frameworks, and tools. |
| [public-apis/public-apis](https://github.com/public-apis/public-apis) | APIs | A collective list of free APIs for use in software and web development. |
| [scraperai/scraperai](https://github.com/scraperai/scraperai) | Web Scraping | AI-powered web scraping capabilities for market research modules. |
| [MobileFirstLLC/social-media-hacker-list](https://github.com/MobileFirstLLC/social-media-hacker-list) | Social Media | Resources and APIs for social media data collection. |
| [firmai/python-business-analytics](https://github.com/firmai/python-business-analytics) | Business Analytics | Python techniques and tools for business analytics. |
| [ashishpatel26/500-AI-Machine-learning...](https://github.com/ashishpatel26/500-AI-Machine-learning-Deep-learning-Computer-vision-NLP-Projects-with-code) | AI Projects | Collection of 500 AI, ML, NLP projects with code for reference. |
| [0xnr/awesome-bigdata](https://github.com/0xnr/awesome-bigdata) | Big Data | Awesome list for big data frameworks, resources, and tools. |
| [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | AI Framework | Building applications with LLMs through composability. |
| [streamlit/streamlit](https://github.com/streamlit/streamlit) | Data Apps | Fast way to build and share data apps (potential internal dashboards). |
| [great-expectations/great_expectations](https://github.com/great-expectations/great_expectations) | Data Quality | Data testing, documentation, and profiling. |
| [ClickHouse/ClickHouse](https://github.com/ClickHouse/ClickHouse) | Database | Open-source columnar database management system for real-time analytics. |
| [keras-team/keras](https://github.com/keras-team/keras) | Deep Learning | Deep Learning for humans (if custom modeling is needed). |
| [mlflow/mlflow](https://github.com/mlflow/mlflow) | ML Ops | Open source platform for the machine learning lifecycle. |
| [getredash/redash](https://github.com/getredash/redash) | Data Viz | Connect to any data source, easily visualize, dashboard and share data. |
| [metabase/metabase](https://github.com/metabase/metabase) | Business Intelligence | The simplest, fastest way to share data and analytics inside the company. |
| [grafana/grafana](https://github.com/grafana/grafana) | Observability | The open and composable observability and data visualization platform. |
| [apache/superset](https://github.com/apache/superset) | Data Viz | Apache Superset is a Data Visualization and Data Exploration Platform. |

---

*Last updated: March 2026 | Stack: Next.js 15 + Supabase + n8n + Claude API + Vercel*
