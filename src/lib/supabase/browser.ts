import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

// Circuit breaker: stop retrying after consecutive 429s to prevent rate limit death spiral
let consecutive429s = 0
const MAX_429s = 3

function circuitBreakerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // If circuit is open, reject auth token requests immediately
  if (consecutive429s >= MAX_429s) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/auth/v1/token')) {
      // Clear stale auth data to stop the loop
      document.cookie.split(';').forEach(c => {
        const name = c.trim().split('=')[0]
        if (name.startsWith('sb-')) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${process.env.NEXT_PUBLIC_COOKIE_DOMAIN || ''}`
        }
      })
      return Promise.resolve(new Response(JSON.stringify({ error: 'Circuit breaker: too many 429s' }), { status: 429 }))
    }
  }

  return fetch(input, init).then(res => {
    if (res.url.includes('/auth/v1/token')) {
      if (res.status === 429) {
        consecutive429s++
      } else {
        consecutive429s = 0
      }
    }
    return res
  })
}

export function createAuthBrowserClient() {
  if (client) return client

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        domain: process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined,
      },
      global: {
        fetch: circuitBreakerFetch,
      },
    }
  )

  return client
}
