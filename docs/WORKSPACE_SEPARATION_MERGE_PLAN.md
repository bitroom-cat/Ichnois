# Global vs. Project-Level Workspace Separation: Integration & Merge Plan

## Executive Summary

This document outlines the architectural comparison and integration plan to merge the **Global vs. Project-Level Workspace Separation** feature cleanly into the `main` branch of Ichnoscope.

- **Target Branch (`main`):** Contains Supabase Auth, JWT verification, Team RBAC, GitHub App integration (`github_app.py`), dynamic GraphQL blame & issue publishing, and production cloud URLs (Vercel/Render).
- **Incoming Feature (`workspace-separation`):** Implements dual-mode workspace navigation (Global Fleet vs. Scoped Project Workspace), `WorkspaceContext`, Global Overview Operations Center (`/app/overview`), dedicated Project Workspace Hub (`/app/projects/[projectId]`), dynamic Sidebar navigation morphing, dual-tab Settings, and workspace telemetry metrics (`/api/workspace/metrics`).
- **Core Objective:** Integrate the full dashboard and workspace separation features without regressing, overwriting, or losing our Supabase authentication, GitHub App infrastructure, or production configurations.

---

## 1. Architectural Comparison Matrix

| Component / Layer | Current `main` Branch | Workspace Separation Feature | Merge / Harmonization Strategy |
| :--- | :--- | :--- | :--- |
| **Authentication & Login** | Supabase Auth (`@supabase/ssr`), GitHub OAuth + Email auth, production redirect handling, `middleware.ts` edge session guard. | Legacy/previous mock or hardcoded token login. | **KEEP `main` 100%:** Do not touch `web/src/app/(auth)/login/page.tsx`, `web/src/middleware.ts`, `web/src/app/auth/callback/route.ts`, or `@/lib/supabase`. |
| **GitHub App Integration** | `GitHubAppService` (`backend/ichnoscope/github_app.py`), RS256 JWT, installation tokens, dynamic blame & issue dispatch. | Legacy global PAT (`GITHUB_TOKEN` from `.env`). | **KEEP `main` & ENRICH:** Wire GitHub App connection modal and repo selector directly into the new Project Workspace Hub (`/app/projects/[projectId]`). |
| **Workspace State & Context** | Flat `localStorage` key (`ichnoscope_selected_project_id`) used only by `ProjectSwitcher.tsx`. | `WorkspaceContext.tsx`: Full `useWorkspace()` hook, managing `isGlobal`, `activeProject`, `projects`, sync with `?project=` URL param and `localStorage`. | **ADOPT WorkspaceContext:** Upgrade app shell (`web/src/app/app/layout.tsx`) with `<WorkspaceProvider>`. |
| **Navigation & Sidebar** | Static sidebar with basic project dropdown in header. | Dynamic Sidebar that morphs between Global Mode and Project Scoped Mode (Queues, Operations, Settings). | **ADOPT & ENHANCE:** Merge dynamic Sidebar morphing into `web/src/components/Sidebar.tsx` while preserving dark theme styling and responsive mobile drawers. |
| **Global Overview Page** | None (redirected straight to `/app/runs`). | `/app/overview`: Fleet-wide Operations Center, microservice grid with live queue badges, dual-gate visual workflow, webhook simulator. | **ADOPT NEW PAGE:** Add `web/src/app/app/overview/page.tsx`. |
| **Project Workspace Hub** | Single table list on `/app/projects`. | Dedicated Project Workspace Hub at `/app/projects/[projectId]/page.tsx` + `/app/projects/page.tsx`. | **HARMONIZE:** Combine our rich DSN/GitHub App management cards with their microservice hub layout. |
| **Backend Metrics & Scoping** | Basic `/api/runs?project_id=...` filter. | `GET /api/workspace/metrics`, project-scoped ingress `/api/{project_id}/store/`, and store metrics calculator. | **ADOPT BACKEND ENDPOINTS:** Add `/api/workspace/metrics` and store aggregation functions. Seed default microservices safely. |

---

## 2. Detailed File-by-File Integration Plan

### Area A: Frontend State & Navigation
1. **`web/src/context/WorkspaceContext.tsx` (New):**
   - Implement `WorkspaceProvider` and `useWorkspace()` hook.
   - Expose:
     - `currentWorkspace`: `'global' | string` (project_id)
     - `isGlobal`: `boolean`
     - `activeProject`: `Project | null`
     - `projects`: `Project[]`
     - `switchWorkspace(projectId: string | 'global')`
     - `refreshProjects()`
   - Sync with URL query param `?project=...` and fallback to `localStorage`.
   - Wrap in React `<Suspense>` boundaries to ensure static export and SSR compatibility with `useSearchParams()`.

2. **`web/src/app/app/layout.tsx`:**
   - Wrap the dashboard children in `<WorkspaceProvider>`.
   - Pass user profile from Supabase down to the navigation shell.

