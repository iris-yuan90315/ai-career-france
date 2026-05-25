## Goal

A single-user tool that surfaces AI-native Product Manager roles (remote or France) and lets you track them through your application pipeline.

## Pages

- **/** Dashboard — kanban (Interested · Applied · Interview · Offer · Rejected), counts, recent activity
- **/jobs** Job feed — list of scraped + manually-added roles with filters (remote/France, seniority, company, posted date, tags like "AI-native"); click to open detail drawer; "Save to pipeline" button
- **/companies** Curated company watchlist — add/edit/remove AI-native companies (Mistral, Hugging Face, Dust, Photoroom, Poolside, H, Owkin, etc.), each with careers URL and last-scraped timestamp; "Refresh" button
- **/preferences** Filters: location (Remote / France / Hybrid-France), seniority, keywords to include/exclude, comp range
- **/job/$id** Detail view: full JD, your notes, status, next action, contact, dates

## How jobs get in

1. **Curated companies**: for each company, store a careers URL. A "Refresh all" action calls a server function that uses Firecrawl `scrape` (or `map` + `scrape`) on each careers page, sends the markdown to Lovable AI (Gemini Flash) with a schema to extract `{title, location, url, description, seniority, is_ai_native, remote_ok, france_ok}`. New rows get inserted into `jobs`, deduped by URL.
2. **Job boards**: same flow, but seeded URLs for Welcome to the Jungle (AI PM search), LinkedIn search URL, YC Work at a Startup. Firecrawl `search` is also exposed as a manual "Search the web" action with your query + filters.
3. **Manual paste**: paste a URL → Firecrawl scrapes it → AI extracts → added to feed.

Relevance scoring: AI assigns a 0–100 fit score per job based on your `/preferences` (remote OR France, AI-native signals in description, seniority match). Feed sorts by score.

## Data (Lovable Cloud)

- `companies` (id, name, careers_url, notes, last_scraped_at)
- `jobs` (id, company_id nullable, title, location, remote_ok, france_ok, url unique, description, seniority, is_ai_native, fit_score, source, posted_at, scraped_at)
- `applications` (id, job_id, status enum, applied_at, notes, next_action, next_action_at, contact)
- `preferences` (single row: locations[], seniority[], keywords_include[], keywords_exclude[], min_comp)

Single-user → no auth, no RLS-per-user complexity. Tables open with permissive policies; we treat the deployed URL as private to you.

## Integrations needed

- **Lovable Cloud** — DB
- **Firecrawl connector** — scrape, map, search (server-side only)
- **Lovable AI Gateway** — extraction + fit scoring (Gemini Flash, free during promo)

## Technical notes

- All scraping / AI calls in `createServerFn` handlers under `src/lib/*.functions.ts`; never in loaders.
- Refresh runs on-demand (button) for v1. A scheduled cron via `/api/public/cron/refresh` can come later.
- Deduplication on `jobs.url` unique constraint.
- Seed ~15 AI-native companies on first load.

## Out of scope for v1

- Multi-user / login
- Resume tailoring, cover letters, interview prep (we picked discovery & tracking)
- Email alerts, browser extension, automatic daily refresh

## Build order

1. Enable Lovable Cloud + Firecrawl connector
2. Schema + seed companies
3. `/preferences` page
4. `/companies` page with refresh action
5. Job extraction server fn + `/jobs` feed with filters and fit score
6. Application kanban on `/`
7. Job detail + status updates
