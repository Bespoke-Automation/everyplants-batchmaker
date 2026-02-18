# Operationeel Dashboard & Management Informatie — Implementatieplan

**Datum**: 2026-02-14
**Project**: EveryPlants Batchmaker — Verpakkingsmodule
**Doel**: Van operationele zichtbaarheid naar management informatie, bottom-up opgebouwd

---

## Overzicht

Dit plan breekt het werk op in **6 zelfstandige agent-taken** die elk een afgebakend stuk UI bouwen. Elke agent krijgt een complete brief met alle context die nodig is, inclusief database schema, bestaande code patronen, en exacte specificaties.

### Afhankelijkheden & volgorde

```
Agent 1 (Instellingen tabs)     ─┐
Agent 2 (Engine advieslog)      ─┼─ Parallel, onafhankelijk
Agent 3 (Sessiedetails)         ─┘
                                 │
Agent 4 (Advies-feedback)       ─── Na Agent 3 (gebruikt dezelfde API)
                                 │
Agent 5 (KPI Dashboard)        ─── Na Agent 1+2+3 (gebruikt hun API routes)
                                 │
Agent 6 (Strategische laag)    ─── Na Agent 5 (bouwt voort op dashboard)
```

**Agents 1, 2, 3** kunnen parallel draaien.
**Agent 4** is klein en kan na Agent 3.
**Agent 5** is het grote dashboard, na de operationele lagen.
**Agent 6** breidt Agent 5 uit met trends en kosten.

---

## Agent 1: Operationele Instellingen-tabs

### Doel
Drie nieuwe tabs toevoegen aan de bestaande instellingen-pagina: **Producten**, **Verzendeenheden**, en **Regeldekking** (samenvatting bovenaan bestaande Compartimenten-tab).

### Context voor de agent

**Bestaande pagina**: `src/app/(verpakkingsmodule)/verpakkingsmodule/instellingen/page.tsx`
- Heeft 4 tabs: Koppelingen, Tags, Verpakkingen, Compartimenten
- Elk tab rendert een component: `TagMappingSettings`, `TagList`, `PackagingList`, `CompartmentRules`
- Tabs staan in een `TABS` array, actieve tab via `useState`

**Database schema (batchmaker schema)**:
- `product_attributes` — product cache met classificatie
  - Kolommen: `id`, `picqer_product_id`, `productcode`, `product_name`, `product_type`, `is_composition`, `pot_size`, `height`, `weight`, `is_fragile`, `is_mixable`, `shipping_unit_id` (FK → shipping_units), `classification_status` ('classified'|'unclassified'|'error'|'pending'), `source`, `last_synced_at`
- `shipping_units` — 56 verzendeenheden
  - Kolommen: `id`, `name`, `product_type` ('plant'|'pot'|'accessoire'), `pot_size_min`, `pot_size_max`, `height_min`, `height_max`, `is_fragile_filter`, `is_active`, `sort_order`
- `compartment_rules` — regels per verpakking
  - Kolommen: `id`, `packaging_id` (FK → packagings), `shipping_unit_id` (FK → shipping_units), `min_quantity`, `max_quantity`, `operator` ('EN'|'OF'|'ALTERNATIEF'), `rule_group`
- `packagings` — lokale verpakkingen
  - Kolommen: `id`, `idpackaging` (Picqer ID), `name`, `use_in_auto_advice`, `specificity_score`, `handling_cost`, `material_cost`, `max_weight`

**Bestaande Supabase helpers**:
- `src/lib/supabase/productAttributes.ts` — `ProductAttribute` type, sync functies
- `src/lib/supabase/shippingUnits.ts` — `getActiveShippingUnits()`
- `src/lib/supabase/compartmentRules.ts` — CRUD voor regels

**Bestaande API routes**:
- `GET /api/verpakking/shipping-units` — retourneert actieve shipping units
- `POST /api/verpakking/sync/products` — triggert product sync vanuit Picqer

**UI conventies**:
- Tailwind CSS, lucide-react icons
- Nederlandse UI tekst
- `min-h-[44px]` voor touch targets
- Kleuren: emerald = completed, blue = in-progress, amber = warnings
- Componenten in `src/components/verpakking/`
- Max breedte content: `max-w-3xl mx-auto` (zie bestaande instellingen-pagina)

### Taken

#### 1a. Component: `ProductStatus.tsx`

**Nieuw bestand**: `src/components/verpakking/ProductStatus.tsx`

Functionaliteit:
- **Samenvatting bovenaan**: 4 KPI-kaarten in een grid
  - Totaal producten (count van `product_attributes`)
  - Geclassificeerd (waar `classification_status = 'classified'`)
  - Ongeclassificeerd (waar `classification_status = 'unclassified'`)
  - Fouten (waar `classification_status = 'error'`)
