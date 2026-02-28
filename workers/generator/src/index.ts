/**
 * Patent Content Generator Worker
 * Triggered by Next.js API route when a patent is approved in the admin.
 * Scrapes Google Patents for description + diagrams, then generates
 * all content formats with Claude Sonnet.
 */

export interface Env {
  DB: D1Database
  R2_BUCKET: R2Bucket
  ANTHROPIC_API_KEY: string
  WORKER_AUTH_SECRET: string
  DOMAIN: string
}

const CONTENT_MODEL = 'claude-sonnet-4-6'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'method', 'system', 'apparatus', 'device',
  'using', 'based', 'having', 'from', 'that', 'this', 'into', 'upon',
  'thereof', 'wherein', 'said', 'each', 'plurality', 'improved', 'novel',
])

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatentData {
  patent_number: string
  score: number
  abstract: string | null
  title: string
  assignee_name: string | null
  calculated_expiration_date: string | null
  approved_for_content: number
}

interface GeneratedContent {
  caption_twitter: string
  caption_fbli: string
  web_summary: string
  web_insights: string
  image_overlay_text: string
}

interface GenerateResult {
  success: boolean
  patent_number?: string
  slug?: string
  url?: string
  diagrams_found?: number
  scrape_status?: string
  message?: string
  error?: string
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const authHeader = request.headers.get('x-worker-secret')
    if (!authHeader || authHeader !== env.WORKER_AUTH_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }

    let body: { patent_number?: string }
    try {
      body = await request.json() as { patent_number?: string }
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.patent_number) {
      return Response.json({ success: false, error: 'patent_number required' }, { status: 400 })
    }

    const result = await generateContent(body.patent_number, env)
    return Response.json(result)
  },
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

async function generateContent(patentNumber: string, env: Env): Promise<GenerateResult> {
  // 1. Fetch patent data
  const patent = await fetchPatentData(patentNumber, env)
  if (!patent) {
    return { success: false, error: 'Patent not found or not approved for content' }
  }

  // 2. Idempotency check — skip if already generated (unless failed)
  const existing = await env.DB
    .prepare('SELECT id, status FROM content_queue WHERE patent_number = ?')
    .bind(patentNumber)
    .first<{ id: number; status: string }>()

  if (existing && existing.status !== 'failed') {
    return { success: true, message: 'Already generated', status: existing.status } as GenerateResult
  }

  // 3. Scrape Google Patents for description + diagrams
  let images: string[] = []
  let description = ''
  let scrapeStatus = 'scraped'
  let scrapeError: string | null = null

  try {
    const scraped = await scrapePatentForContent(patentNumber)
    images = scraped.images
    description = scraped.description
  } catch (err) {
    scrapeStatus = 'failed'
    scrapeError = (err as Error).message
    console.error(`Scrape failed for ${patentNumber}:`, err)
    // Continue — abstract alone is enough for content generation
  }

  // 4. Generate content with Claude Sonnet
  let content: GeneratedContent | null = null
  let contentError: string | null = null

  try {
    content = await generateWithSonnet(patent, description, env)
  } catch (err) {
    contentError = (err as Error).message
    console.error(`Content generation failed for ${patentNumber}:`, err)
  }

  const slug = generateSlug(patentNumber, patent.title)
  const urlFull = `https://${env.DOMAIN}/patent/${slug}`

  // 5. Save to content_queue
  if (!content) {
    // Save with failed status — can be retried
    await env.DB
      .prepare(`
        INSERT INTO content_queue (
          patent_number, score, diagram_urls, url_slug, url_full,
          scrape_status, scrape_attempts, scrape_error, status
        ) VALUES (?, ?, ?, ?, ?, 'failed', 1, ?, 'pending')
        ON CONFLICT(patent_number) DO UPDATE SET
          scrape_status = 'failed',
          scrape_attempts = scrape_attempts + 1,
          scrape_error = excluded.scrape_error
      `)
      .bind(
        patentNumber,
        patent.score,
        JSON.stringify(images),
        slug,
        urlFull,
        contentError ?? scrapeError,
      )
      .run()

    return { success: false, error: contentError ?? scrapeError ?? 'Unknown error' }
  }

  await env.DB
    .prepare(`
      INSERT INTO content_queue (
        patent_number, score,
        diagram_urls,
        caption_twitter, caption_fbli, web_summary, web_insights, image_overlay_text,
        url_slug, url_full,
        scrape_status, scrape_attempts, scrape_error,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending')
      ON CONFLICT(patent_number) DO UPDATE SET
        diagram_urls = excluded.diagram_urls,
        caption_twitter = excluded.caption_twitter,
        caption_fbli = excluded.caption_fbli,
        web_summary = excluded.web_summary,
        web_insights = excluded.web_insights,
        image_overlay_text = excluded.image_overlay_text,
        url_slug = excluded.url_slug,
        url_full = excluded.url_full,
        scrape_status = excluded.scrape_status,
        scrape_attempts = scrape_attempts + 1,
        scrape_error = excluded.scrape_error,
        status = 'pending'
    `)
    .bind(
      patentNumber,
      patent.score,
      JSON.stringify(images),
      content.caption_twitter,
      content.caption_fbli,
      content.web_summary,
      content.web_insights,
      content.image_overlay_text,
      slug,
      urlFull,
      scrapeStatus,
      scrapeError,
    )
    .run()

  return {
    success: true,
    patent_number: patentNumber,
    slug,
    url: urlFull,
    diagrams_found: images.length,
    scrape_status: scrapeStatus,
  }
}

