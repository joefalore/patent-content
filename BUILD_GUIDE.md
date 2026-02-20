# Media Brand Content Engine - Build Guide

## What We're Building

An AI content flywheel that:
1. Finds the most viral expired patents from ~320K+ enriched expired patents in the patent-tracker D1 database
2. Generates SEO-optimized website pages + social media content
3. Drives traffic from Twitter/Facebook/LinkedIn to monetized website pages
4. Generates revenue through ads, affiliates, and PatentSunset referrals

**Core Value:** PatentSunset has valuable enriched patent data. We're building a media brand to surface the most interesting expired patents and monetize that content.

---

## Business Model

**Traffic Source:** Social media (Twitter, Facebook, LinkedIn)
**Traffic Destination:** YOURBRAND.com/patent/[slug] (SEO-optimized pages)
**Monetization:**
- PatentSunset.com referrals (SaaS conversions)
- Google AdSense (Phase 2)
- Patent attorney affiliate links (Phase 2)

**Content Strategy:**
- Educational media brand (not personal, not PatentSunset marketing)
- Focus on patents regular people actually care about (top 0.3% only)
- Subject-first, factual tone

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  PatentSunset.com (Existing Next.js on Vercel)                  │
│  - D1 Database: ~320K enriched expired patents                  │
│  - NO changes to this codebase                                  │
│  - Media brand READS from its D1 (read-only on patents table)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Reads patent data (D1 REST API)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  YOURBRAND.com (NEW Next.js 15 on Vercel)                       │
│  ├── /admin/content-pipeline (4 tabs)                           │
│  │   ├── Tab 1: Patent Review (approve/reject scored patents)   │
│  │   ├── Tab 2: Content Review (edit/approve generated content) │
│  │   ├── Tab 3: Published (view posted content)                 │
│  │   └── Tab 4: Prompts (edit scoring & content prompts)        │
│  ├── /patent/[slug] (public SEO pages)                          │
│  │   └── Monetized with PatentSunset CTAs (+ ads in Phase 2)   │
│  ├── /api/generate-image (social image generation via @vercel/og)│
│  └── API routes for triggering workers                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Triggers via API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Workers (AI Pipeline)                               │
│  ├── Patent Scorer Worker                                       │
│  │   ├── CPC as ordering + context (no hard skips — all classes│
│  │   │   eligible, A/H prioritized in batch ORDER BY)          │
│  │   ├── PatentsView API (fetch abstract per patent)           │
│  │   ├── Google Patents (quick diagram check)                  │
│  │   └── Claude Haiku (translate → plain English → then score) │
│  └── Content Generator Worker                                   │
│      ├── Google Patents (description + diagrams, approved only)│
│      └── Claude Sonnet (abstract + description → 4 formats)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

**Frontend (YOURBRAND.com):**
- Next.js 15 (App Router) — same version as PatentSunset for consistency
- TypeScript
- Tailwind CSS
- Radix UI (tabs, dialogs)
- `@vercel/og` (social image generation)
- Vercel deployment

**Backend (AI Pipeline):**
- Cloudflare Workers
- D1 Database (patent-tracker-db — existing, shared)
- R2 Storage (social media images)
- Anthropic Claude API:
  - Haiku for scoring (fast, cheap, structured output)
  - Sonnet for content generation (quality creative writing)

**Integrations:**
- PatentsView API (abstract for scoring only — already integrated in patent-tracker, rate limited to 45 req/min)
- Google Patents (description + diagram scraping for content generation — approved patents only, randomized timing)
- Twitter/Facebook/LinkedIn APIs (Phase 2)

---

## Database Strategy

**Use existing patent-tracker D1 database** (no new database needed).

**Why:**
- Current: 3.9GB used / 5GB free tier limit
- New tables add ~500KB/year
- Simpler architecture — one database, one set of credentials
- ~320K patents currently have `status='Expired' AND enriched=1` and are immediately available

