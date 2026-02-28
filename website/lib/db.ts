/**
 * D1 REST API client for Next.js on Vercel.
 *
 * Two databases:
 *   queryD1 / executeD1      → patent-tracker-db (CF_D1_DATABASE_ID)   — patents table, READ ONLY
 *   queryAppD1 / executeAppD1 → inventiongenie-db (APP_D1_DATABASE_ID)  — our tables, read/write
 *
 * IMPORTANT: Do NOT use getRequestContext() from @cloudflare/next-on-pages —
 * that only works on Cloudflare Pages deployments. This project deploys to Vercel.
 */

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID!
const APP_D1_DATABASE_ID = process.env.APP_D1_DATABASE_ID!
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!

interface D1Response<T> {
  result: Array<{
    results: T[]
    success: boolean
    meta: Record<string, unknown>
  }>
  errors: Array<{ message: string; code?: number }>
  success: boolean
}

async function d1Query<T>(databaseId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(30_000),
    }
  )

  if (!response.ok) {
    throw new Error(`D1 API HTTP error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as D1Response<T>

  if (!data.success) {
    const msg = data.errors?.map((e) => e.message).join(', ') || 'Unknown D1 error'
    throw new Error(`D1 query failed: ${msg}`)
  }

  return data.result?.[0]?.results ?? []
}

async function d1Execute(databaseId: string, sql: string, params: unknown[] = []): Promise<number> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(30_000),
    }
  )

  if (!response.ok) {
    throw new Error(`D1 API HTTP error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as D1Response<never>

  if (!data.success) {
    const msg = data.errors?.map((e) => e.message).join(', ') || 'Unknown D1 error'
    throw new Error(`D1 execute failed: ${msg}`)
  }

  return (data.result?.[0]?.meta as { changes?: number })?.changes ?? 0
}

// patent-tracker-db — patents table (READ ONLY)
export function queryD1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return d1Query<T>(CF_D1_DATABASE_ID, sql, params)
}

// inventiongenie-db — patent_scores, content_queue, published_content, prompts
export function queryAppD1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return d1Query<T>(APP_D1_DATABASE_ID, sql, params)
}

export function executeAppD1(sql: string, params: unknown[] = []): Promise<number> {
  return d1Execute(APP_D1_DATABASE_ID, sql, params)
}

// Keep executeD1 pointing to app DB for backwards compatibility with generate-image route
export function executeD1(sql: string, params: unknown[] = []): Promise<number> {
  return d1Execute(APP_D1_DATABASE_ID, sql, params)
}
