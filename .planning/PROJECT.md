# Kostengeoptimaliseerd Verpakkingsadvies

## What This Is

Uitbreiding van de bestaande packaging advice engine in de EveryPlants Batchmaker, zodat de engine de **goedkoopste** verpakkingsoptie adviseert op basis van totale kosten (doos + pick/pack + transport) per bestemmingsland. v2 repareert de gebroken kostdata-pipeline door te lezen van de `published_box_costs` tabel (pre-calculated door facturatie-app), voegt weight bracket support toe, implementeert een niet-greedy multi-box solver, en biedt een single-SKU fast path voor directe product → verpakking mapping.

## Core Value

De engine adviseert altijd de verpakkingsoptie met de laagste totaalkosten (doos + pick/pack + transport) per bestemmingsland, met correcte SKU mapping en gewichtsafhankelijke transportkosten.

## Current Milestone: v2.0 Kostengeoptimaliseerd Verpakkingsadvies

**Goal:** Repareer de gebroken kostdata-pipeline en bouw kostenoptimale verpakkingsadvies op basis van `published_box_costs` contract met facturatie-app.

**Target features:**
- costProvider herschrijven naar `published_box_costs` (cross-DB read)
- `facturatie_box_sku` mapping voor alle 22 actieve dozen (6 mismatches gerepareerd)
- Weight bracket berekening en selectie (PostNL: 4 brackets)
- Pick/pack kosten in totaalberekening (box_material + pick + pack + transport)
- Niet-greedy multi-box solver (kostenoptimaal i.p.v. volume-greedy)
- Single-SKU product → verpakking directe mapping
- Cache invalidatie via webhook van facturatie-app
- Kostenbreakdown tonen per doos in UI

## Requirements

### Validated

<!-- Shipped en confirmed in v1.0 milestone -->

- ✓ Product → Shipping Unit classificatie (potmaat, hoogte, type) — v1.0
- ✓ Compartment rules matching (EN/OF/ALTERNATIEF operators) — v1.0
- ✓ Multi-box bin-packing (greedy solver) — v1.0
- ✓ Tag schrijven naar Picqer order na advies — v1.0
- ✓ Verpakkingen beheer UI (sync uit Picqer + engine config) — v1.0
- ✓ Compartment rules beheer UI — v1.0
- ✓ Product classificatie en sync — v1.0
- ✓ Country threading door calculateAdvice (countryCode parameter) — v1.0
- ✓ Country param in engine API + auto-send vanuit VerpakkingsClient — v1.0
- ✓ Cost-primary ranking in rankPackagings (total_cost ASC) — v1.0
- ✓ Basic cost breakdown in UI advies-panel — v1.0
- ✓ Graceful degradation bij onbereikbare facturatie DB — v1.0
- ✓ Cost data ophalen uit facturatie Supabase met 15-min cache — v1.0

### Active

<!-- v2.0 scope — building toward these -->

- [ ] costProvider leest van `published_box_costs` via cross-DB read (vervangt v1 shipping_rates/packaging_costs)
- [ ] `facturatie_box_sku` kolom + mapping voor alle actieve dozen (6 mismatches + 16 correcte)
- [ ] Weight bracket berekening (totaalgewicht per box → juiste bracket)
- [ ] Pick/pack kosten in total_cost formule (box_material + pick + pack + transport)
- [ ] Niet-greedy multi-box solver (kostenoptimale combinaties)
- [ ] Single-SKU product → verpakking directe mapping
- [ ] Cache invalidatie via webhook POST van facturatie-app
- [ ] Uitgebreide kostenbreakdown per doos (doos + pick/pack + transport + totaal)
- [ ] Bestemmingsland en carrier tonen bij kostenadvies
- [ ] SKU mapping validatie bij startup

### Out of Scope