**Important — patent pool reality:**
The D1 database has 6.5M patents total from bulk load, but only patents that have passed through the rolling window batch enrichment process have `calculated_expiration_date` and `status='Expired'`. Do NOT query the full 6.5M — only query `WHERE status = 'Expired' AND enriched = 1`. The current pool is ~320K and growing daily as the enrichment workers run.

**If you find a high-value patent (good title, clearly viral) that's missing `calculated_expiration_date`:**
Call `GET https://api.patentsunset.com/api/patent/{number}` — the PatentSunset API will enrich it on-demand and cache the result in D1.

**New tables to add** (see TECHNICAL_SPEC.md for full schema):
- `patent_scores` — AI scoring results + abstract
- `content_queue` — Generated content awaiting approval
- `published_content` — Published pages and social posts

**Important:** Media brand has READ-ONLY access to the `patents` table. Never UPDATE or DELETE from it. New data (scores, content, abstracts) goes into the new tables only.

---

## Scoring Data Strategy

The ODP API handles prosecution data only — it does not return patent text. Abstracts come from PatentsView.

**Scoring uses: title + abstract + CPC context + two-step translation.**

Claude Haiku first translates the abstract into one plain-English sentence before scoring. This surfaces the consumer-relevant angle that raw technical abstracts obscure. The plain-English translation is stored in `patent_scores.plain_english` and displayed in the admin panel — it's the single most useful field for understanding why a patent scored the way it did.

**CPC is context, not a filter.** All CPC sections are eligible. Velcro (class D), Teflon (class C), and toilet flush mechanisms (class E) are all potentially viral. Batches are ordered to surface A/H patents first (higher hit rate for 8+), but nothing is hard-excluded. Let Haiku decide — it's better at "is this interesting?" than a letter-level rule.

---

## Phase 1: Core Features (Build Now)

### Milestone 1: Patent Discovery & Scoring

**Feature 1.1: Batch Patent Scorer**
- Fetches 50 unscored expired patents from D1 (CPC pre-filter applied in query)
- Requirements: Must have title AND abstract (skip if PatentsView returns null)
- For each patent: fetch abstract from PatentsView API + check Google Patents for diagrams
- Claude Haiku scores each patent on 4 criteria (1-10 each):
  - Consumer relevance
  - Relatability
  - Explainability
  - Visual appeal (diagrams required — auto-reject if none)
- Keep ONLY 8+ scores
- Save scores + abstract to `patent_scores` table

**Feature 1.2: Patent Review Admin**
- Admin UI shows ALL scored patents with score >= 7 (not just 8+)
- Display per patent: number, title, overall score, individual sub-scores (consumer relevance, relatability, explainability, visual appeal), AI reasoning, diagram preview
- Visual distinction: 8+ patents highlighted as ready-to-approve, 7s shown in a separate band labeled "Review — potential gems"
- This lets you assess over time whether the 8+ threshold is right or whether viral gems are hiding at 7. Adjust the approval threshold in code once you have enough data.
- Actions: Approve (triggers content generation) or Reject (discards)
- Bulk operations: Select multiple, approve/reject all

**Success Criteria:**
- Can score 50 patents in <30 seconds
- Admin can approve 10 patents in <2 minutes
- Threshold calibration visible at a glance — no guessing whether 7s are being left behind

---

### Milestone 2: Content Generation

**Feature 2.1: Deep Research Step**
- For APPROVED patents only (cost control)
- Scrapes Google Patents for description (first 3000 chars) + top 3 diagram URLs — randomized request timing (1-3s delay), User-Agent header set
- PatentsView secondary text endpoints (`g_brf_sum_text`, `g_draw_desc_text`) confirmed unreliable in testing — do not use
- Abstract already in `patent_scores` — pulled forward, no extra API call
- Claude Sonnet receives: abstract + description → generates all content pieces

