/**
 * Social image generation — 1080x1350 PNG (4:5 ratio, optimal for all social platforms).
 *
 * Node.js runtime (not edge) so we can use @aws-sdk/client-s3 for R2 upload.
 * next/og ImageResponse works in Node.js runtime since Next.js 14.1+.
 *
 * Flow:
 *   1. Generate branded PNG from patent diagram + overlay text
 *   2. If R2 is configured + patent_number provided: upload to R2, update content_queue.social_image_url
 *   3. Return PNG blob — client gets immediate preview regardless of R2 status
 *   4. X-Image-URL response header carries the permanent R2 URL (if upload succeeded)
 */

import { ImageResponse } from 'next/og'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { executeD1 } from '@/lib/db'

// ─── R2 client ────────────────────────────────────────────────────────────────
// Returns null when env vars aren't configured (local dev without R2 is fine).

function getR2Client(): S3Client | null {
  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null
  return new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let diagramUrl: string | null = null
  let overlayText = 'Patent Expired'
  let patentNumber: string | null = null

  try {
    const body = await request.json() as {
      diagramUrl?: string
      overlayText?: string
      patent_number?: string
    }
    diagramUrl = body.diagramUrl ?? null
    overlayText = body.overlayText ?? 'Patent Expired'
    patentNumber = body.patent_number ?? null
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  // Cap overlay text length to prevent layout overflow
  if (overlayText.length > 80) overlayText = overlayText.substring(0, 77) + '...'

  // ── Generate image ──────────────────────────────────────────────────────────

  const imageResponse = new ImageResponse(
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

  // Get buffer — consumes the ImageResponse body so we can re-use it
  const buffer = await imageResponse.arrayBuffer()

  // ── Upload to R2 ───────────────────────────────────────────────────────────
  // Non-blocking: upload failure does NOT prevent the image from being returned.
  // Without patent_number we still upload if configured (PublishedTab re-generates).

  let r2Url: string | null = null

  const r2 = getR2Client()
  const r2PublicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '') // strip trailing slash
  const bucketName = process.env.R2_BUCKET_NAME ?? 'patent-images'

  if (r2 && r2PublicUrl && patentNumber) {
    const filename = `${patentNumber}-social.png`
    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: filename,
          Body: Buffer.from(buffer),
          ContentType: 'image/png',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      )

      r2Url = `${r2PublicUrl}/${filename}`

      // Persist the permanent URL — the public patent page uses this for OG image
      await executeD1(
        `UPDATE content_queue SET social_image_url = ? WHERE patent_number = ?`,
        [r2Url, patentNumber]
      )
    } catch (err) {
      console.error(`R2 upload failed for ${patentNumber}:`, err)
      // Image still returned to client — R2 failure is non-fatal
    }
  }

  // ── Return image ───────────────────────────────────────────────────────────

  const headers: Record<string, string> = {
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store',
  }
  if (r2Url) headers['X-Image-URL'] = r2Url

  return new Response(buffer, { headers })
}
