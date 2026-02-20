# Patent Content Pipeline

AI-powered media brand that surfaces the most interesting expired patents and generates viral social content.

## Overview

This project uses the enriched patent data from [PatentSunset.com](https://patentsunset.com) to:
- Score ~320K+ expired patents for viral potential using Claude AI
- Generate multi-format content (Twitter, Facebook/LinkedIn, website pages)
- Drive traffic to monetized website pages with PatentSunset referrals

## Architecture

- **Frontend**: Next.js 15 on Vercel (admin + public website pages)
- **Backend**: Cloudflare Workers (AI scoring + content generation)
- **Database**: Cloudflare D1 (shared with patent-tracker)
- **AI**: Anthropic Claude (Haiku for scoring, Sonnet for content)

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Project conventions and AI guidelines
- **[TECHNICAL_SPEC.md](./TECHNICAL_SPEC.md)** - Database schemas, prompts, API integrations
- **[BUILD_GUIDE.md](./BUILD_GUIDE.md)** - Features, milestones, and build plan

## Project Structure

```
patent-content/
├── website/          # Next.js 15 app (not yet created)
├── workers/          # Cloudflare Workers (not yet created)
└── schema.sql        # D1 table definitions (not yet created)
```

## Status

📝 **Planning Phase** - Documentation complete, implementation not yet started.