- **Tabel met ongeclassificeerde producten**: productcode, naam, potmaat, hoogte, producttype, reden (geen match op shipping unit ranges)
- **Sync-knop**: triggert `POST /api/verpakking/sync/products`, toont loader, refresht daarna de data
- **Laatste sync**: toon `last_synced_at` van het meest recent gesyncte product

API route nodig: `GET /api/verpakking/products/status`

**Nieuw bestand**: `src/app/api/verpakking/products/status/route.ts`

```
Response: {
  total: number
  classified: number
  unclassified: number
  error: number
  lastSyncedAt: string | null
  unclassifiedProducts: {
    productcode: string
    product_name: string
    pot_size: number | null
    height: number | null
    product_type: string
  }[]
}
```

Query:
```sql
-- Totals
SELECT classification_status, COUNT(*) as count
FROM batchmaker.product_attributes
GROUP BY classification_status;

-- Unclassified products
SELECT productcode, product_name, pot_size, height, product_type
FROM batchmaker.product_attributes
WHERE classification_status = 'unclassified'
ORDER BY productcode
LIMIT 100;

-- Last sync
SELECT MAX(last_synced_at) as last_synced_at
FROM batchmaker.product_attributes;
```

#### 1b. Component: `ShippingUnitList.tsx`

**Nieuw bestand**: `src/components/verpakking/ShippingUnitList.tsx`

Functionaliteit:
- **Gegroepeerd per producttype**: Plant, Pot, Accessoire
- **Per shipping unit**: naam, potmaat range (bijv. "P10,5 – P14"), hoogte range (bijv. "20 – 40 cm"), breekbaar filter
- **Zoekbalk**: filter op naam
- **Productaantallen**: hoeveel producten gekoppeld aan elke shipping unit (badge)
- Alleen-lezen — geen CRUD nodig, shipping units zijn seeded

API route: uitbreiden van `GET /api/verpakking/shipping-units` met product counts

Query voor product counts:
```sql
SELECT su.id, su.name, su.product_type, su.pot_size_min, su.pot_size_max,
       su.height_min, su.height_max, su.is_fragile_filter, su.sort_order,
       COUNT(pa.id) as product_count
FROM batchmaker.shipping_units su
LEFT JOIN batchmaker.product_attributes pa ON pa.shipping_unit_id = su.id
WHERE su.is_active = true
GROUP BY su.id
ORDER BY su.product_type, su.sort_order;
```

#### 1c. Regeldekking-samenvatting op Compartimenten-tab

**Bestaand bestand**: `src/components/verpakking/CompartmentRules.tsx`

Toevoegen bovenaan het component (boven de verpakkingen-lijst):
- **Dekkingsoverzicht**: compact banner
  - "X van Y auto-advies verpakkingen hebben compartiment-regels"
  - Als er verpakkingen zonder regels zijn: lijst tonen (amber waarschuwing)
- Data: vergelijk `packagings WHERE use_in_auto_advice = true` met `DISTINCT packaging_id FROM compartment_rules`

Geen nieuwe API route nodig — data al beschikbaar via bestaande hooks `useLocalPackagings` en `useCompartmentRules`.

#### 1d. Instellingen-pagina updaten

**Bestaand bestand**: `src/app/(verpakkingsmodule)/verpakkingsmodule/instellingen/page.tsx`

- Voeg 2 nieuwe tabs toe aan `TABS` array:
  - `{ id: 'producten', label: 'Producten' }`
  - `{ id: 'verzendeenheden', label: 'Verzendeenheden' }`
- Render de nieuwe componenten bij hun tab ID
- Tabs volgorde: Koppelingen, Tags, Verpakkingen, Compartimenten, **Producten**, **Verzendeenheden**

### Verificatie
- `npm run build` — geen TypeScript fouten
- Visueel: alle tabs renderen correct, data laadt, sync-knop werkt

---

## Agent 2: Engine Advieslog

### Doel
Nieuwe pagina met chronologisch overzicht van alle engine-adviezen, filterable op confidence en outcome.

### Context voor de agent

**Database tabel**: `batchmaker.packaging_advice`
- Kolommen: `id`, `order_id`, `picklist_id`, `status` ('calculated'|'applied'|'invalidated'|'overridden'), `confidence` ('full_match'|'partial_match'|'no_match'), `advice_boxes` (jsonb — array van `{packaging_id, packaging_name, idpackaging, products[]}`), `shipping_units_detected` (jsonb), `unclassified_products` (jsonb — string[]), `tags_written` (jsonb — string[]), `calculated_at` (timestamptz), `outcome` ('followed'|'modified'|'ignored'|null), `actual_boxes` (jsonb), `deviation_type` ('none'|'extra_boxes'|'fewer_boxes'|'different_packaging'|'mixed'|null), `resolved_at` (timestamptz), `shipping_unit_fingerprint` (text), `shipping_provider_profile_id` (int), `weight_exceeded` (boolean)