**Feature 2.2: Multi-Format Content Generator**
- Generates 4 pieces of content per patent using Claude Sonnet:
  1. **Twitter caption** (1-2 sentences, max 240 chars, NO URL)
  2. **Facebook/LinkedIn caption** (2-3 sentences, NO URL)
  3. **Website content** (2-3 sentence summary + 200-300 word insight section)
  4. **Social media image** (4:5 ratio via `/api/generate-image`, @vercel/og)
- All content follows media brand tone (educational, factual, subject-first)
- Saves to `content_queue` table with status='pending'

**Feature 2.3: Deterministic URL Slugs**
- Generate from patent number + title keywords
- Example: `US6025810-vertical-mouse-wrist-health`
- CRITICAL: Same input always produces same output — slug never changes once set

**Success Criteria:**
- Content generation for 1 patent completes in <60 seconds
- All 4 content pieces are high quality
- URLs are clean, SEO-friendly, stable

---

### Milestone 3: Content Review & Publishing

**Feature 3.1: Content Review Admin**
- Shows all generated content pending review
- Display for each patent:
  - Twitter caption (editable inline)
  - FB/LinkedIn caption (editable inline)
  - Website content (editable inline)
  - Social media image preview
  - Generated URL (copy button — always visible)
- Actions: Edit inline, Regenerate individual pieces, Approve, Reject
- Bulk operations available

**Feature 3.2: Website Page Publishing**
- Approval creates page at /patent/[slug]
- Page includes:
  - Hero: Largest diagram + title
  - Metadata: Patent #, assignee, filed/granted/expired dates, PTA, PTE, term adjustments
  - Summary: 2-3 sentences in plain English
  - Insights: 200-300 word section
  - Additional diagrams
  - PatentSunset CTA: natural integration linking to patentsunset.com
- SEO: Meta tags, Open Graph, structured data
- Mobile responsive

**Feature 3.3: Manual Social Posting**
- Copy buttons for: Twitter caption, FB/LinkedIn caption, URL, image download
- User manually posts to social platforms
- Mark as posted in admin (track which platforms)

**Success Criteria:**
- Can review and approve 10 posts in <10 minutes
- Website pages look professional
- Copy/paste workflow is smooth

---

### Milestone 4: Analytics & Monitoring

**Feature 4.1: Published Content Dashboard**
- Shows all published content with filters (date, platform, status)
- Manual entry: which platforms posted, date, notes

**Feature 4.2: Basic Stats**
- Total scored, approved, published, posted
- Approval rate (approved / scored) — use this to tune the 8+ threshold

**Feature 4.3: Scraper Health Monitoring**
- Admin banner warning if scrape failure rate exceeds threshold (e.g., >20% blocked/failed)
- `content_queue.scrape_status`, `scrape_attempts`, `scrape_error` fields enable circuit breaker pattern
- Allows manual pause of content generation if Google Patents blocks

---

## Phase 2: Automation & Optimization (Future)

**Do NOT build in Phase 1.**

- Automated social posting (Twitter/Facebook/LinkedIn APIs)
- Engagement metric tracking (pull from social APIs)
- AI self-learning (feed top performers back to scorer to improve picks — human approves updated prompts via Prompts tab before deploying)
- Auto queue refill (score more when approved queue drops below 10)
- Monetization controls (AdSense toggles, affiliate CTA toggles, revenue dashboard)

---

## Project Structure

