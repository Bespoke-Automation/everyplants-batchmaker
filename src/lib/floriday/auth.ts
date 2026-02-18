// ══════════════════════════════════════════════════════════════
// Floriday OAuth2 Client Credentials Authentication
// ══════════════════════════════════════════════════════════════
//
// Token wordt gecached in-memory met een veiligheidsmarge van
// 5 minuten voor verloop. Bij server restart wordt automatisch
// een nieuw token opgehaald.

const FLORIDAY_AUTH_URL = process.env.FLORIDAY_AUTH_URL!
const FLORIDAY_CLIENT_ID = process.env.FLORIDAY_CLIENT_ID!
const FLORIDAY_CLIENT_SECRET = process.env.FLORIDAY_CLIENT_SECRET!

const SCOPES = [
  'role:app',
  'organization:read',
  'catalog:read',
  'catalog:write',
  'supply:read',
  'supply:write',
  'sales-order:read',
  'sales-order:write',
  'fulfillment:read',
  'fulfillment:write',
  'webhooks:write',
].join(' ')

// Token safety margin: vernieuw 5 min voor verloop
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000

interface TokenCache {
  accessToken: string
  expiresAt: number  // Unix timestamp in ms
}

let tokenCache: TokenCache | null = null

/**
 * Haal een geldig access token op. Cached in-memory.
 * Gooit een error als authenticatie mislukt.
 */
export async function getFloridayToken(): Promise<string> {
  // Return cached token als het nog geldig is
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken
  }

  console.log('Floriday: Nieuw access token ophalen...')

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: FLORIDAY_CLIENT_ID,
    client_secret: FLORIDAY_CLIENT_SECRET,
    scope: SCOPES,
  })

  const response = await fetch(FLORIDAY_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Floriday auth error:', response.status, errorText)
    throw new Error(`Floriday authenticatie mislukt: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as {
    access_token: string
    expires_in: number
    token_type: string
    scope: string
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TOKEN_SAFETY_MARGIN_MS,
  }

  console.log(`Floriday: Token verkregen, geldig voor ${data.expires_in}s, scopes: ${data.scope}`)

  return tokenCache.accessToken
}

/**
 * Forceer een nieuw token (bijv. na een 401 response)
 */
export function invalidateFloridayToken(): void {
  tokenCache = null
}