**Bestaande pagina-structuur**:
- Layout: `src/app/(verpakkingsmodule)/verpakkingsmodule/layout.tsx`
- Navigatie links in `NAV_LINKS` array
- Bestaand patroon voor geschiedenis: `src/components/verpakking/SessionHistory.tsx` (paginering, status badges)

**UI conventies**: zie Agent 1

### Taken

#### 2a. API route: `GET /api/verpakking/engine/log`

**Nieuw bestand**: `src/app/api/verpakking/engine/log/route.ts`

Query parameters:
- `limit` (default 20, max 100)
- `offset` (default 0)
- `confidence` (optioneel filter: 'full_match'|'partial_match'|'no_match')
- `outcome` (optioneel filter: 'followed'|'modified'|'ignored')
- `status` (optioneel, default: exclude 'invalidated')

Response:
```typescript
{
  advices: {
    id: string
    order_id: number
    picklist_id: number | null
    status: string
    confidence: string
    advice_boxes: { packaging_name: string; idpackaging: number; products: { productcode: string; quantity: number }[] }[]
    unclassified_products: string[]
    tags_written: string[]
    calculated_at: string
    outcome: string | null
    deviation_type: string | null
    actual_boxes: { packaging_name: string; products: { productcode: string; amount: number }[] }[] | null
    resolved_at: string | null
    shipping_unit_fingerprint: string | null
    weight_exceeded: boolean
  }[]
  total: number
}
```

Query:
```sql
SELECT id, order_id, picklist_id, status, confidence, advice_boxes,
       unclassified_products, tags_written, calculated_at,
       outcome, deviation_type, actual_boxes, resolved_at,
       shipping_unit_fingerprint, weight_exceeded
FROM batchmaker.packaging_advice
WHERE status != 'invalidated'  -- default, unless status filter is given
ORDER BY calculated_at DESC
LIMIT $limit OFFSET $offset;

-- Count
SELECT COUNT(*) FROM batchmaker.packaging_advice WHERE status != 'invalidated';
```

#### 2b. Navigatie-link toevoegen

**Bestaand bestand**: `src/app/(verpakkingsmodule)/verpakkingsmodule/layout.tsx`

Voeg toe aan `NAV_LINKS`:
```typescript
{ href: '/verpakkingsmodule/engine-log', label: 'Engine Log' },
```

Plaats na 'Geschiedenis', voor 'Instellingen'.

#### 2c. Pagina: `engine-log/page.tsx`

**Nieuw bestand**: `src/app/(verpakkingsmodule)/verpakkingsmodule/engine-log/page.tsx`

Simpele wrapper die het `EngineLog` component rendert.

#### 2d. Component: `EngineLog.tsx`

**Nieuw bestand**: `src/components/verpakking/EngineLog.tsx`

Functionaliteit:

**Filters bovenaan** (horizontale rij):
- Confidence dropdown: Alle / Full match / Partial match / No match
- Outcome dropdown: Alle / Gevolgd / Gewijzigd / Genegeerd / Nog open
- Refresh-knop

**Tabel/lijst**:
- Per rij: datum, order ID, confidence badge, advies-dozen (namen, komma-gescheiden), outcome badge, fingerprint (compact)
- **Confidence badges**: full_match = emerald, partial_match = amber, no_match = red
- **Outcome badges**: followed = emerald "Gevolgd", modified = blue "Gewijzigd", ignored = red "Genegeerd", null = gray "Open"

**Uitklapbare detailrij** (klik op rij → toggle):
- Links: **Advies** — lijst van geadviseerde dozen met hun producten
- Rechts: **Werkelijk** (als `actual_boxes` niet null) — lijst van werkelijke dozen met hun producten
- Afwijkingstype als badge
- Weight exceeded waarschuwing als van toepassing
- Tags geschreven: lijst van tag-namen

**Paginering**: zelfde patroon als `SessionHistory.tsx` (vorige/volgende knoppen, "pagina X van Y")

**Lege staat**: "Nog geen engine-adviezen berekend. Start met inpakken om adviezen te genereren."

### Verificatie
- `npm run build` — geen TypeScript fouten
- Pagina rendert, filters werken, paginering werkt
- Detail-uitklap toont advies vs. werkelijk

---

## Agent 3: Sessiedetails Uitbreiden

### Doel
De bestaande Geschiedenis-pagina uitbreiden zodat je per sessie kunt zien welke dozen zijn gebruikt, welke producten erin zaten, en wat het engine-advies was vs. de werkelijkheid.

### Context voor de agent

