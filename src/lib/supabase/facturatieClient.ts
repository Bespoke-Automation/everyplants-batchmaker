import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null
let _clientUrl: string | null = null

export function getFacturatieSupabase(): SupabaseClient {
  const url = process.env.FACTURATIE_SUPABASE_URL
  const key = process.env.FACTURATIE_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('FACTURATIE_SUPABASE_URL en FACTURATIE_SUPABASE_ANON_KEY zijn vereist')
  }

  // Recreate client if URL changed (e.g. hot reload with different env)
  if (!_client || _clientUrl !== url) {
    _client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: (input, options = {}) => fetch(input, { ...options, cache: 'no-store' }),
      },
    })
    _clientUrl = url
    console.log('[facturatieClient] Client created')
  }
  return _client
}
