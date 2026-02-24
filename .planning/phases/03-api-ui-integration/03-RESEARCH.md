# Phase 3: API + UI Integration - Research

**Researched:** 2026-02-24
**Domain:** API country code validation, React UI cost display, engine response consumption
**Confidence:** HIGH

## Summary

Phase 3 is the final phase that surfaces cost data to the packing UI. The heavy lifting is already done: Phase 1 built the cost data layer (costProvider.ts, country threading, `cost_data_available` flag) and Phase 2 implemented cost-primary ranking with `enrichWithCosts()` across all engine code paths. The engine's `AdviceBox` type already contains `box_cost`, `transport_cost`, and `total_cost` fields (optional numbers), and the `PackagingAdviceResult` already includes `cost_data_available: boolean`.

Phase 3 has two concrete tasks: (1) ensure the API contract is tight (countryCode validated against known codes, already done in Phase 1) and ensure VerpakkingsClient sends country automatically (also already done), and (2) update the UI to display cost breakdowns per advised box and show a warning when cost data was unavailable. The work is entirely frontend-focused: updating TypeScript interfaces in VerpakkingsClient to include cost fields from the engine response, and adding cost display elements to the advice banner and box selection UI.

The risk is low because no new libraries or backend changes are needed. The only code changes are in `VerpakkingsClient.tsx` (update `EngineAdviceBox` and `EngineAdvice` interfaces, add cost display JSX) and potentially `BoxCard.tsx` if costs should appear on assigned boxes. The engine already returns all needed data; the frontend just doesn't consume it yet.

**Primary recommendation:** Update the `EngineAdviceBox` and `EngineAdvice` interfaces in VerpakkingsClient to include `box_cost`, `transport_cost`, `total_cost`, and `cost_data_available`. Add cost display to the engine advice banner and box selection buttons. Show a warning banner when `cost_data_available: false`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | `POST /api/verpakking/engine/calculate` accepteert `countryCode` in request body, valideert tegen bekende landcodes; VerpakkingsClient stuurt country automatisch mee | **Already implemented in Phase 1.** API route (line 58-67) validates against `['NL','BE','DE','FR','AT','LU','SE','IT','ES']`. VerpakkingsClient (line 309) sends `countryCode: order.deliverycountry`. Engine call waits for order data (line 290). Verification needed that this works end-to-end. |
| UI-01 | Engine advies toont per voorgestelde doos: dooskosten, transportkosten, totaalkosten; waarschuwing bij `cost_data_available: false` | **Not yet implemented.** `EngineAdviceBox` interface (line 55-60) missing cost fields. `EngineAdvice` interface (line 62-71) missing `cost_data_available`. Advice banner (line 1199-1278) and box selection UI (line 1904-1943) show no cost data. Research provides exact interface changes and JSX patterns. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.2.3 | UI rendering for cost display components | Already used; no changes |
| Next.js | 16.1.1 | API route for engine calculate endpoint | Already used; no changes |
| TypeScript | 5.8.2 | Type safety for updated interfaces | Already used; strict types |
| lucide-react | 0.562.0 | Icons for cost display (Euro, AlertTriangle) | Already used throughout |
| Tailwind CSS | 3.4.17 | Styling for cost breakdown elements | Already used throughout |

### Supporting

No new supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline cost formatting | `Intl.NumberFormat` with `style: 'currency'` | Could use, but existing patterns in the codebase use simple template literals with `toFixed(2)`. Keep consistent. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Current State (What Already Exists)

The engine pipeline is fully implemented:

```
VerpakkingsClient                          API Route                    Engine
─────────────────                         ──────────                   ──────
order.deliverycountry ─── countryCode ──→ validates against            calculateAdvice()
                                          VALID_COUNTRY_CODES ──────→  costProvider.ts
                                                                       enrichWithCosts()
                                                                       rankPackagings()
                                          ←─────────────────────────── { advice_boxes: [{
                                                                           box_cost,
                                                                           transport_cost,
                                                                           total_cost
                                                                         }],
                                                                         cost_data_available }
```

### What's Missing (Phase 3 Work)

```
Engine response (already has cost data)
    │
    ▼
VerpakkingsClient EngineAdviceBox interface ←── NEEDS: box_cost, transport_cost, total_cost
VerpakkingsClient EngineAdvice interface    ←── NEEDS: cost_data_available
    │
    ▼
Advice banner (line 1199-1278)             ←── NEEDS: cost breakdown per box
Box selection UI (line 1904-1943)          ←── NEEDS: cost per advised box
Warning when cost_data_available: false    ←── NEEDS: new warning banner
```

### Pattern 1: Interface Extension for Cost Fields