**Bestaand component**: `src/components/verpakking/SessionHistory.tsx`
- Toont batch sessions en packing sessions in tabs
- Packing sessions tabel: ID, medewerker, status, datum
- Heeft paginering
- **Geen detail-view** — sessies zijn nu alleen een rij in een tabel

**Database**:
- `packing_sessions` — sessie record (zie types hierboven in Agent 1 context)
- `packing_session_boxes` — dozen met `packaging_name`, `picqer_packaging_id`, `status`, `was_override`, `suggested_packaging_name`, `packaging_advice_id`
- `packing_session_products` — producten per doos met `productcode`, `product_name`, `amount`
- `packaging_advice` — engine advies (zie Agent 2 context voor kolommen)

**Supabase helper**: `getPackingSession(id)` in `src/lib/supabase/packingSessions.ts` — retourneert sessie met geneste boxes en products

**UI conventies**: zie Agent 1

### Taken

#### 3a. API route: `GET /api/verpakking/sessions/[id]/details`

**Nieuw bestand**: `src/app/api/verpakking/sessions/[id]/details/route.ts`

Haalt op:
1. Sessie met boxes en products (via `getPackingSession`)
2. Als een box `packaging_advice_id` heeft: het bijbehorende `packaging_advice` record

Response:
```typescript
{
  session: {
    id: string
    picklist_id: number
    picklistid: string
    order_id: number | null
    order_reference: string | null
    assigned_to_name: string
    status: string
    created_at: string
    completed_at: string | null
    boxes: {
      id: string
      packaging_name: string
      box_index: number
      status: string
      was_override: boolean
      suggested_packaging_name: string | null
      products: { productcode: string; product_name: string; amount: number }[]
    }[]
  }
  advice: {
    id: string
    confidence: string
    advice_boxes: { packaging_name: string; products: { productcode: string; quantity: number }[] }[]
    outcome: string | null
    deviation_type: string | null
    weight_exceeded: boolean
  } | null
}
```

#### 3b. Sessiedetail-panel in SessionHistory

**Bestaand bestand**: `src/components/verpakking/SessionHistory.tsx`

Voeg toe:
- Klikbare sessie-rij → toggle inline detail-panel (of aside panel)
- Detail-panel toont:
  - **Dozen** (kaarten): naam, status badge, producten als lijst
  - Als `was_override = true`: amber badge "Afgeweken van advies" met `suggested_packaging_name`
  - **Engine advies** (als beschikbaar): confidence badge, outcome badge, geadviseerde dozen
  - **Vergelijking**: visueel naast elkaar als er zowel advies als werkelijke data is

Gebruik `useState` voor `expandedSessionId: string | null`. Fetch details on-demand bij uitklappen.

### Verificatie
- `npm run build` — geen TypeScript fouten
- Sessie-rij klikbaar, detail-panel opent, data correct

---

## Agent 4: Advies-feedback in Inpakscherm

### Doel
Na het voltooien van een sessie (alle dozen verzonden), toon een compact overzicht in het inpakscherm: "Engine adviseerde X, jij hebt Y gedaan".

### Context voor de agent

**Bestaand component**: `src/components/verpakking/VerpakkingsClient.tsx`
- Groot component (~900 regels)
- Heeft al `engineAdvice` state met `EngineAdvice` type
- Na het verzenden van alle dozen: `sessionCompleted` wordt `true` in het ship-response
- Sessie status gaat naar 'completed'
- De `ShipmentProgress` component toont verzendvoortgang

**Ship API response** (`POST /api/verpakking/sessions/[id]/ship`):
- Retourneert `sessionCompleted: boolean` als alle dozen verzonden zijn
- Op dat moment is `recordSessionOutcome()` al aangeroepen (server-side) → `outcome` en `deviation_type` staan in de DB

**Bestaand type**:
```typescript
interface EngineAdvice {
  id: string
  order_id: number
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: EngineAdviceBox[]
  unclassified_products: string[]
  tags_written: string[]
  weight_exceeded?: boolean
}
```

**Wat we willen**: na session completion, een feedback-banner tonen die de outcome samenvat:
- "Advies gevolgd" (emerald) als alle dozen matchen
- "Advies gewijzigd: X extra dozen" (blue) bij afwijking
- "Advies genegeerd" (amber) als totaal andere dozen

### Taken

#### 4a. Outcome ophalen na completion

**Bestaand bestand**: `src/components/verpakking/VerpakkingsClient.tsx`

Na `sessionCompleted = true` (in de ship response handler), fetch de outcome:

