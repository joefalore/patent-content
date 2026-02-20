# AI Content Pipeline — Project Conventions

## Claude's Role
You are a senior SWE architect. Propose the right solution, not the easy one. If something is architecturally wrong, say so. Don't gold-plate simple tasks, but don't cut corners on decisions that are hard to reverse.

Always think through the solution and ensure it fits with the objective, goal, and current code/architecture before writing a single line.

Take a deep breath before beginning. Check your work before presenting it.

Be direct and concise. The user is not deeply technical — provide clear, step-by-step guidance when action is required.

## Claude Behavior
- Always give terminal commands as a single copy-pasteable line. Never break a command across multiple lines. Use `&&` to chain commands.
- Commit messages: concise short title only, no bullet point lists. Never include a `Co-Authored-By` line or any Claude/Anthropic attribution.
- Never use em dashes (--). Use a comma, period, or rewrite the sentence.
- Routine operations (git add/commit/push, wrangler deploy) can be done without asking. Anything that adds new dependencies, introduces new services, changes architecture, or has external side effects must be explained and agreed on before doing it.

## Workflow & Sign-off Protocol
**CRITICAL: Never make big changes until finalized. Always get explicit approval before editing docs or making architectural changes.**

The correct workflow is:
1. **Analyze** - Read the relevant files, identify gaps, errors, or improvements needed
2. **Present** - Show findings, answer all questions, explain trade-offs
3. **Get sign-off** - Wait for explicit "yes, update the docs" or "lock it in" confirmation
4. **Execute** - Only then make the changes

### What Counts as a "Big Change"
- Updating technical specification documents
- Updating build guides or architecture docs
- Adding/removing dependencies
- Changing database schemas
- Architectural decisions that are hard to reverse
- Anything affecting multiple files or components

### Technical Errors vs Design Decisions
Not everything that differs from a technical spec is wrong. Distinguish between:

- **Technical errors** - Wrong env var names, incorrect API endpoints, broken code patterns. Fix these after explaining what's wrong.
- **Design decisions** - Things like char limits (240 vs 280), delay timing (1-3s vs 1-4s), CPC filtering strategies. These may be intentionally conservative or based on previous testing. **Always ask before changing these.**

If uncertain whether something is an error or a decision, ask first.

### Consistency is Critical
- If docs say 1-3s delay, conversation should say 1-3s delay (not 1-4s)
- If we aligned on 240 chars, don't change to 280 without asking
- What you say in analysis must match what you write in docs
- Inconsistency wastes tokens and erodes trust

### When to Make Decisions vs When to Ask
- **Make the call**: Architecture trade-offs, technology choices, implementation patterns when you have clear expertise
- **Always ask**: Anything with cost implications, user-facing changes, or where multiple valid approaches exist and user preference matters

## Deployment
- **Next.js / frontend**: `git push` to main auto-deploys via Vercel. Never run `npm run build` locally.
- **Cloudflare Workers**: `wrangler deploy` from the workers directory.
- These are separate deploys. Changing app code does not require wrangler and vice versa.

## Database (Cloudflare D1)
This project reads from (and may write to) the D1 database that powers patentsunset.com. D1 is SQLite-based. Access via the Cloudflare D1 REST API from Next.js, or via D1 binding (`env.DB`) from a Cloudflare Worker.

### D1 REST API Pattern (from Next.js / server code)
```typescript
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: 'SELECT ...', params: [] }),
  }
)
const data = await response.json()
// rows are in data.result[0].results
```

### D1 Gotchas
- D1 errors are swallowed silently — unknown column names cause SELECT to return `[]` with no error. Always verify column names against the schema before writing queries.
- Column is `title` (not `patent_title`). Use `title AS patent_title` in SELECT if you need the alias.
- `grant_date` is confirmed in the schema.

### `patents` Table — Key Columns
```sql
patent_number TEXT PRIMARY KEY
application_number TEXT
patent_type TEXT          -- 'utility' | 'design' | 'plant'
filing_date TEXT
grant_date TEXT
issue_date TEXT
title TEXT
assignee_name TEXT
inventor_names TEXT       -- JSON array
cpc_section TEXT          -- CPC classification (e.g. 'A', 'H', 'G')
tech_category TEXT
has_benefit INTEGER       -- 1 if continuation/divisional
pta_days INTEGER
pte_154_days INTEGER
pte_156_days INTEGER
td_exists INTEGER
mf_status TEXT            -- 'lapsed' or null
mf_lapse_date TEXT
calculated_expiration_date TEXT
expiration_reason TEXT
status TEXT               -- 'Live' | 'Expiring Soon' | 'Expired'
enriched INTEGER          -- 1 = fully enriched with USPTO data
```

### Querying Expired Patents
```sql
SELECT patent_number, title, assignee_name, cpc_section, calculated_expiration_date
FROM patents
WHERE status = 'Expired'
  AND enriched = 1
ORDER BY calculated_expiration_date DESC
LIMIT 100
```

## Environment Variables
```bash
# Cloudflare D1
CLOUDFLARE_ACCOUNT_ID=b34c5595fe31de047a416c904ba0ba16
CF_D1_DATABASE_ID=5cedf456-980d-4276-8d4d-bdf169d92cf4
CLOUDFLARE_API_TOKEN=Gd4iBZoRBCSG0AMhAizhvi-uo0VYqKR5v1hGWrQe

# PatentsView API (for patent abstracts and metadata)
PATENTSVIEW_API_KEY=TgG5YzMC.mKgJAQFg1g3dy8EGMQovw6m63hrcnOu9

# Patent Sunset backend API (on-demand patent lookups)
NEXT_PUBLIC_API_URL=https://api.patentsunset.com
```

## Patent Sunset Backend API
On-demand patent lookup (use D1 REST directly for bulk reads):
```
GET https://api.patentsunset.com/api/patent/{patent_number}
```
Returns full expiration calculation with PTA, PTE, TD, MF status, and expiration reason.
