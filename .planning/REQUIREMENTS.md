# Requirements — Kostengeoptimaliseerd Verpakkingsadvies

**Core Value:** De engine adviseert altijd de verpakkingsoptie met de laagste totaalkosten (doos + transport + handling) per bestemmingsland.

---

## v1 Requirements

### Cost Data Layer

| ID | Requirement | Acceptance Criteria |
|----|------------|---------------------|
| DATA-01 | Transport tarieven ophalen uit facturatie Supabase | `costProvider.ts` leest `packaging_costs` JOIN `shipping_rates` uit facturatie Supabase; data gecached in-memory met 15 min TTL; facturatie client via bestaande `FACTURATIE_SUPABASE_URL` env var |
| DATA-02 | Carrier routing tabel | Engine gebruikt `is_preferred = true` flag uit `shipping_rates` om juiste carrier per doos/land te selecteren; join key is packaging barcode/SKU |
| DATA-03 | Graceful degradation | Bij onbereikbare facturatie DB valt engine terug op huidige specificiteit-ranking; `cost_data_available: false` flag op resultaat; geen crash, geen silent wrong advice |

### Engine Logic

| ID | Requirement | Acceptance Criteria |
|----|------------|---------------------|
| ENG-01 | Cost-primary ranking | `rankPackagings()` sorteert primair op `total_cost ASC` (dooskosten + transportkosten + handling); specificiteit en volume als tiebreakers; multi-box solver aggregeert kosten correct |
| ENG-02 | Country threading | `calculateAdvice()` accepteert `countryCode` parameter; waarde komt uit Picqer order `deliveryaddress.country` via `TransformedOrder.bezorgland`; required parameter — geen silent NL default |

### API & UI

| ID | Requirement | Acceptance Criteria |
|----|------------|---------------------|
| API-01 | Country param in engine API | `POST /api/verpakking/engine/calculate` accepteert `countryCode` in request body; valideert tegen bekende landcodes (NL, BE, DE, FR, AT, LU, SE, IT, ES); VerpakkingsClient/usePackingSession stuurt country mee |
| UI-01 | Cost breakdown in UI | Engine advies toont per voorgestelde doos: dooskosten, transportkosten, totaalkosten; zichtbaar in VerpakkingsClient advies-panel |

---

## v2 Requirements (deferred)

| ID | Requirement | Rationale voor defer |
|----|------------|---------------------|
| ENG-03 | Route filtering — dozen uitsluiten als route niet beschikbaar | Komt in v2; v1 focust op kosten-ranking met beschikbare routes |
| ENG-04 | Shadow mode — cost-ranking naast huidige ranking loggen zonder live te gaan | Niet nodig als v1 direct geactiveerd wordt; kan later alsnog als rollback-mechanisme |
| ENG-05 | Multi-box cost optimization — niet-greedy solver | Alleen als greedy solver observeerbaar suboptimale splits produceert |
| UI-02 | Carrier override UI — CRUD in instellingen voor carrier-box-country mappings | Carrier mapping verandert zelden; handmatige DB update volstaat |
| UI-03 | A/B dashboard — vergelijking oude vs nieuwe ranking | Volgt uit shadow mode; beide deferred |
| DATA-04 | Auto cache invalidation — Inngest cron voor dagelijkse cost sync | Handmatige trigger volstaat; kosten wijzigen zelden |

---

## Out of Scope

- Facturatie app aanpassen (read-only, single source of truth)
- Verkooprijs/marge berekening (facturatie-domein)
- Carrier contract onderhandelingen / tariefwijzigingen
- Dynamische carrier selectie (carrier per doos/land staat vast)
- Handling kosten configuratie UI (bestaande instellingen volstaan)

---

## Constraints

| Constraint | Impact |
|-----------|--------|
| Facturatie = read-only | Alleen SELECT queries; geen writes naar facturatie Supabase |
| Engine snelheid = real-time | In-memory cache verplicht; geen live DB calls per advies-berekening |
| Picqer rate limits = 500 req/min | Bestaande `rateLimitedFetch()` wrapper gebruiken |
| Backward compatible | Bestaande engine flow mag niet breken; uitbreiden, niet vervangen |

---

## Dependencies

| Dependency | Status | Owner |
|-----------|--------|-------|
| Facturatie Supabase tabellen (`packaging_costs`, `shipping_rates`) | Seed data klaar in FACTURATIE_SPEC.md | Kenny (handmatig) |
| `FACTURATIE_SUPABASE_URL` + `FACTURATIE_SUPABASE_ANON_KEY` env vars | Bestaan al in .env.local | Geconfigureerd |
| Bestaande `facturatieClient.ts` Supabase client | Bestaat al | Codebase |
| Picqer order `deliveryaddress.country` | Beschikbaar via bestaande order transform | Codebase |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1: Cost Data Layer | Complete |
| DATA-02 | Phase 1: Cost Data Layer | Complete |
| DATA-03 | Phase 1: Cost Data Layer | Complete |
| ENG-01 | Phase 2: Cost-Primary Ranking | Complete |
| ENG-02 | Phase 1: Cost Data Layer | Complete |
| API-01 | Phase 3: API + UI Integration | Complete |
| UI-01 | Phase 3: API + UI Integration | Complete |

---
*Generated: 2026-02-24*
