# Kostengeoptimaliseerd Verpakkingsadvies

## What This Is

Uitbreiding van de bestaande packaging advice engine in de EveryPlants Batchmaker, zodat de engine de **goedkoopste** verpakkingsoptie adviseert op basis van totale kosten (doos + transport + handling) per bestemmingsland. Dit vervangt de huidige ranking op specificiteit/grootte door een kostengedreven ranking, en voegt ondersteuning toe voor single-product orders.

## Core Value

De engine moet altijd de verpakkingsoptie adviseren met de laagste totaalkosten, zodat EveryPlants per order de goedkoopste verzendwijze kiest.

## Requirements

### Validated

<!-- Bestaande capabilities die al werken in de codebase -->

- ✓ Product → Shipping Unit classificatie (potmaat, hoogte, type) — `src/lib/engine/packagingEngine.ts`
- ✓ Compartment rules matching (EN/OF/ALTERNATIEF operators) — `compartment_rules` tabel
- ✓ Multi-box bin-packing (greedy solver) — `solveMultiBox()`
- ✓ Tag schrijven naar Picqer order na advies — `addOrderTag()`
- ✓ Verpakkingen beheer UI (sync uit Picqer + engine config) — `/verpakkingsmodule/instellingen`
- ✓ Compartment rules beheer UI — `CompartmentRules.tsx`
- ✓ Product classificatie en sync — `product_attributes` tabel

### Active

<!-- Nieuwe scope voor dit project -->

- [ ] Engine rankt verpakkingsopties op totale kosten (doos + transport + handling) i.p.v. specificiteit/grootte
- [ ] Engine haalt kostprijzen op uit facturatie Supabase (dooskosten, transporttarieven per carrier/land)
- [ ] Engine kent het bestemmingsland van de order (uit Picqer order data)
- [ ] Engine bepaalt juiste carrier per doos/land combinatie (PostNL vs DPD vs De Rooy/TOV)
- [ ] Single-product orders krijgen correct verpakkingsadvies
- [ ] Kostdata wordt gecached (in-memory, 10-15 min TTL) voor snelle engine respons
- [ ] Engine berekent totaalkosten: dooskosten (inkoop) + transportkosten (carrier/land) + handling per product

### Out of Scope

- Facturatie app aanpassen — die is source of truth, we lezen alleen
- Verkooprijs/marge berekening — dat is facturatie-domein
- Carrier contract onderhandelingen / tariefwijzigingen
- Handling kosten configuratie UI (bestaande instellingen volstaan)
- Dynamische carrier selectie (carrier per doos/land staat redelijk vast)

## Context

### Bestaande Engine
De packaging engine (`src/lib/engine/packagingEngine.ts`) classifieert producten naar shipping units, matcht compartment rules, en rankt op specificiteit → grootte → kosten. De kostencomponent is nu rudimentair — het moet de primaire ranking factor worden.

### Kostenstructuur (3 lagen)
1. **Dooskosten** — inkoopprijs doos + interieur + strap (bijv. Fold box 130 = €3,27)
2. **Transportkosten** — per carrier per land per doos, inclusief variabele toeslagen (diesel, tol, grootte)
3. **Handling** — per product per doos

### Carriers
- **PostNL** — kleine/middelgrote dozen NL/BE, sommige internationale
- **DPD** — grotere dozen, Duitsland, internationale bestemmingen
- **De Rooy** — pallets en colli (NL/BE/LU)
- **TOV** — pallets Duitsland/Frankrijk

### Carrier-doos-land Matrix
Per doos per bestemmingsland is vastgelegd welke carrier gebruikt wordt (PostNL of DPD). Dit verandert zelden. Staat momenteel in Excel, transport tarieven in facturatie Supabase.

### Facturatie App
Separate Supabase instance (`FACTURATIE_SUPABASE_URL`) met alle kostprijzen. Batchmaker leest hier direct uit met de bestaande anon key. Schema en tabellen moeten verkend worden.

### Data Beschikbaarheid
- Bestemmingsland: beschikbaar op Picqer order (`deliveryaddress.country`)
- Dooskosten: in facturatie Supabase
- Transport tarieven: in facturatie Supabase (per carrier, per doos, per land)
- Handling kosten: te bepalen (mogelijk per shipping unit of per doos)

## Constraints

- **Facturatie = read-only**: We lezen uit de facturatie database, schrijven er niet naartoe
- **Engine snelheid**: Advies moet real-time zijn tijdens inpakken — caching van kostdata is vereist
- **Picqer rate limits**: Max 500 req/min, bestaande `rateLimitedFetch()` wrapper gebruiken
- **Bestaande engine**: Uitbreiden, niet vervangen — backward compatible met huidige flow

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Kosten uit facturatie Supabase ophalen | Single source of truth, al geconfigureerd | — Pending |
| Direct Supabase query + in-memory cache | Simpelste aanpak, kosten veranderen zelden, env vars bestaan al | — Pending |
| Ranking wijzigen naar kosten-primair | Goedkoopste optie is business requirement | — Pending |
| Carrier per doos/land als configuratie | Verandert zelden, hoeft niet dynamisch berekend | — Pending |

---
*Last updated: 2026-02-24 after initialization*