```
patent-content/               # Homage to patent-tracker/
├── website/                  # Next.js 15 app (Vercel)
│   ├── app/
│   │   ├── admin/
│   │   │   └── page.tsx      # 3-tab admin: Patent Review, Content Review, Published
│   │   ├── patent/
│   │   │   └── [slug]/
│   │   │       └── page.tsx  # Public SEO page per patent
│   │   └── api/
│   │       ├── generate-image/
│   │       │   └── route.ts  # @vercel/og social image generation
│   │       ├── trigger-scorer/
│   │       │   └── route.ts  # Calls scorer Worker
│   │       └── trigger-generator/
│   │           └── route.ts  # Calls content generator Worker
│   ├── components/           # Admin UI components, patent page components
│   ├── lib/
│   │   └── db.ts             # D1 REST API client (same pattern as patent-tracker)
│   └── .env.local
├── workers/
│   ├── src/
│   │   ├── scorer.ts         # Batch scoring Worker
│   │   └── generator.ts      # Content generation Worker
│   └── wrangler.toml         # Both workers configured here
└── schema.sql                # D1 table definitions (run first)
```

---

## Build Plan

### Stage 1: Project Setup
1. Create new GitHub repo: `patent-content`
2. Initialize Next.js 15 app in `/website` directory
3. Initialize Cloudflare Workers in `/workers` directory
4. Set up Vercel project
5. **Create D1 tables first** (run schema.sql against patent-tracker-db)
   - Creates: `patent_scores`, `content_queue`, `published_content`, `prompts`
   - Seed `prompts` table with initial scoring and content generation prompts