**What:** Update the local `EngineAdviceBox` and `EngineAdvice` interfaces in VerpakkingsClient to match what the engine actually returns.
**When to use:** Now -- the engine already sends these fields, the UI just ignores them.
**Example:**
```typescript
// Source: VerpakkingsClient.tsx, lines 55-71 (current) vs packagingEngine.ts AdviceBox (line 53-61)

interface EngineAdviceBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  products: { productcode: string; shipping_unit_name: string; quantity: number }[]
  box_cost?: number        // NEW: from engine AdviceBox
  transport_cost?: number  // NEW: from engine AdviceBox
  total_cost?: number      // NEW: from engine AdviceBox
}

interface EngineAdvice {
  id: string
  order_id: number
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: EngineAdviceBox[]
  shipping_units_detected: { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[]
  unclassified_products: string[]
  tags_written: string[]
  weight_exceeded?: boolean
  cost_data_available?: boolean  // NEW: from engine PackagingAdviceResult
}
```

### Pattern 2: Cost Formatting Helper

**What:** A simple formatting function for displaying euro amounts consistently.
**When to use:** Anywhere cost values appear in the UI.
**Example:**
```typescript
// Local helper inside VerpakkingsClient (no export needed)
function formatCost(value: number | undefined): string {
  if (value === undefined || value === null) return '-'
  return `€${value.toFixed(2)}`
}
```

### Pattern 3: Conditional Cost Display

**What:** Show cost breakdown only when cost data is available. Show warning when it's not.
**When to use:** In the advice banner and box selection areas.
**Example:**
```typescript
// In the advice banner, after the confidence text:
{engineAdvice.cost_data_available === false && (
  <div className="flex items-center gap-1.5 px-3 py-2 mt-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
    <span>Advies op basis van specificiteit — kostdata niet beschikbaar</span>
  </div>
)}
```

### Anti-Patterns to Avoid

- **Showing €0.00 when cost is undefined:** The engine uses `|| undefined` to convert 0 to undefined for non-enriched boxes (Phase 2 decision). Check for `undefined`, not for `=== 0`.
- **Adding cost display to BoxCard for assigned boxes:** The `BoxCard` component shows boxes that are already assigned to the session. The cost data is on the engine advice, not on the session boxes. Don't try to pass cost data through the session -- show it on the advice UI only.
- **Making countryCode required in the API route:** The current implementation (Phase 1) intentionally keeps it optional for backward compatibility. Phase 3's requirement is that VerpakkingsClient sends it automatically, not that the API rejects requests without it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Currency formatting | Custom euro formatter with locale handling | Simple `€${value.toFixed(2)}` | All costs are in euros with 2 decimals; no locale variation needed for internal tool |
| Cost data fetch | Separate API call for cost data | Engine response already includes it | `AdviceBox.box_cost/transport_cost/total_cost` and `cost_data_available` are already in the response |
| Country code extraction | Manual extraction from delivery address | `order.deliverycountry` | VerpakkingsClient already fetches the order and has `deliverycountry` (Phase 1 work) |

**Key insight:** Phase 3 requires ZERO new API calls, ZERO new database queries, ZERO new backend logic. The engine already returns all cost data. The only work is frontend: updating TypeScript interfaces and adding JSX for display.

## Common Pitfalls

### Pitfall 1: Treating `|| undefined` Cost Values as Zero

**What goes wrong:** The engine (packagingEngine.ts lines 684-686, 718-720, 755-757) uses `|| undefined` to convert 0-valued costs to `undefined`. This is intentional -- a `box_cost` of 0 means "not enriched with real cost data". But `0` is a valid cost in some scenarios (e.g., a box with no material cost). If the UI displays `undefined` as `€0.00`, it misrepresents the data.

**Why it happens:** The `|| undefined` pattern conflates "no data" with "zero cost". This was a Phase 2 decision.

**How to avoid:** Always check `value !== undefined` before displaying. Use the `formatCost` helper that returns `-` for undefined values. Never convert undefined to 0 for display.

**Warning signs:** All boxes showing `€0.00` when cost data is available.

### Pitfall 2: Displaying Cost Data When `cost_data_available` is False

**What goes wrong:** When cost data is unavailable (facturatie DB unreachable), the engine falls back to specificity ranking. The `AdviceBox` objects will have `box_cost: undefined`, `transport_cost: undefined`, `total_cost: undefined`. If the UI blindly renders the cost section, it shows empty/dash values which is confusing.

**Why it happens:** The advice still has boxes (from specificity ranking) but no cost information.

**How to avoid:** Gate the entire cost display section on `engineAdvice.cost_data_available !== false`. When false, show the warning message instead of cost breakdown. The cost display section should be hidden, not shown with dashes.

**Warning signs:** Cost section visible with all dashes; user confusion about "why are there no costs?".

### Pitfall 3: Not Handling Partial Cost Availability

