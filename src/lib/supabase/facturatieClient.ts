import { createClient } from '@supabase/supabase-js'

const facturatieUrl = process.env.FACTURATIE_SUPABASE_URL!
const facturatieAnonKey = process.env.FACTURATIE_SUPABASE_ANON_KEY!

export const facturatieSupabase = createClient(facturatieUrl, facturatieAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        cache: 'no-store',
      })
    },
  },
})
