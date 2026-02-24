# Coding Conventions

**Analysis Date:** 2026-02-24

## Naming Patterns

**Files:**
- React components: `PascalCase.tsx` — e.g., `BatchmakerClient.tsx`, `BoxCard.tsx`, `FilterPanel.tsx`
- Hooks: `camelCase.ts` with `use` prefix — e.g., `useOrders.ts`, `usePackingSession.ts`
- API route files: always named `route.ts` in directory structure
- Library/service files: `camelCase.ts` — e.g., `batchCreations.ts`, `packingSessions.ts`
- Type files: `camelCase.ts` — e.g., `order.ts`, `verpakking.ts`, `database.ts`

**Functions:**
- React component functions: `PascalCase` — e.g., `export default function BatchmakerClient()`
- Hook functions: `camelCase` with `use` prefix — e.g., `export function useOrders()`
- Utility/helper functions: `camelCase` — e.g., `transformOrder()`, `normalizeTag()`, `rateLimitedFetch()`
- Event handlers in components: `handle` prefix — e.g., `handleCreateBatchClick`, `handleConfirmBatch`
- Fetch functions in hooks: `fetch` prefix — e.g., `fetchOrders`, `fetchQueue`, `fetchSession`

**Variables:**
- `camelCase` throughout — `picklistIds`, `batchId`, `webhookTriggered`
- Boolean state: `is` prefix — `isLoading`, `isSaving`, `isClaiming`
- Ref variables: descriptive suffix — `intervalRef`, `isMountedRef`, `sessionRef`
- Constants: `UPPER_SNAKE_CASE` — `MAX_RETRIES`, `POLL_INTERVAL`, `COUNTRY_NAMES`

**Types:**
- Interfaces: `PascalCase` — `CreateBatchRequest`, `SessionBox`, `PackingSession`
- Type aliases: `PascalCase` — `PackingSessionStatus`, `SortOrder`, `BoxShipmentStatus`
- Insert/Update variants: `Omit<T, ...>` and `Partial<T>` utility types — e.g., `BatchCreationInsert`, `BatchPresetUpdate`
- Enum-like string union types: used frequently instead of actual TypeScript enums

**Database/API fields:**
- Supabase columns: `snake_case` — `picqer_batch_id`, `assigned_to_name`, `created_at`
- API request/response: `camelCase` in TypeScript interfaces, `snake_case` in raw DB rows
- Transform functions normalize snake_case → camelCase at boundary (see `usePackingSession.ts` transform functions)

## Code Style

**Formatting:**
- No Prettier or Biome config detected — uses Next.js default ESLint only (`next lint`)
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- No explicit line length limit found; consistent 2-space indentation throughout codebase
- Single quotes for strings in TypeScript/TSX

**Linting:**
- Tool: Next.js built-in ESLint
- Suppressed rules encountered:
  - `@typescript-eslint/no-explicit-any` — suppressed in transform functions in hooks (raw API data)
  - `@next/next/no-img-element` — suppressed where `<img>` is used instead of `<Image>`
  - `react-hooks/exhaustive-deps` — suppressed in specific edge cases

**TypeScript:**
- `strict: true` — all strict checks active
- Path alias `@/*` maps to `src/*` — use `@/components/...`, `@/hooks/...`, etc.
- `import type` used for type-only imports — `import type { BoxShipmentStatus } from '@/types/verpakking'`
- Avoid `any` — use typed transforms at API/DB boundaries instead

## Import Organization

**Order used in files (implicit convention):**
1. React and core framework — `import { useState, useEffect } from 'react'`
2. Third-party libraries — `import { ... } from '@dnd-kit/core'`, `import { ... } from 'lucide-react'`
3. Internal absolute imports via `@/` alias — hooks, components, lib, types
4. Relative imports (same directory) — `import BarcodeListener from './BarcodeListener'`

**Path Aliases:**
- `@/` → `src/` — always prefer over relative paths for cross-directory imports
- Relative imports only used for components in the same directory (e.g., `./BoxCard`, `./ProductCard`)

**Type imports:**
- Use `import type { ... }` for type-only imports
- Mix named and type imports: `import { usePicklistComments, type PicklistComment } from '@/hooks/usePicklistComments'`

## Component Patterns

**Client vs Server components:**
- Client components require `'use client'` directive as first line
- Server components (Next.js App Router pages) are thin wrappers that load client components:
  ```tsx
  // src/app/(batchmaker)/batchmaker/batches/page.tsx
  import BatchmakerClient from '@/components/BatchmakerClient'
  export default function BatchesPage() {
    return <BatchmakerClient />
  }
  ```
- Business logic lives entirely in client components and hooks

**Props typing:**
- Define interface above component: `interface ComponentNameProps { ... }`
- Destructure props in function signature
- Use optional props with `?` and provide defaults inline