**What goes wrong:** Some advice boxes may have cost data while others don't. This happens when some packagings have barcodes (cost lookup possible) and others don't (no barcode = no cost lookup). The engine keeps non-barcode boxes with `box_cost: undefined` but doesn't exclude them.

**Why it happens:** The `enrichWithCosts` function (packagingEngine.ts line 546) keeps boxes without barcodes unchanged. Only boxes WITH barcodes but WITHOUT a cost entry are excluded.

**How to avoid:** Per-box cost display should check individual `box.total_cost !== undefined` before showing the cost line. The overall `cost_data_available` flag reflects whether the facturatie DB was reachable, not whether every individual box has costs.

**Warning signs:** Some boxes in the advice show costs, others show nothing, without explanation.

### Pitfall 4: Forgetting to Update the Box Selection Modal

**What goes wrong:** The advice banner (collapsed banner at line 1199-1278) shows the cost breakdown, but the box selection modal (line 1904-1943) -- where the user actually clicks to add a box -- doesn't show costs. Users see the cost in one place but not where they make the decision.

**Why it happens:** The two UI areas use the same data but are rendered separately.

**How to avoid:** Add cost display to BOTH the advice banner's expanded details AND the box selection buttons in the modal.

**Warning signs:** User asks "which box is cheapest?" while looking at the box selection modal with no cost info.

## Code Examples

### Example 1: Updated TypeScript Interfaces

```typescript
// Source: VerpakkingsClient.tsx — update existing interfaces to match engine response

interface EngineAdviceBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  products: { productcode: string; shipping_unit_name: string; quantity: number }[]
  box_cost?: number        // NEW
  transport_cost?: number  // NEW
  total_cost?: number      // NEW
}

interface EngineAdvice {
  id: string
  order_id: number
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: EngineAdviceBox[]
  shipping_units_detected: { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[]
  unclassified_products: string[]
  tags_written: string[]
  weight_exceeded?: boolean
  cost_data_available?: boolean  // NEW
}
```

### Example 2: Cost Formatting Helper

```typescript
// Source: pattern used in codebase for other numeric displays

function formatCost(value: number | undefined): string {
  if (value === undefined) return '-'
  return `€${value.toFixed(2)}`
}
```

### Example 3: Cost Breakdown in Advice Banner (Expanded Details)

```typescript
// Source: VerpakkingsClient.tsx advice details section (after line 1250)
// Inside the adviceDetailsExpanded block

{engineAdvice.cost_data_available !== false && engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
  <div className="space-y-1">
    <span className="font-medium">Kosten per doos:</span>
    {engineAdvice.advice_boxes.map((box, idx) => (
      box.total_cost !== undefined && (
        <div key={idx} className="flex items-center justify-between text-xs">
          <span>{box.packaging_name}</span>
          <span className="tabular-nums">
            {formatCost(box.box_cost)} + {formatCost(box.transport_cost)} = <strong>{formatCost(box.total_cost)}</strong>
          </span>
        </div>
      )
    ))}
  </div>
)}

{engineAdvice.cost_data_available === false && (
  <div className="flex items-center gap-1.5 text-amber-700">
    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
    <span>Advies op basis van specificiteit — kostdata niet beschikbaar</span>
  </div>
)}
```

### Example 4: Cost in Box Selection Buttons

```typescript
// Source: VerpakkingsClient.tsx box selection modal (around line 1911-1932)
// Inside the engineAdvice.advice_boxes.map callback, add cost to the button

<div className="flex-1 min-w-0">
  <p className="font-medium text-sm">{adviceBox.packaging_name}</p>
  <p className="text-xs text-muted-foreground">
    {adviceBox.products.map((p) => `${p.quantity}x ${p.shipping_unit_name}`).join(', ')}
  </p>
  {adviceBox.total_cost !== undefined && (
    <p className="text-xs text-emerald-700 font-medium mt-0.5">
      {formatCost(box.box_cost)} doos + {formatCost(box.transport_cost)} transport = {formatCost(box.total_cost)}
    </p>
  )}
</div>
```

### Example 5: Cost-Unavailable Warning Banner

```typescript
// Source: new addition, placed near the engine advice banner (line 1279)

{engineAdvice && engineAdvice.cost_data_available === false && engineAdvice.confidence !== 'no_match' && (
  <div className="px-3 pt-1 lg:px-4">
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-600" />
      <span>
        Advies op basis van specificiteit — kostdata niet beschikbaar
      </span>
    </div>
  </div>
)}
```

### Example 6: Total Cost in Collapsed Banner