6. Connect to patent-tracker D1 using D1 REST API (same pattern as patent-tracker's `lib/db/client.ts`)

### Stage 2: Patent Scorer Worker
1. Build Cloudflare Worker for batch scoring
2. D1 query with CPC pre-filter
3. PatentsView API integration for abstract fetching (rate limiter enforced — 45 req/min)
4. Google Patents lightweight diagram check (with US prefix on patent number) — use cautious approach: randomize request timing (1-3s random delay between checks, not batched), set a realistic User-Agent header, and stop gracefully if blocked rather than hammering retries
5. Claude Haiku integration for scoring
6. Save to `patent_scores` table (including abstract)
7. Test with real patent data

### Stage 3: Admin - Patent Review
1. Build Next.js admin layout with tabs
2. Tab 1: Patent Review interface
3. Fetch scored patents (8+ only) from D1
4. Display patent number, title, score, reasoning, diagram preview
5. Approve/reject actions + bulk operations
6. Connect to scorer worker via Next.js API route

### Stage 4: Content Generator Worker
1. Google Patents scrape: description (first 3000 chars) + up to 3 diagram URLs (randomized 1-3s delay, User-Agent header, graceful failure handling)
2. Abstract from `patent_scores` pulled forward (no extra API call)
3. Claude Sonnet content generation receives abstract + description → generates twitter caption, FB/LI caption, web content (no image yet)
4. Deterministic URL slug generator
5. Save all content + all 3 diagram URLs to `content_queue` with `scrape_status` tracking — image generation deferred to admin review
6. `social_image_url` left null until user selects diagram in admin

### Stage 5: Admin - Content Review
1. Tab 2: Content Review interface
2. Display all 4 content pieces (twitter, FB/LI, web content, URL)
3. **Diagram picker:** Show up to 3 patent diagram thumbnails side by side — user selects one. This is the most important creative decision — not all diagrams are equal. Some are schematics, some are recognizable product shots.
4. **"Generate Social Image" button:** Once diagram is selected, calls `/api/generate-image` with chosen diagram URL + overlay text → @vercel/og generates 4:5 PNG → uploads to R2 → displays preview in admin
5. User can re-pick a different diagram and regenerate if the first result isn't right
6. Inline editing for captions and web content
7. Regenerate buttons for individual content pieces
8. Copy buttons (captions, URL, image download)
9. Approve/reject actions (approve only available after image is generated)

### Stage 6: Website Public Pages
1. `/patent/[slug]` dynamic route
2. Page template: hero, metadata, summary, insights, diagrams, PatentSunset CTA
3. SEO: meta tags, Open Graph, JSON-LD structured data
4. Mobile responsive

### Stage 7: Publishing & Tracking
1. Approve flow triggers page creation
2. Tab 3: Published dashboard
3. Manual post tracking (platforms, date, notes)
4. Basic stats display

### Stage 8: Polish & Testing
1. Error handling throughout
2. Loading states
3. Success/error messages
4. Full end-to-end test: Score → Approve → Generate → Review → Publish → Post

---

## Key Success Metrics

**Phase 1 (First 30 Days):**
- Score 500+ patents
- Approve 50+ for content (target >10% approval rate)
- Publish 30+ website pages
- Post 30+ times to social
- Website pages start ranking for long-tail keywords
- Generate first PatentSunset referral conversions

**Phase 2 Target (Year 1):**
- 100K+ website visits/month
- 200+ published patent pages
- $2-3K/month revenue (ads + affiliates + SaaS)

**Long-term (Year 2):**
- 500K+ website visits/month
- 1,000+ published patent pages
- $15-20K/month revenue

---

## Important Constraints

### Must Haves:
- Title AND abstract required for scoring (abstract from PatentsView `/api/v1/patent/` — skip patent if null)
- CPC used for batch ordering only (A/H first) — no hard skips. All classes eligible.
- Scorer prompt translates abstract to plain English before scoring — `plain_english` stored in `patent_scores` and shown in admin
- Admin panel displays all 7+ patents to enable threshold calibration — approve at 8+ by default
- Only score expired patents (`status='Expired' AND enriched=1` in D1)
- Only approve 8+ scores for content generation (7s visible for threshold calibration)
- Deterministic URL slugs (never change once created)
- No URLs in social captions (added separately)
- Website publishes BEFORE social posting
- Google Patents URLs must use US prefix: `https://patents.google.com/patent/US{number}`

### Must NOT:
- Do NOT modify the PatentSunset codebase
- Do NOT UPDATE or DELETE from the `patents` table in D1 (read-only)
- Do NOT use `getRequestContext()` from `@cloudflare/next-on-pages` — this only works on Cloudflare Pages, not Vercel. Use D1 REST API for Next.js routes.
- Do NOT use the `canvas` npm package in Workers (native binaries not supported). Use `@vercel/og` in a Next.js API route for image generation.
- Do NOT generate the social image during content generation — defer to admin review so user can pick the best diagram first.
- Do NOT auto-post to social in Phase 1
- Do NOT add ads/affiliate toggles in Phase 1

### Cost Targets:
- <$0.70 per post generated (scoring with Haiku + content with Sonnet + image)
- <$35/month total AI costs in Phase 1 (30-50 posts/month)

---

## Deployment

**Website (YOURBRAND.com):**
- Platform: Vercel
- Domain: TBD
- Environment variables (see TECHNICAL_SPEC.md for full list with actual values):
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CF_D1_DATABASE_ID` (note: CF_ prefix, not CLOUDFLARE_)
  - `CLOUDFLARE_API_TOKEN` (note: API_TOKEN, not D1_TOKEN)
  - `PATENTSVIEW_API_KEY`
  - `SCORER_WORKER_URL`
  - `GENERATOR_WORKER_URL`

**Workers:**
- Platform: Cloudflare Workers
- Secrets (via wrangler): `ANTHROPIC_API_KEY`, `PATENTSVIEW_API_KEY`
- D1 binding: `patent-tracker-db`

**Database:**
- Use existing patent-tracker D1 (database ID in TECHNICAL_SPEC.md)
- Add 3 new tables — run schema.sql BEFORE deploying workers

---

## Questions / Issues

**For Claude Code:**
- Reference TECHNICAL_SPEC.md for schemas, prompts, and implementation details
- All code is TypeScript
- Next.js 15 App Router conventions
- Tailwind for styling
- D1 REST API for Next.js routes, D1 binding for Workers
- Proper error handling everywhere

**For Operator:**
- Admin interface should be intuitive (no training needed)
- Copy/paste workflow should be smooth
- Clear feedback on all actions (loading states, success messages)
- Can pause/resume at any milestone