- Facturatie app aanpassen — read-only, single source of truth
- Verkooprijs/marge berekening — facturatie-domein
- Carrier contract onderhandelingen / tariefwijzigingen
- Carrier override UI — carrier mapping verandert zelden
- A/B dashboard — vergelijking oud vs nieuw deferred
- Real-time kostenmonitoring dashboard — Phase 3 vision
- Predictive cost analytics — Phase 3 vision

## Context

### Bestaande Engine (v1)
De packaging engine classifieert producten naar shipping units, matcht compartment rules, en rankt op kosten. v1 leest van `packaging_costs` en `shipping_rates` tabellen die niet overeenkomen met het echte facturatie schema. 6 van 22 dozen hebben een SKU mismatch, handling-kosten staan op EUR 0,00.

### Architectuur v2: Twee Aparte Apps
Facturatie berekent en publiceert naar `published_box_costs` tabel. Batchmaker consumeert via `facturatieClient.ts` cross-DB read. Kosten wijzigen maandelijks — pre-calculatie volstaat.

### published_box_costs Contract
Pre-calculated tabel met ~350-400 rijen. Kolommen: box_sku, country_code, carrier_code, tariff_class, weight_bracket, is_pallet, vehicle_type, box_material_cost, box_pick_cost, box_pack_cost, transport_purchase_cost, total_cost, calculated_at. UNIQUE(box_sku, country_code, weight_bracket).

### Bekende SKU Mismatches
| Batchmaker barcode | Facturatie SKU | Naam |
|---|---|---|
| `55_922` | `55_950` | 2x Surprise box strapped |
| `55_896` | `55_922` | Tupe box 130cm big |
| `55_897` | `55_923` | Tupe box 130cm small |
| `55_1180` | `55_926-1` | Eurobox 40 met 3 trays |
| `55_1178` | `55_1` | Envelop |
| `55_900` | `55_917` | EWP/EUP |

Alleen in batchmaker (geen facturatie equivalent): `55_890` (Orchidee doos), `55_891` (Kokerdoos P15), `55_1053` (Kokerdoos 60).

### Weight Brackets
PostNL: 4 brackets (0-5kg, 5-10kg, 10-20kg, 20-30kg). DPD/pallet/postal: NULL (1 rij per box × land).

### Facturatie Supabase
Project ID: fmockihnrkijlzsrvbff. Read-only via anon key.

## Constraints

- **Facturatie = read-only**: Alleen SELECT queries via `facturatieClient.ts`
- **Engine snelheid = real-time**: In-memory cache verplicht (15-min TTL)
- **Backward compatible**: Engine flow (classify → match → enrich → rank → solve) blijft intact
- **Picqer rate limits**: Max 500 req/min, bestaande `rateLimitedFetch()` wrapper
- **Dependency**: MVP testbaar nadat facturatie `published_box_costs` gevuld heeft
- **API contract**: `POST /api/verpakking/engine/calculate` behoudt zelfde interface

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Kosten uit facturatie Supabase ophalen | Single source of truth | ✓ Good (v1) |
| Direct Supabase query + in-memory cache | Simpelste aanpak, kosten wijzigen zelden | ✓ Good (v1) |
| Ranking wijzigen naar kosten-primair | Goedkoopste optie is business requirement | ✓ Good (v1) |
| Twee aparte apps met helder contract | Geen codebase merge, facturatie berekent/publiceert | — Pending (v2) |
| `published_box_costs` als enig contract | Single point of truth, pre-calculated | — Pending (v2) |
| `facturatie_box_sku` als join key | Repareert 6 mismatches, expliciete mapping | — Pending (v2) |
| Pick/pack per doostype (niet per SKU) | Facturatie levert box_pick_cost + box_pack_cost uit sku_pricing | — Pending (v2) |
| Webhook voor cache invalidatie | Simpeler dan Inngest cross-account, facturatie POSTt bij tariefwijziging | — Pending (v2) |
| Niet-greedy multi-box solver met timeout | 200ms timeout → greedy fallback, max 4-5 dozen | — Pending (v2) |

---
*Last updated: 2026-02-25 after milestone v2.0 initialization*
