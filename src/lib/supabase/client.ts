import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Configure Supabase client with no-cache fetch to prevent Next.js from caching responses
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        cache: 'no-store',
      })
    },
  },
})