```typescript
// Source: VerpakkingsClient.tsx, inside the advice banner button (around line 1217-1225)
// After the packaging names, add total cost summary

{engineAdvice.confidence === 'full_match' && (
  <>
    Advies: {engineAdvice.advice_boxes.map((b) => b.packaging_name).join(' + ')}
    {engineAdvice.cost_data_available !== false && engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
      <span className="ml-1 font-medium">
        ({formatCost(engineAdvice.advice_boxes.reduce((sum, b) => sum + (b.total_cost ?? 0), 0))} totaal)
      </span>
    )}
  </>
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No cost display in packing UI | Cost breakdown per advised box | Phase 3 | Medewerkers zien dooskosten + transportkosten |
| Engine advice as black-box "use this box" | Transparent "use this box because it costs X" | Phase 3 | Trust in engine advice increases |
| No feedback on cost data availability | Warning banner when cost data unavailable | Phase 3 | Medewerkers weten waarom er geen kosten zijn |

**Already completed (Phases 1-2):**
- `costProvider.ts` fetches and caches cost data from facturatie DB (Phase 1)
- `countryCode` threaded through full engine pipeline (Phase 1)
- `enrichWithCosts()` applied to all engine code paths (Phase 2)
- `rankPackagings()` uses cost-primary sorting when data available (Phase 2)
- `AdviceBox` includes `box_cost`, `transport_cost`, `total_cost` (Phase 1)
- `PackagingAdviceResult` includes `cost_data_available` (Phase 1)
- API route validates `countryCode` against known codes (Phase 1)
- VerpakkingsClient sends `order.deliverycountry` to engine (Phase 1)

## Open Questions

1. **Where exactly should cost breakdown be visible?**
   - What we know: Requirements say "advies-panel in het inpakscherm toont per voorgestelde doos: dooskosten, transportkosten, totaalkosten"
   - Current state: There are two places advice boxes appear: (a) the collapsible advice banner (line 1199-1278) and (b) the box selection buttons in the "add box" modal (line 1904-1943)
   - Recommendation: Show costs in BOTH places. The collapsed banner shows total cost as a summary. The expanded details show per-box breakdown. The box selection buttons show per-box cost to inform the decision.

2. **Should the collapsed banner show aggregated total cost?**
   - What we know: The collapsed banner currently shows "Advies: Box A + Box B". Adding total cost (e.g., "Advies: Box A + Box B (€12.50 totaal)") would be informative.
   - What's unclear: Whether this is visual noise on an already-busy banner.
   - Recommendation: Include it. A single cost number is valuable at a glance. Users can expand for per-box details.

3. **How to format "doos + transport = totaal" label?**
   - What we know: The UI is in Dutch. "Dooskosten", "Transportkosten", "Totaal" are natural terms.
   - Recommendation: Use compact format: `€X.XX doos + €Y.YY transport = €Z.ZZ` in the per-box details. Short enough for mobile (min-w constraints).

## Sources

### Primary (HIGH confidence)
- `src/lib/engine/packagingEngine.ts` -- `AdviceBox` interface (line 53-61) with `box_cost`, `transport_cost`, `total_cost`; `PackagingAdviceResult` (line 63-77) with `cost_data_available`; `enrichWithCosts()` (line 538-559); `solveMultiBox()` cost field assignment (lines 684-686, 718-720, 755-757)
- `src/app/api/verpakking/engine/calculate/route.ts` -- Full API contract (85 lines); countryCode validation (line 58-67) with `VALID_COUNTRY_CODES` array
- `src/components/verpakking/VerpakkingsClient.tsx` -- `EngineAdviceBox` interface (line 55-60, missing cost fields); `EngineAdvice` interface (line 62-71, missing `cost_data_available`); engine call (line 301-328); advice banner (line 1199-1278); box selection (line 1904-1943)
- `src/hooks/usePackingSession.ts` -- Session hook (no changes needed; cost data is on engine advice, not session boxes)
- `src/components/verpakking/BoxCard.tsx` -- `BoxCardItem` interface (line 36-48, no cost fields; no changes needed)

### Secondary (MEDIUM confidence)
- `src/lib/picqer/types.ts` -- `PicqerOrder.deliverycountry: string` (line 63)
- `src/lib/picqer/transform.ts` -- `bezorgland: order.deliverycountry || 'NL'` (line 125)
- `.planning/phases/01-cost-data-layer/01-RESEARCH.md` -- Phase 1 research documenting country threading and cost provider architecture
- `.planning/phases/02-cost-primary-ranking/02-02-SUMMARY.md` -- Phase 2 completion confirming all engine paths enriched

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zero new dependencies; all existing libraries and patterns
- Architecture: HIGH -- Engine already returns all needed data; changes are purely UI interface updates and JSX additions
- Pitfalls: HIGH -- All pitfalls identified from direct line-by-line analysis of existing VerpakkingsClient component and engine types

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable domain, no external dependencies or moving parts)
