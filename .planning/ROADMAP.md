# Roadmap: Kostengeoptimaliseerd Verpakkingsadvies

## Milestones

- ✅ **v1.0 Cost Data MVP** - Phases 1-3 (shipped 2026-02-24)
- 🚧 **v2.0 Kostengeoptimaliseerd Verpakkingsadvies** - Phases 4-6 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 Cost Data MVP (Phases 1-3) - SHIPPED 2026-02-24</summary>

- [x] **Phase 1: Cost Data Layer** - Kostdata ophalen uit facturatie Supabase, country threading door engine, caching en graceful degradation
- [x] **Phase 2: Cost-Primary Ranking** - Engine ranking wijzigen naar totale kosten als primaire sortering
- [x] **Phase 3: API + UI Integration** - Country parameter in API, kostbreakdown tonen in inpakscherm

### Phase 1: Cost Data Layer
**Goal**: De engine beschikt over volledige kostdata per doos per land, kent het bestemmingsland van elke order, en degradeert graceful als kostdata niet beschikbaar is
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, ENG-02
**Success Criteria** (what must be TRUE):
  1. `costProvider.getAllCostsForCountry("DE")` retourneert een gesorteerde lijst van alle dozen met dooskosten, transportkosten en totaalkosten voor Duitsland, opgehaald uit facturatie Supabase
  2. Cost data wordt in-memory gecached met 15 minuten TTL -- een tweede call binnen de TTL raakt niet de facturatie database
  3. Voor elke doos/land combinatie selecteert de provider de preferred carrier (`is_preferred = true`) en negeert niet-beschikbare routes (`is_available = false`)
  4. Wanneer de facturatie database onbereikbaar is, retourneert de engine een resultaat met `cost_data_available: false` en valt terug op de bestaande specificiteit-ranking, zonder crash
  5. `calculateAdvice()` accepteert een `countryCode` parameter (vereist, geen silent default) afkomstig uit Picqer order `deliveryaddress.country`
**Plans**: 2 plans

Plans:
- [x] 01-01: Build costProvider.ts with cached facturatie data access and CostEntry type
- [x] 01-02: Thread countryCode through engine, API route, and VerpakkingsClient + DB migration

### Phase 2: Cost-Primary Ranking
**Goal**: De engine rankt verpakkingsopties primair op totale kosten (laagste eerst), met specificiteit en volume als tiebreakers
**Depends on**: Phase 1
**Requirements**: ENG-01
**Success Criteria** (what must be TRUE):
  1. `rankPackagings()` sorteert primair op `total_cost ASC` (dooskosten + transportkosten); bij gelijke kosten wordt gesorteerd op specificiteit en volume zoals voorheen
  2. Een `enrichWithCosts()` stap verrijkt elke `PackagingMatch` met `box_cost`, `transport_cost` en `total_cost` velden voordat ranking plaatsvindt
  3. Bij multi-box advies (meerdere dozen per order) worden de kosten per doos correct geaggregeerd naar een totaalprijs voor de complete oplossing
  4. Dozen waarvoor geen preferred route bestaat voor het bestemmingsland worden uitgesloten als kandidaat (niet als zero-cost behandeld)
**Plans**: 2 plans

Plans:
- [x] 02-01: Enrich matches with cost data, cost-primary rankPackagings sort, thread cost map through solveMultiBox, cost fields on AdviceBox
- [x] 02-02: Gap closure: add missing enrichWithCosts call on mixable fallback path in solveMultiBox

### Phase 3: API + UI Integration
**Goal**: Medewerkers zien bij het inpakken per geadviseerde doos de kostenopbouw (doos + transport + totaal) en het bestemmingsland wordt automatisch meegegeven vanuit de order
**Depends on**: Phase 2
**Requirements**: API-01, UI-01
**Success Criteria** (what must be TRUE):
  1. `POST /api/verpakking/engine/calculate` accepteert `countryCode` in de request body en valideert tegen bekende landcodes (NL, BE, DE, FR, AT, LU, SE, IT, ES)
  2. VerpakkingsClient/usePackingSession stuurt automatisch het bestemmingsland van de Picqer order mee bij het berekenen van verpakkingsadvies -- de medewerker hoeft dit niet handmatig in te vullen
  3. Het advies-panel in het inpakscherm toont per voorgestelde doos: dooskosten, transportkosten en totaalkosten
  4. Wanneer kostdata niet beschikbaar was (`cost_data_available: false`), toont de UI een waarschuwing dat het advies op basis van specificiteit is gegeven in plaats van kosten
**Plans**: 1 plan

Plans:
- [x] 03-01: Cost display in advice UI + API country code verification

</details>

### 🚧 v2.0 Kostengeoptimaliseerd Verpakkingsadvies (In Progress)

**Milestone Goal:** Repareer de gebroken kostdata-pipeline en bouw kostenoptimaal verpakkingsadvies op basis van `published_box_costs` contract met facturatie-app, inclusief weight brackets, pick/pack kosten, niet-greedy multi-box solver, en single-SKU fast path.

- [ ] **Phase 4: Cost Data Layer v2** - SKU mapping, costProvider herschrijven naar published_box_costs, weight bracket berekening, cache invalidatie webhook
- [ ] **Phase 5: Engine Optimization** - Niet-greedy multi-box solver, single-SKU fast path, kostenoptimale ranking met weight brackets en pick/pack
- [ ] **Phase 6: Integration & Display** - Uitgebreide kostenbreakdown in UI, bestemmingsland/carrier display, degradatie-waarschuwingen