// ─── D1 data fetching ─────────────────────────────────────────────────────────

async function fetchPatentData(patentNumber: string, env: Env): Promise<PatentData | null> {
  return env.DB
    .prepare(`
      SELECT
        ps.patent_number, ps.score, ps.abstract, ps.approved_for_content,
        p.title, p.assignee_name, p.calculated_expiration_date
      FROM patent_scores ps
      JOIN patents p ON p.patent_number = ps.patent_number
      WHERE ps.patent_number = ? AND ps.approved_for_content = 1
    `)
    .bind(patentNumber)
    .first<PatentData>()
}

// ─── Google Patents scraper ───────────────────────────────────────────────────

async function scrapePatentForContent(patentNumber: string): Promise<{ images: string[]; description: string }> {
  // Randomized delay — cautious approach for low-volume approved patents
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))

  const url = `https://patents.google.com/patent/US${patentNumber}`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  })

  if (response.status === 403 || response.status === 429) {
    throw new Error(`Google Patents blocked: HTTP ${response.status}`)
  }

  if (!response.ok) {
    throw new Error(`Google Patents returned HTTP ${response.status}`)
  }

  const html = await response.text()

  // Extract unique diagram URLs (top 3 PNGs from Google's CDN)
  const imageRegex = /https:\/\/patentimages\.storage\.googleapis\.com\/[^"'\s]+\.png/g
  const images = [...new Set(
    Array.from(html.matchAll(imageRegex)).map(m => m[0])
  )].slice(0, 3)

  // Extract description section (first 3000 chars of clean text)
  const descMatch = html.match(/<section itemprop="description">([\s\S]+?)<\/section>/)
  const description = descMatch ? stripHtml(descMatch[1]).substring(0, 3000) : ''

  return { images, description }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Claude Sonnet content generation ────────────────────────────────────────

async function generateWithSonnet(
  patent: PatentData,
  description: string,
  env: Env,
): Promise<GeneratedContent> {
  // Fetch active content_generation prompt from D1
  const promptRow = await env.DB
    .prepare(`
      SELECT prompt_text FROM prompts
      WHERE prompt_type = 'content_generation' AND is_active = 1
      ORDER BY version DESC LIMIT 1
    `)
    .first<{ prompt_text: string }>()

  if (!promptRow) throw new Error('No active content_generation prompt found in DB')

  // Fill template placeholders
  const prompt = promptRow.prompt_text
    .replace(/\{\{patent_number\}\}/g, patent.patent_number)
    .replace(/\{\{title\}\}/g, patent.title)
    .replace(/\{\{abstract\}\}/g, patent.abstract ?? 'No abstract available')
    .replace(/\{\{description\}\}/g, description || 'No detailed description available')
    .replace(/\{\{assignee\}\}/g, patent.assignee_name ?? 'Unknown assignee')
    .replace(/\{\{expiration_date\}\}/g, patent.calculated_expiration_date ?? 'Unknown')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CONTENT_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Claude API error ${response.status}: ${await response.text()}`)
  }

  const data = await response.json() as { content: { text: string }[] }
  const raw = data.content[0].text.trim()

  // Strip markdown code fences if present
  const jsonText = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()

  let result: GeneratedContent
  try {
    result = JSON.parse(jsonText) as GeneratedContent
  } catch {
    throw new Error(`Failed to parse Sonnet response as JSON: ${jsonText.substring(0, 200)}`)
  }

  // Validate required fields
  const required: (keyof GeneratedContent)[] = [
    'caption_twitter', 'caption_fbli', 'web_summary', 'web_insights', 'image_overlay_text',
  ]
  for (const field of required) {
    if (!result[field]) throw new Error(`Sonnet response missing field: ${field}`)
  }

  // Enforce Twitter 240-char limit
  if (result.caption_twitter.length > 240) {
    result.caption_twitter = result.caption_twitter.substring(0, 237) + '...'
  }

  return result
}

// ─── Slug generator ───────────────────────────────────────────────────────────

function generateSlug(patentNumber: string, title: string): string {
  const keywords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 5)
    .join('-')

  return `${patentNumber.toLowerCase()}-${keywords}`
}
