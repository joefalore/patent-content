import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { password } = body
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const sessionToken = process.env.ADMIN_SESSION_TOKEN
  if (!sessionToken) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set('admin_session', sessionToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    // secure: true — enforced automatically by Vercel in production
  })

  return response
}
