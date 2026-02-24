// ══════════════════════════════════════════════════════════════
// Floriday OAuth2 Client Credentials Authentication
// ══════════════════════════════════════════════════════════════
//
// Token wordt gecached in-memory met een veiligheidsmarge van
// 5 minuten voor verloop. Bij server restart wordt automatisch
// een nieuw token opgehaald.

import { getFloridayConfig, type FloridayEnv } from './config'

// Staging heeft alle scopes; live mist supply:write, sales-order:write, fulfillment:write
const SCOPES_BY_ENV: Record<FloridayEnv, string> = {
  staging: [
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
  ].join(' '),
  live: [
    'role:app',
    'organization:read',
    'catalog:read',
    'catalog:write',
    'supply:read',
    'sales-order:read',
    'fulfillment:read',
    'webhooks:write',
  ].join(' '),
}

// Token safety margin: vernieuw 5 min voor verloop
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000

interface TokenCache {
  accessToken: string
  expiresAt: number  // Unix timestamp in ms
}

// Per-environment token cache
const tokenCaches: Record<FloridayEnv, TokenCache | null> = {
  staging: null,
  live: null,
}

/**
 * Haal een geldig access token op. Cached in-memory per environment.
 * Gooit een error als authenticatie mislukt.
 */
export async function getFloridayToken(): Promise<string> {
  const config = getFloridayConfig()
  const cached = tokenCaches[config.env]

  // Return cached token als het nog geldig is
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken
  }

  console.log(`Floriday [${config.env}]: Nieuw access token ophalen...`)

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: SCOPES_BY_ENV[config.env],
  })

  const response = await fetch(config.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Floriday [${config.env}] auth error:`, response.status, errorText)
    throw new Error(`Floriday authenticatie mislukt (${config.env}): ${response.status} - ${errorText}`)
  }

  const data = await response.json() as {
    access_token: string
    expires_in: number
    token_type: string
    scope: string
  }

  tokenCaches[config.env] = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TOKEN_SAFETY_MARGIN_MS,
  }

  console.log(`Floriday [${config.env}]: Token verkregen, geldig voor ${data.expires_in}s, scopes: ${data.scope}`)

  return tokenCaches[config.env]!.accessToken
}

/**
 * Forceer een nieuw token (bijv. na een 401 response)
 */
export function invalidateFloridayToken(): void {
  const config = getFloridayConfig()
  tokenCaches[config.env] = null
}
