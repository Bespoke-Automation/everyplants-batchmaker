// ══════════════════════════════════════════════════════════════
// Floriday Environment Configuration
// ══════════════════════════════════════════════════════════════
//
// Centrale config die bepaalt welke Floriday omgeving actief is.
// Toggle via FLORIDAY_ENV=staging|live in .env.local.

export type FloridayEnv = 'staging' | 'live'

export function getFloridayEnv(): FloridayEnv {
  const env = process.env.FLORIDAY_ENV || 'staging'
  if (env !== 'staging' && env !== 'live') {
    throw new Error(`Ongeldige FLORIDAY_ENV: "${env}". Gebruik "staging" of "live".`)
  }
  return env
}

export function getFloridayConfig() {
  const env = getFloridayEnv()
  const prefix = env.toUpperCase() // STAGING of LIVE

  const apiBaseUrl = process.env[`FLORIDAY_${prefix}_API_BASE_URL`]
  const authUrl = process.env[`FLORIDAY_${prefix}_AUTH_URL`]
  const clientId = process.env[`FLORIDAY_${prefix}_CLIENT_ID`]
  const clientSecret = process.env[`FLORIDAY_${prefix}_CLIENT_SECRET`]
  const apiKey = process.env[`FLORIDAY_${prefix}_API_KEY`]

  if (!apiBaseUrl || !authUrl || !clientId || !clientSecret || !apiKey) {
    const missing = [
      !apiBaseUrl && `FLORIDAY_${prefix}_API_BASE_URL`,
      !authUrl && `FLORIDAY_${prefix}_AUTH_URL`,
      !clientId && `FLORIDAY_${prefix}_CLIENT_ID`,
      !clientSecret && `FLORIDAY_${prefix}_CLIENT_SECRET`,
      !apiKey && `FLORIDAY_${prefix}_API_KEY`,
    ].filter(Boolean)
    throw new Error(`Ontbrekende Floriday ${env} env vars: ${missing.join(', ')}`)
  }

  return { apiBaseUrl, authUrl, clientId, clientSecret, apiKey, env }
}