## Phase Details

### Phase 4: Cost Data Layer v2
**Goal**: De engine leest correcte kostdata van `published_box_costs` via de juiste SKU mapping, berekent weight brackets, en invalideert cache via webhook -- zodat alle downstream engine-logica op betrouwbare data draait
**Depends on**: Phase 3 (v1.0)
**Requirements**: SKU-01, SKU-02, SKU-03, COST-01, COST-02, COST-03, COST-04, WEIGHT-01, WEIGHT-02, WEIGHT-03, DEGRAD-01, DEGRAD-03
**Success Criteria** (what must be TRUE):
  1. De costProvider haalt kostdata op uit `published_box_costs` via `facturatie_box_sku` als join key, en retourneert per doos/land/weight_bracket: box_material_cost, box_pick_cost, box_pack_cost, transport_purchase_cost en total_cost
  2. Elke actieve verpakking in batchmaker heeft een `facturatie_box_sku` kolom; bij startup worden ontbrekende mappings als warning gelogd
  3. Het systeem berekent het totaalgewicht per gevulde doos en selecteert de juiste weight bracket (PostNL: 4 brackets; DPD/pallet: NULL)
  4. Een inkomende webhook POST van de facturatie-app invalideert de cost cache onmiddellijk, en bij onbereikbare facturatie DB valt het systeem terug op specificiteit-ranking zonder crash
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — SKU mapping: DB migration, seed data, admin UI voor facturatie_box_sku
- [x] 04-02-PLAN.md — costProvider rewrite naar published_box_costs + webhook endpoint + SKU validatie
- [x] 04-03-PLAN.md — Weight bracket berekening en selectie in engine

### Phase 5: Engine Optimization
**Goal**: De engine bepaalt de kostenoptimale verpakkingsoplossing door verbeterde ranking met pick/pack kosten en weight brackets, een niet-greedy multi-box solver, en een directe product-verpakking mapping voor single-SKU orders
**Depends on**: Phase 4
**Requirements**: RANK-01, RANK-02, RANK-03, RANK-04, MULTI-01, MULTI-02, SINGLE-01, SINGLE-02, SINGLE-03
**Success Criteria** (what must be TRUE):
  1. De engine rankt verpakkingsopties op total_cost (box_material + pick + pack + transport) met specificiteit/volume als tiebreakers, en sluit dozen uit waarvoor geen preferred route bestaat voor het bestemmingsland
  2. Bij orders die niet in 1 doos passen, evalueert de solver meerdere combinaties op totaalkosten in plaats van greedy volume-first, met 200ms timeout en greedy fallback
  3. Bij single-SKU orders (1 uniek product) gebruikt het systeem de directe product-verpakking mapping, die prioriteit heeft boven compartment rules
  4. De admin kan per product de standaard verpakking vastleggen voor single-SKU matching
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md — Single-SKU data layer: DB migration, admin UI, API endpoint voor default packaging per product
- [x] 05-02-PLAN.md — Ranking verificatie/update + niet-greedy cost-optimal multi-box solver
- [ ] 05-03-PLAN.md — Single-SKU engine integratie in calculateAdvice fast path

### Phase 6: Integration & Display
**Goal**: Medewerkers zien bij het inpakken een volledige kostenbreakdown per doos (materiaal + pick/pack + transport + totaal) met bestemmingsland en carrier, en worden gewaarschuwd wanneer advies op specificiteit is gebaseerd
**Depends on**: Phase 5
**Requirements**: DISPLAY-01, DISPLAY-02, DISPLAY-03, DEGRAD-02
**Success Criteria** (what must be TRUE):
  1. Het advies-panel toont per doos: dooskosten, pick/pack kosten, transportkosten en totaalkosten -- en bij multi-box ook de totaalkosten van de complete oplossing
  2. Het systeem toont bestemmingsland en geselecteerde carrier bij het kostenadvies
  3. Wanneer het advies op specificiteit is gebaseerd (geen kostdata), toont de UI een amber waarschuwing die dit duidelijk aangeeft

**Plans**: 1 plan

Plans:
- [ ] 06-01-PLAN.md — Extend AdviceBox with pick/pack + carrier fields, expanded cost breakdown in VerpakkingsClient

## Phase Ordering Rationale

De drie v2.0 fasen volgen dezelfde dependency chain als v1.0:

1. **Data voor logica (Phase 4)**: De SKU mapping, costProvider rewrite, weight brackets en cache invalidatie moeten bestaan voordat de engine deze data kan gebruiken. Dit is de fundatie waarop alles draait.
2. **Logica voor exposure (Phase 5)**: De ranking, multi-box solver en single-SKU fast path moeten correcte resultaten produceren voordat de UI ze toont. Fout advies repareren nadat medewerkers het vertrouwen is verloren is duur.
3. **Integration als finisher (Phase 6)**: UI display en degradatie-waarschuwingen zijn de dunne laag bovenop correcte engine output.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 --> 2 --> 3 --> 4 --> 5 --> 6

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Cost Data Layer | v1.0 | 2/2 | Complete | 2026-02-24 |
| 2. Cost-Primary Ranking | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. API + UI Integration | v1.0 | 1/1 | Complete | 2026-02-24 |
| 4. Cost Data Layer v2 | v2.0 | 3/3 | Complete | 2026-02-26 |
| 5. Engine Optimization | v2.0 | 2/3 | In progress | - |
| 6. Integration & Display | v2.0 | 0/1 | Not started | - |