3. **`web/src/components/Sidebar.tsx`:**
   - Update navigation items based on `useWorkspace().isGlobal`:
     - **Global Mode:** Overview (`/app/overview`), Incidents (`/app/runs`), Projects (`/app/projects`), Global Settings (`/app/settings`), Service Health (`/app/connections`).
     - **Project Mode:** 
       - Queues: All Incidents, Staged Raw (Gate 1), Staged Draft (Gate 2), Published, Dismissed.
       - Operations: Releases, AI/Blame Synthesis, Draft Review, External Dispatches.
       - Config: Project Settings (`/app/projects/${activeProject.project_id}`).

4. **`web/src/components/Header.tsx`:**
   - Embed Workspace Switcher dropdown showing:
     - Global Fleet (All Projects)
     - Individual Microservices with environment badges (`production`, `staging`).
   - Breadcrumb navigation: `Workspace > [Active Project] > [Active View]`.

---

### Area B: New & Updated Pages
1. **`web/src/app/app/overview/page.tsx` (New):**
   - Fleet-wide telemetry cards: Active Incidents, Staged Raw (Gate 1), Staged Draft (Gate 2), Automated Fix Rate.
   - Microservice Fleet Grid: Each service card displays status tags, live Gate 1/2 badges, DSN key snippet, and "Open Workspace" jump button.
   - Dual-Gate Pipeline Architecture visual status.
   - Fleet-wide real-time incident feed with simulation modal.

2. **`web/src/app/app/projects/[projectId]/page.tsx` (New):**
   - Detailed microservice hub.
   - Displays:
     - Project identity & metadata (Name, ID, Environment, Rate Quota).
     - **GitHub Integration Card:** Connected repo link, GitHub App status badge, "Connect / Change Repository" modal trigger.
     - Sentry DSN configuration snippet (Python, Node/Next.js, cURL).
     - Scoped incident queues (Gate 1 Staged Raw, Gate 2 Drafts, Published).

3. **`web/src/app/app/settings/page.tsx`:**
   - Tab 1: **Global Settings** (Automation Policy modes, LLM Provider Fallbacks, Slack Webhook).
   - Tab 2: **Project Settings** (Active project identity, DSN key rotation, GitHub repository binding, Rate limits).

4. **`web/src/app/app/runs/page.tsx`:**
   - Read `project` filter from `useWorkspace()`.
   - Display a clean Workspace Scope Banner when operating in a scoped project context.

---

### Area C: Backend Scoping & Metrics
1. **`backend/ichnoscope/store.py` & `projects.py`:**
   - Add `get_workspace_metrics(project_id: str | None = None)`:
     - Calculates:
       - `total_runs`: Total incidents recorded
       - `staged_raw_count`: Gate 1 pending review
       - `staged_draft_count`: Gate 2 drafts pending sign-off
       - `published_count`: Dispatched to GitHub/Slack
       - `dismissed_count`: Ignored / False positives
       - `active_projects_count`: Number of active microservices
       - `avg_triage_latency_ms`: Benchmark average triage speed
   - Ensure default microservices (`checkout-service`, `auth-service`, `inventory-service`, `edge-gateway`) are seeded on initial start if database is empty.

2. **`backend/ichnoscope/api.py`:**
   - Add endpoint `GET /api/workspace/metrics`:
     - Accepts optional `?project_id=` query param.
     - Returns `WorkspaceMetricsResponse`.
   - Update `GET /api/runs`:
     - Filter strictly by `project_id` when provided; return aggregated fleet data when omitted or `'ALL_PROJECTS'`.
   - Ingress endpoints:
     - Support `/api/{project_id}/store/` and `/api/{project_id}/envelope/`.

---

### Area D: Client API & Types (`web/src/lib/api.ts`)
1. Add types:
   ```typescript
   export interface WorkspaceMetrics {
     total_runs: number;
     staged_raw_count: number;
     staged_draft_count: number;
     published_count: number;
     dismissed_count: number;
     active_projects_count: number;
     avg_triage_latency_ms: number;
   }

   export interface ProjectSummary extends Project {
     staged_raw_count?: number;
     staged_draft_count?: number;
     published_count?: number;
   }
   ```
2. Add API methods:
   - `api.getWorkspaceMetrics(projectId?: string): Promise<WorkspaceMetrics>`
   - `api.getProjectSummaries(): Promise<ProjectSummary[]>`

---

## 3. Strict Non-Regression Checklist

Before any merge is finalized, the following critical capabilities must be validated:

- [ ] **Supabase Authentication Intact:** Production GitHub OAuth and Email login flow functions with zero regressions.
- [ ] **GitHub App Token Resolution Intact:** `GitHubAppService` signs RS256 JWTs using `GITHUB_APP_PRIVATE_KEY` / `.pem` and links repositories dynamically.
- [ ] **Zero Cross-Project Data Leakage:** When viewing a project workspace, only incidents and runs matching that project are rendered.
- [ ] **No Localhost Hardcoding:** All API requests route dynamically via `BACKEND_URL` / `NEXT_PUBLIC_BACKEND_URL`.
- [ ] **Clean Compilation:** Both `pytest` and `npm run build` execute with 0 errors across all routes.
