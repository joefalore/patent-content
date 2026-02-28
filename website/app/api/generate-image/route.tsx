import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function POST(request: Request) {
  let diagramUrl: string | null = null
  let overlayText = 'Patent Expired'

  try {
    const body = await request.json() as { diagramUrl?: string; overlayText?: string }
    diagramUrl = body.diagramUrl ?? null
    overlayText = body.overlayText ?? 'Patent Expired'
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  // Cap overlay text length to prevent layout overflow
  if (overlayText.length > 80) overlayText = overlayText.substring(0, 77) + '...'

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: '#ffffff',
        }}
      >
        {/* Patent diagram — fills the top ~78% */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f8fafc',
            padding: '32px',
            overflow: 'hidden',
          }}
        >
          {diagramUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={diagramUrl}
              alt="Patent diagram"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
              }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                fontSize: '32px',
              }}
            >
              No diagram selected
            </div>
          )}
        </div>

        {/* Brand bar — bottom 22% */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '290px',
            backgroundColor: '#ffffff',
            borderTop: '6px solid #dc2626',
            padding: '28px 40px',
            gap: '14px',
          }}
        >
          <div
            style={{
              color: '#dc2626',
              fontSize: '17px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            InventionGenie
          </div>
          <div
            style={{
              color: '#111827',
              fontSize: '34px',
              fontWeight: 700,
              textAlign: 'center',
              lineHeight: 1.25,
            }}
          >
            {overlayText}
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
    }
  )
}