**State initialization:**
- Lazy state init via function: `useState<string | null>(() => { ... })`
- Used for sessionStorage reads (avoids SSR issues)

## Error Handling

**API Routes (server-side):**
- Wrap handler body in `try/catch`
- Return `NextResponse.json({ error: string, details?: string }, { status: N })`
- Status codes: `400` validation, `409` conflict/already-claimed, `500` server error, `502` external service failure
- Log with `console.error('[module] Error description:', error)` — use module prefix in brackets
- Check `error instanceof Error` for message extraction: `error instanceof Error ? error.message : 'Unknown error'`
- Non-critical failures (e.g., webhook, Supabase logging) are caught separately and don't fail the main request

**Supabase helpers (lib/supabase/*.ts):**
- Check `if (error) { console.error('...', error); throw error }`
- Return typed data, throw raw Supabase error objects
- Functions return typed results directly (no wrapping)

**Hooks (client-side):**
- Optimistic updates with snapshot rollback pattern:
  ```typescript
  const snapshot = sessionRef.current
  setSession(optimisticUpdate)
  try { await apiCall() } catch (err) { setSession(snapshot) }
  ```
- `AbortError` swallowed: `if (err instanceof Error && err.name === 'AbortError') return`
- Error state exposed: `const [error, setError] = useState<Error | null>(null)`
- Use `setError(err instanceof Error ? err : new Error('Unknown error'))`

**External API errors:**
- Picqer/Floriday: log status + body, throw descriptive `Error`
- Concurrency limiter: `acquireSlot()` / `releaseSlot()` with `try/finally`
- Rate limit (429): exponential backoff with `Retry-After` header respect

## Logging

**Framework:** Native `console` — no structured logging library

**Patterns:**
- `console.log(...)` for informational flow in lib clients (Picqer, Floriday)
- `console.error(...)` for all error conditions
- API routes prefix with module name: `console.error('[verpakking] Error creating packing session:', error)`
- No `console.warn` pattern observed
- No structured/JSON logging

## Comments

**When to Comment:**
- JSDoc block comments on exported library functions: `/** Get value from orderfields by field ID */`
- JSDoc on API route handlers: `/** GET /api/verpakking/sessions — Returns paginated session history */`
- Inline `//` comments for non-obvious logic, state machine steps, algorithm explanations
- Section separators with `// ── Section Name ────────` in longer files (engine, lib clients)
- `// Step N:` pattern for multi-step operations in API handlers

**JSDoc usage:**
- Used in `src/lib/picqer/transform.ts`, `src/lib/picqer/client.ts`, and `src/lib/supabase/*.ts`
- Block comments above exported API route functions
- No `@param`/`@returns` tags — just a single description line

## Function Design

**Size:** Hooks can be large (usePackingSession.ts ~900 lines) — organized by section comments
**Parameters:** Prefer destructured objects for 3+ params, primitives for 1-2
**Return Values:**
- Hooks return plain objects — `{ data, isLoading, error, refetch, actionFunctions... }`
- Supabase helpers return typed data directly or throw
- Actions return `{ success: boolean, error?: string }` where applicable

## Module Design

**Exports:**
- Components: `export default function ComponentName`
- Hooks: `export function useHookName` (named export)
- Supabase helpers: named exports only — `export async function createBatchCreation(...)`
- Types: named exports — `export interface X`, `export type Y`

**Barrel Files:**
- `src/constants/index.ts` — single constants barrel
- No barrel files for components or hooks — import directly from file

## UI Conventions

**Touch targets:**
- Use `min-h-[44px]` for interactive elements

**Status color semantics:**
- `emerald` — completed/success states
- `blue` — in-progress states
- `amber` — warnings, partial states
- `destructive` (Tailwind custom) — error states

**Icons:**
- Always from `lucide-react` — never inline SVG or other icon libraries

**Tailwind:**
- Utility classes only — no CSS modules
- Custom theme colors defined in `tailwind.config.ts`: `primary`, `secondary`, `destructive`, `muted`, `accent`, `success`, `warning`, `info`
- Font: Geist Sans / Geist Mono

## Database Conventions

**Supabase queries:**
- Always include schema: `supabase.schema('batchmaker').from('table_name')`
- Never use `.from()` directly without `.schema()`
- Floriday uses separate `floriday` schema

**Upsert pattern:**
- Use `.upsert({ ... }, { onConflict: 'unique_column' })` for sync operations
- Preserve local engine fields during Picqer syncs (never overwrite `cost`, `max_weight`, `specificity`)

**Insert type pattern:**
```typescript
// src/types/database.ts
export type BatchCreationInsert = Omit<BatchCreation, 'id' | 'created_at'>
export type BatchPresetUpdate = Partial<BatchPresetInsert>
```

---

*Convention analysis: 2026-02-24*