```typescript
// Bestaande ship handler ergens rond regel 600-700
// Na sessionCompleted = true:
if (data.sessionCompleted && engineAdvice) {
  fetch(`/api/verpakking/engine/log?orderId=${engineAdvice.order_id}&limit=1`)
    .then(res => res.json())
    .then(logData => {
      if (logData.advices?.[0]) {
        setOutcomeFeedback({
          outcome: logData.advices[0].outcome,
          deviationType: logData.advices[0].deviation_type,
        })
      }
    })
    .catch(() => {}) // Non-blocking
}
```

Of eenvoudiger: het ship-response kan de outcome direct meegeven. Voeg `outcome` en `deviation_type` toe aan het ship-response wanneer `sessionCompleted = true`.

**Aanpassen**: `src/app/api/verpakking/sessions/[id]/ship/route.ts`

Na `recordSessionOutcome(sessionId)`, fetch het outcome:
```typescript
if (sessionCompleted && adviceId) {
  const { data: adviceOutcome } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('outcome, deviation_type')
    .eq('id', adviceId)
    .single()
  // Include in response
}
```

**Makkelijkere aanpak**: de `recordSessionOutcome` functie retourneert al het outcome. Wijzig de functie signature om het outcome terug te geven.

#### 4b. Feedback-banner component

**Bestaand bestand**: `src/components/verpakking/VerpakkingsClient.tsx`

Voeg state toe:
```typescript
const [outcomeFeedback, setOutcomeFeedback] = useState<{
  outcome: string
  deviationType: string
} | null>(null)
```

Render een banner na session completion (naast/onder de ShipmentProgress):
- **Gevolgd** (emerald): "Engine-advies volledig gevolgd"
- **Gewijzigd** (blue): "Engine-advies aangepast" + subtext per type:
  - `extra_boxes`: "Extra dozen toegevoegd"
  - `fewer_boxes`: "Minder dozen gebruikt"
  - `different_packaging`: "Andere verpakking gekozen"
  - `mixed`: "Dozen aangepast"
- **Genegeerd** (amber): "Engine-advies niet gevolgd — andere verpakking gebruikt"
- **Geen advies** (gray): niet tonen

Compact, niet-blokkerend. Auto-dismiss na 10 seconden of wegklikbaar.

### Verificatie
- `npm run build` — geen TypeScript fouten
- Na verzenden: banner verschijnt met juiste outcome

---

## Agent 5: KPI Dashboard

### Doel
Nieuwe pagina `/verpakkingsmodule/dashboard` met KPI-kaarten, outcome verdeling, confidence-matrix, en top-patronen.

### Context voor de agent

**Database**: `batchmaker.packaging_advice` (zie Agent 2 context voor alle kolommen)

**Navigatie**: `src/app/(verpakkingsmodule)/verpakkingsmodule/layout.tsx` — `NAV_LINKS` array

**UI conventies**: zie Agent 1. Voor charts: gebruik **geen externe chart library**. Gebruik Tailwind CSS bars (div met percentage width + achtergrondkleur) voor simpele visualisaties. Dit houdt de bundle klein en vermijdt extra dependencies.

**Bestaand patroon**: KPI-kaarten zijn simpele divs met een label, getal, en optioneel percentage. Zie `ProductStatus.tsx` (Agent 1) voor referentie.

### Taken

#### 5a. API route: `GET /api/verpakking/dashboard/stats`

**Nieuw bestand**: `src/app/api/verpakking/dashboard/stats/route.ts`

Query parameters:
- `days` (default 30) — periode in dagen

Response:
```typescript
{
  period: { from: string; to: string; days: number }
  totals: {
    total_advices: number
    with_outcome: number        // outcome IS NOT NULL
    total_sessions: number      // packing_sessions in periode
  }
  outcomes: {
    followed: number
    modified: number
    ignored: number
    no_advice: number
    pending: number             // outcome IS NULL (nog niet afgerond)
  }
  deviations: {
    extra_boxes: number
    fewer_boxes: number
    different_packaging: number
    mixed: number
  }
  confidence_vs_outcome: {
    full_match: { followed: number; modified: number; ignored: number; total: number }
    partial_match: { followed: number; modified: number; ignored: number; total: number }
    no_match: { total: number }
  }
  top_fingerprints: {
    fingerprint: string
    count: number
    followed: number
    modified: number
    ignored: number
  }[]
  weight_issues: {
    total_exceeded: number
    percentage: number
  }
  product_coverage: {
    total_products: number
    classified: number
    unclassified: number
    coverage_percentage: number
  }
}
```

