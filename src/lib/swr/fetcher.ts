/**
 * Typed JSON fetcher for SWR.
 * Throws on non-2xx responses with the error message from the server.
 */
export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message = (body as { error?: string }).error ?? `Request failed: ${res.status}`
    throw new Error(message)
  }
  return res.json()
}
