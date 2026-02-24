# Testing Patterns

**Analysis Date:** 2026-02-24

## Test Framework

**Runner:** None detected

No test framework, test runner, or testing library is installed. `package.json` contains no `jest`, `vitest`, `@testing-library`, `playwright`, `cypress`, or similar dependencies. There are no test configuration files (`jest.config.*`, `vitest.config.*`, `playwright.config.*`).

**Assertion Library:** None

**Run Commands:**
```bash
npm run lint        # ESLint check (only automated quality gate)
npm run build       # TypeScript compilation check (type errors surface here)
```

## Test File Organization

**Location:** No test files exist in the codebase.

```bash
find src/ -name "*.test.*" -o -name "*.spec.*"
# Returns empty
```

## Test Structure

No test structure defined. No `describe`, `it`, `test`, `expect` patterns found anywhere.

## Mocking

**Framework:** None

## Fixtures and Factories

**Test Data:** None — no fixture files, factory functions, or test data builders exist.

## Coverage

**Requirements:** None enforced — no coverage thresholds configured.

## Test Types

**Unit Tests:** Not implemented

**Integration Tests:** Not implemented

**E2E Tests:** Not implemented

## Quality Gates in Place

Although no automated tests exist, the following checks provide partial quality assurance:

**TypeScript compilation:**
```bash
npm run build    # Fails on type errors — serves as static type check
```

**Lint:**
```bash
npm run lint     # Next.js ESLint — catches React hook rule violations, unused imports
```

**Manual verification:** The project relies on manual testing against the live Picqer and Supabase environments.

## Recommendations for Adding Tests

If tests are introduced, the following conventions from the existing codebase should guide test placement:

**Where to place tests:**
- Co-located with source: `src/lib/engine/packagingEngine.test.ts` alongside `packagingEngine.ts`
- Or in a separate `__tests__/` directory per module

**Highest-value test targets (based on complexity):**
- `src/lib/engine/packagingEngine.ts` — complex bin-packing algorithm with multiple branches
- `src/lib/picqer/transform.ts` — order transformation logic, retailer extraction, excluded tag filtering
- `src/lib/supabase/productAttributes.ts` — product classification logic
- `src/lib/floriday/stock-service.ts` — stock calculation combining warehouses and purchase orders
- `src/hooks/useFilters.ts` — filter logic with "Overig" country handling and postal region matching

**Suggested framework:** Vitest — compatible with TypeScript + ESM, fast, no Babel needed.

---

*Testing analysis: 2026-02-24*