Queries:
```sql
-- Outcomes
SELECT outcome, COUNT(*) as count
FROM batchmaker.packaging_advice
WHERE calculated_at >= NOW() - INTERVAL '$days days'
  AND status != 'invalidated'
GROUP BY outcome;

-- Deviations
SELECT deviation_type, COUNT(*) as count
FROM batchmaker.packaging_advice
WHERE calculated_at >= NOW() - INTERVAL '$days days'
  AND status != 'invalidated'
  AND outcome = 'modified'
GROUP BY deviation_type;

-- Confidence vs outcome cross-tab
SELECT confidence, outcome, COUNT(*) as count
FROM batchmaker.packaging_advice
WHERE calculated_at >= NOW() - INTERVAL '$days days'
  AND status != 'invalidated'
  AND outcome IS NOT NULL
GROUP BY confidence, outcome;

-- Top fingerprints
SELECT shipping_unit_fingerprint as fingerprint,
       COUNT(*) as count,
       COUNT(*) FILTER (WHERE outcome = 'followed') as followed,
       COUNT(*) FILTER (WHERE outcome = 'modified') as modified,
       COUNT(*) FILTER (WHERE outcome = 'ignored') as ignored
FROM batchmaker.packaging_advice
WHERE calculated_at >= NOW() - INTERVAL '$days days'
  AND status != 'invalidated'
  AND shipping_unit_fingerprint IS NOT NULL
  AND outcome IS NOT NULL
GROUP BY shipping_unit_fingerprint
ORDER BY count DESC
LIMIT 10;

-- Weight issues
SELECT COUNT(*) FILTER (WHERE weight_exceeded = true) as total_exceeded,
       COUNT(*) as total
FROM batchmaker.packaging_advice
WHERE calculated_at >= NOW() - INTERVAL '$days days'
  AND status != 'invalidated';

-- Product coverage
SELECT classification_status, COUNT(*) as count
FROM batchmaker.product_attributes
GROUP BY classification_status;

-- Total sessions in period
SELECT COUNT(*) FROM batchmaker.packing_sessions
WHERE created_at >= NOW() - INTERVAL '$days days';
```

#### 5b. Pagina en navigatie

**Nieuw bestand**: `src/app/(verpakkingsmodule)/verpakkingsmodule/dashboard/page.tsx`
- Rendert `<Dashboard />` component

**Bestaand bestand**: `src/app/(verpakkingsmodule)/verpakkingsmodule/layout.tsx`
- Voeg toe aan `NAV_LINKS` (na 'Engine Log', voor 'Instellingen'):
  ```typescript
  { href: '/verpakkingsmodule/dashboard', label: 'Dashboard' },
  ```

#### 5c. Component: `Dashboard.tsx`

**Nieuw bestand**: `src/components/verpakking/Dashboard.tsx`

**Periode-selector** (bovenaan rechts):
- Dropdown: 7 dagen / 14 dagen / 30 dagen / 90 dagen
- Default: 30 dagen
- Bij wijziging: re-fetch data

**Sectie 1: KPI-kaarten** (4 kaarten in een grid, `grid-cols-2 md:grid-cols-4`):

| Kaart | Waarde | Kleur |
|-------|--------|-------|
| Totaal adviezen | `total_advices` | gray |
| Advies gevolgd | `followed / with_outcome * 100`% | emerald |
| Advies aangepast | `modified / with_outcome * 100`% | blue |
| Advies genegeerd | `ignored / with_outcome * 100`% | amber |

Elke kaart: groot getal, klein label, percentage balk eronder.

**Sectie 2: Outcome verdeling** (horizontale gestapelde balk):
- Followed (emerald) + Modified (blue) + Ignored (amber) + Pending (gray)
- Percentages als labels
- Legenda eronder

**Sectie 3: Afwijkingsanalyse** (alleen als `modified > 0`):
- Simpele bar chart (Tailwind divs): extra_boxes, fewer_boxes, different_packaging, mixed
- Per bar: label + getal + percentage balk

**Sectie 4: Confidence vs. Outcome matrix** (tabel):

| | Gevolgd | Gewijzigd | Genegeerd | Totaal |
|---|---|---|---|---|
| Full match | X | Y | Z | N |
| Partial match | X | Y | Z | N |
| No match | — | — | — | N |

Cellen met percentages, achtergrondkleur op basis van nalevingspercentage (emerald voor >80%, amber voor 50-80%, red voor <50%).

**Sectie 5: Top-10 orderpatronen** (tabel):
- Kolommen: Fingerprint (bijv. "P10,5:2 | P14:3"), Aantal, Gevolgd, Gewijzigd, Genegeerd
- Elke fingerprint als leesbare tekst (de `|` gescheiden string)
- Sorteer op count desc

**Sectie 6: Systeem-gezondheid** (2 compacte kaarten):
- Product dekking: `classified / total * 100`% met voortgangsbalk
- Gewichtsproblemen: `total_exceeded` met percentage

**Lege staat**: als `total_advices === 0`:
- "Nog geen data beschikbaar. Begin met inpakken om dashboard-data te verzamelen."
- Icoon: BarChart3 of TrendingUp van lucide-react

