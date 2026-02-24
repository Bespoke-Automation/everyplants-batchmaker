# Roadmap: Kostengeoptimaliseerd Verpakkingsadvies

## Overview

Dit project breidt de bestaande packaging advice engine uit zodat deze de goedkoopste verpakkingsoptie adviseert op basis van totale kosten (doos + transport) per bestemmingsland. De roadmap volgt strikte data-dependencies: kostdata moet bestaan voordat ranking kan wijzigen, en ranking moet correct zijn voordat de UI het toont. Drie fasen brengen het project van data-laag via engine-logica naar gebruikersintegratie.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Cost Data Layer** - Kostdata ophalen uit facturatie Supabase, country threading door engine, caching en graceful degradation
- [ ] **Phase 2: Cost-Primary Ranking** - Engine ranking wijzigen naar totale kosten als primaire sortering
- [ ] **Phase 3: API + UI Integration** - Country parameter in API, kostbreakdown tonen in inpakscherm

## Phase Details

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
**Plans**: 2 plans in 2 waves

Plans:
- [x] 01-01-PLAN.md — Build costProvider.ts with cached facturatie data access and CostEntry type
- [ ] 01-02-PLAN.md — Thread countryCode through engine, API route, and VerpakkingsClient + DB migration

### Phase 2: Cost-Primary Ranking
**Goal**: De engine rankt verpakkingsopties primair op totale kosten (laagste eerst), met specificiteit en volume als tiebreakers
**Depends on**: Phase 1
**Requirements**: ENG-01
**Success Criteria** (what must be TRUE):
  1. `rankPackagings()` sorteert primair op `total_cost ASC` (dooskosten + transportkosten); bij gelijke kosten wordt gesorteerd op specificiteit en volume zoals voorheen
  2. Een `enrichWithCosts()` stap verrijkt elke `PackagingMatch` met `box_cost`, `transport_cost` en `total_cost` velden voordat ranking plaatsvindt
  3. Bij multi-box advies (meerdere dozen per order) worden de kosten per doos correct geaggregeerd naar een totaalprijs voor de complete oplossing
  4. Dozen waarvoor geen preferred route bestaat voor het bestemmingsland worden uitgesloten als kandidaat (niet als zero-cost behandeld)
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

### Phase 3: API + UI Integration
**Goal**: Medewerkers zien bij het inpakken per geadviseerde doos de kostenopbouw (doos + transport + totaal) en het bestemmingsland wordt automatisch meegegeven vanuit de order
**Depends on**: Phase 2
**Requirements**: API-01, UI-01
**Success Criteria** (what must be TRUE):
  1. `POST /api/verpakking/engine/calculate` accepteert `countryCode` in de request body en valideert tegen bekende landcodes (NL, BE, DE, FR, AT, LU, SE, IT, ES)
  2. VerpakkingsClient/usePackingSession stuurt automatisch het bestemmingsland van de Picqer order mee bij het berekenen van verpakkingsadvies -- de medewerker hoeft dit niet handmatig in te vullen
  3. Het advies-panel in het inpakscherm toont per voorgestelde doos: dooskosten, transportkosten en totaalkosten
  4. Wanneer kostdata niet beschikbaar was (`cost_data_available: false`), toont de UI een waarschuwing dat het advies op basis van specificiteit is gegeven in plaats van kosten
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

## Phase Ordering Rationale

De drie fasen volgen een strikte dependency chain:

1. **Data voor logica**: Transportkostdata moet bestaan voordat de ranking deze kan gebruiken. Country code moet door de engine heen gethreaded zijn voordat kostdata kan worden opgezocht. Dit is een harde dependency.
2. **Logica voor exposure**: Engine wijzigingen (Phase 2) moeten correct zijn voordat de UI ze toont (Phase 3). API contract changes zijn goedkoop; fout advies repareren nadat medewerkers het vertrouwen is verloren is duur.
3. **Phase 1 is de zwaarste**: De meeste risico's zitten in de data-laag -- country threading, unavailable route handling, graceful degradation. Als dit klopt, zijn Phases 2 en 3 laag risico.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 --> 2 --> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Cost Data Layer | 1/2 | In progress | - |
| 2. Cost-Primary Ranking | 0/1 | Not started | - |
| 3. API + UI Integration | 0/2 | Not started | - |
