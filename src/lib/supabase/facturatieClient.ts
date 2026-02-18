import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getFacturatieSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.FACTURATIE_SUPABASE_URL
    const key = process.env.FACTURATIE_SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error('FACTURATIE_SUPABASE_URL en FACTURATIE_SUPABASE_ANON_KEY zijn vereist')
    }
    _client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: (input, options = {}) => fetch(input, { ...options, cache: 'no-store' }),
      },
    })
  }
  return _client
}