### Verificatie
- `npm run build` — geen TypeScript fouten
- Dashboard rendert met mock/echte data
- Periode-selector wisselt data
- Alle secties correct

---

## Agent 6: Strategische Rapportage

### Doel
Uitbreiding van het dashboard met trends over tijd, kostenimpact, en probleemproducten.

### Context voor de agent

**Afhankelijkheid**: Agent 5 moet eerst afgerond zijn. Dit agent breidt het bestaande dashboard uit.

**Bestaand bestand**: `src/components/verpakking/Dashboard.tsx` (gebouwd door Agent 5)
**Bestaande API**: `GET /api/verpakking/dashboard/stats` (gebouwd door Agent 5)

**Database**: zie Agent 2 en Agent 5 context

**UI**: geen externe chart libraries. Gebruik Tailwind CSS voor simpele lijngrafieken (serie van puntjes/balkjes per week). Als dit te beperkt is voor lijngrafieken: gebruik `<svg>` inline voor een simpele lijn.

### Taken

#### 6a. API route: `GET /api/verpakking/dashboard/trends`

**Nieuw bestand**: `src/app/api/verpakking/dashboard/trends/route.ts`

Query parameters:
- `weeks` (default 12) — aantal weken terug

Response:
```typescript
{
  weekly_data: {
    week_start: string       // ISO date van maandag
    total_advices: number
    followed: number
    modified: number
    ignored: number
    follow_rate: number      // percentage
  }[]
  problem_products: {
    productcode: string
    product_name: string
    times_unclassified: number
    times_ignored: number    // in orders waar dit product zat en advies genegeerd werd
  }[]
  cost_impact: {
    total_advised_cost: number
    total_actual_cost: number
    potential_savings: number
  } | null  // null als packagings geen kosten hebben
  carrier_breakdown: {
    shipping_provider_profile_id: number
    count: number
    followed: number
    follow_rate: number
  }[]
}
```

Queries:
```sql
-- Weekly trend
SELECT date_trunc('week', calculated_at) as week_start,
       COUNT(*) as total_advices,
       COUNT(*) FILTER (WHERE outcome = 'followed') as followed,
       COUNT(*) FILTER (WHERE outcome = 'modified') as modified,
       COUNT(*) FILTER (WHERE outcome = 'ignored') as ignored
FROM batchmaker.packaging_advice
WHERE calculated_at >= NOW() - INTERVAL '$weeks weeks'
  AND status != 'invalidated'
  AND outcome IS NOT NULL
GROUP BY week_start
ORDER BY week_start;

-- Problem products: most common in unclassified
SELECT productcode, product_name, COUNT(*) as times_unclassified
FROM batchmaker.product_attributes
WHERE classification_status = 'unclassified'
GROUP BY productcode, product_name
ORDER BY times_unclassified DESC
LIMIT 15;

-- Cost impact (only if packagings have costs)
-- For each advice: sum costs of advised boxes vs actual boxes
-- This requires joining packaging_advice.advice_boxes with packagings table
-- Complex query - see implementation notes below

-- Carrier breakdown
SELECT shipping_provider_profile_id,
       COUNT(*) as count,
       COUNT(*) FILTER (WHERE outcome = 'followed') as followed
FROM batchmaker.packaging_advice
WHERE calculated_at >= NOW() - INTERVAL '$weeks weeks'
  AND status != 'invalidated'
  AND outcome IS NOT NULL
  AND shipping_provider_profile_id IS NOT NULL
GROUP BY shipping_provider_profile_id
ORDER BY count DESC;
```

**Kosten berekening** (implementatienota):
De `advice_boxes` is JSONB met `idpackaging` per box. De `actual_boxes` is JSONB met `picqer_packaging_id` per box. Join deze met `packagings` tabel (die `handling_cost` en `material_cost` heeft) om totale kosten te berekenen. Dit kan in applicatie-code (fetch advices + packagings, bereken in TypeScript) of met een JSONB query. Kies wat het eenvoudigst is.

#### 6b. Dashboard uitbreiden

**Bestaand bestand**: `src/components/verpakking/Dashboard.tsx`

Voeg toe na de bestaande secties:

**Sectie 7: Trend over tijd** (lijn/bar visualisatie):
- X-as: weken (labels: "Week 1", "Week 2", ... of datums)
- Y-as: nalevingspercentage (0-100%)
- Simpelste implementatie: een reeks verticale balkjes (bar chart) per week
- Per balk: hoogte = follow_rate percentage, kleur = emerald
- Tooltip of label boven/onder elke balk met het percentage
- Totaal adviezen als kleine tekst per week

**Sectie 8: Probleemproducten** (tabel):
- Kolommen: Productcode, Productnaam, Keer ongeclassificeerd
- Top 10, gesorteerd op frequentie
- "Dit zijn producten die de engine niet kan classificeren — overweeg hun product-attributen in Picqer aan te vullen"

