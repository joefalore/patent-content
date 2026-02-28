import { NextResponse } from 'next/server'

export async function POST() {
  const workerUrl = process.env.SCORER_WORKER_URL
  const workerSecret = process.env.SCORER_WORKER_SECRET

  if (!workerUrl || workerUrl.includes('YOURSUBDOMAIN')) {
    return NextResponse.json(
      { error: 'Scorer worker not yet deployed. Set SCORER_WORKER_URL in environment.' },
      { status: 503 }
    )
  }

  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'x-worker-secret': workerSecret ?? '',
        'Content-Type': 'application/json',
      },
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
    console.error('trigger-scorer error:', err)
    return NextResponse.json({ error: 'Failed to reach scorer worker' }, { status: 502 })
  }
}
