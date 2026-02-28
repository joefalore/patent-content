/**
 * D1 REST API client for Next.js on Vercel.
 *
 * IMPORTANT: Do NOT use getRequestContext() from @cloudflare/next-on-pages —
 * that only works on Cloudflare Pages deployments. This project deploys to Vercel.
 * Always use this REST API pattern for all Next.js D1 queries.
 */

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID!
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

export async function queryD1<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  )

  if (!response.ok) {
    throw new Error(`D1 API HTTP error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as D1Response<T>

  // D1 silently swallows some errors — always check both fields
  if (!data.success) {
    const msg = data.errors?.map((e) => e.message).join(', ') || 'Unknown D1 error'
    throw new Error(`D1 query failed: ${msg}`)
  }

  if (!data.result?.[0]) {
    return []
  }

  return data.result[0].results ?? []
}

/**
 * Execute a write query (INSERT, UPDATE, DELETE).
 * Returns the number of rows affected.
 */
export async function executeD1(sql: string, params: unknown[] = []): Promise<number> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
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