**Sectie 9: Kostenimpact** (kaart, alleen als data beschikbaar):
- "Advies vs. werkelijk": twee bedragen naast elkaar
- "Potentiele besparing": verschil, groen als positief
- Kleine disclaimer: "Gebaseerd op ingevulde kosten per verpakking"

**Sectie 10: Carrier verdeling** (tabel):
- Kolommen: Carrier profiel ID, Aantal orders, Naleving, Nalevingspercentage
- Gesorteerd op aantal desc

### Verificatie
- `npm run build` — geen TypeScript fouten
- Trend-balkjes renderen correct
- Probleemproducten tabel vult
- Kostenimpact kaart toont (of verbergt als geen data)

---

## Samenvatting: Bestanden per Agent

### Agent 1 — Operationele Instellingen-tabs
| Actie | Bestand |
|-------|---------|
| NIEUW | `src/components/verpakking/ProductStatus.tsx` |
| NIEUW | `src/components/verpakking/ShippingUnitList.tsx` |
| NIEUW | `src/app/api/verpakking/products/status/route.ts` |
| WIJZIG | `src/app/api/verpakking/shipping-units/route.ts` (product counts) |
| WIJZIG | `src/components/verpakking/CompartmentRules.tsx` (dekkingsbanner) |
| WIJZIG | `src/app/(verpakkingsmodule)/verpakkingsmodule/instellingen/page.tsx` (2 tabs) |

### Agent 2 — Engine Advieslog
| Actie | Bestand |
|-------|---------|
| NIEUW | `src/app/api/verpakking/engine/log/route.ts` |
| NIEUW | `src/app/(verpakkingsmodule)/verpakkingsmodule/engine-log/page.tsx` |
| NIEUW | `src/components/verpakking/EngineLog.tsx` |
| WIJZIG | `src/app/(verpakkingsmodule)/verpakkingsmodule/layout.tsx` (nav link) |

### Agent 3 — Sessiedetails
| Actie | Bestand |
|-------|---------|
| NIEUW | `src/app/api/verpakking/sessions/[id]/details/route.ts` |
| WIJZIG | `src/components/verpakking/SessionHistory.tsx` (detail panel) |

### Agent 4 — Advies-feedback
| Actie | Bestand |
|-------|---------|
| WIJZIG | `src/lib/engine/feedbackTracking.ts` (return outcome) |
| WIJZIG | `src/app/api/verpakking/sessions/[id]/ship/route.ts` (outcome in response) |
| WIJZIG | `src/components/verpakking/VerpakkingsClient.tsx` (feedback banner) |

### Agent 5 — KPI Dashboard
| Actie | Bestand |
|-------|---------|
| NIEUW | `src/app/api/verpakking/dashboard/stats/route.ts` |
| NIEUW | `src/app/(verpakkingsmodule)/verpakkingsmodule/dashboard/page.tsx` |
| NIEUW | `src/components/verpakking/Dashboard.tsx` |
| WIJZIG | `src/app/(verpakkingsmodule)/verpakkingsmodule/layout.tsx` (nav link) |

### Agent 6 — Strategische Rapportage
| Actie | Bestand |
|-------|---------|
| NIEUW | `src/app/api/verpakking/dashboard/trends/route.ts` |
| WIJZIG | `src/components/verpakking/Dashboard.tsx` (secties 7-10) |

---

## Context-window management per agent

| Agent | Geschatte context | Strategie |
|-------|-------------------|-----------|
| 1 | ~15K tokens input | 3 kleine componenten, geen kruisafhankelijkheden. Fit in 1 sessie. |
| 2 | ~12K tokens input | 1 API route + 1 component. Fit in 1 sessie. |
| 3 | ~10K tokens input | 1 API route + wijziging bestaand component. Moet SessionHistory.tsx lezen (~600 regels). Fit in 1 sessie. |
| 4 | ~8K tokens input | 3 kleine wijzigingen. Kleinste agent. Fit in 1 sessie. |
| 5 | ~18K tokens input | Grootste agent: 1 complexe API route + 1 groot component. SQL queries zijn complex. Fit in 1 sessie maar aan de grens. |
| 6 | ~12K tokens input | Bouwt voort op Agent 5 output. Moet Dashboard.tsx lezen. Fit in 1 sessie. |

### Tips voor agents:
- Lees alleen de bestanden die je moet wijzigen
- Gebruik de exacte database kolom-namen uit dit plan
- Gebruik `supabase.schema('batchmaker')` voor alle queries — NIET de public schema
- Schrijf Nederlandse UI tekst, technische variabelen in Engels
- Test met `npm run build` aan het eind
- Gebruik lucide-react voor icons, geen andere icon library
