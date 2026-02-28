import { NextResponse } from 'next/server'

// POST /api/trigger-generator
// Body: { patent_number: string }
// Triggers content generation for a specific approved patent (used for retries).
export async function POST(request: Request) {
  const workerUrl = process.env.GENERATOR_WORKER_URL
  const workerSecret = process.env.GENERATOR_WORKER_SECRET

  if (!workerUrl || workerUrl.includes('YOURSUBDOMAIN')) {
    return NextResponse.json(
      { error: 'Generator worker not yet deployed. Set GENERATOR_WORKER_URL in environment.' },
      { status: 503 }
    )
  }

  let body: { patent_number?: string }
  try {
    body = await request.json() as { patent_number?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.patent_number) {
    return NextResponse.json({ error: 'patent_number required' }, { status: 400 })
  }

  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'x-worker-secret': workerSecret ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ patent_number: body.patent_number }),
    })

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json(
        { error: `Worker returned ${response.status}: ${text}` },
        { status: 502 }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    console.error('trigger-generator error:', err)
    return NextResponse.json({ error: 'Failed to reach generator worker' }, { status: 502 })
  }
}
