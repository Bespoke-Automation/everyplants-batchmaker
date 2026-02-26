# Requirements: Kostengeoptimaliseerd Verpakkingsadvies

**Defined:** 2026-02-25
**Core Value:** De engine adviseert altijd de verpakkingsoptie met de laagste totaalkosten (doos + pick/pack + transport) per bestemmingsland.

## v2.0 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Cost Data Access

- [x] **COST-01**: costProvider kan kostdata ophalen uit de facturatie `published_box_costs` tabel via cross-database read met `facturatie_box_sku` als join key
- [x] **COST-02**: costProvider cached kostdata in-memory met 15 minuten TTL; tweede call binnen TTL raakt niet de facturatie database
- [x] **COST-03**: Het systeem kan de cost cache invalideren via een inkomende webhook POST van de facturatie-app bij tariefwijziging
- [x] **COST-04**: Het systeem kan per land alle beschikbare doos-kostcombinaties opvragen inclusief box_material_cost, box_pick_cost, box_pack_cost en transport_purchase_cost

### SKU Mapping

- [x] **SKU-01**: Elke batchmaker verpakking heeft een `facturatie_box_sku` kolom die gekoppeld is aan de facturatie box SKU (6 mismatches + 16 correcte mappings als seed data)
- [x] **SKU-02**: De admin kan de facturatie_box_sku mapping beheren voor nieuwe of gewijzigde dozen
- [x] **SKU-03**: Het systeem valideert bij startup dat alle actieve dozen een geldige facturatie_box_sku mapping hebben en logt ontbrekende mappings als warning

### Weight Brackets

- [ ] **WEIGHT-01**: Het systeem berekent het totaalgewicht per gevulde doos op basis van productgewichten uit `product_attributes`
- [ ] **WEIGHT-02**: Het systeem selecteert de juiste weight bracket op basis van totaalgewicht (≤5kg, ≤10kg, ≤20kg, ≤30kg voor PostNL; NULL voor DPD/pallet)
- [ ] **WEIGHT-03**: Bij multi-box orders bepaalt het systeem per doos apart het gewicht en de weight bracket

### Cost-Optimized Ranking

- [ ] **RANK-01**: De engine rankt verpakkingsopties primair op totale kosten (laagste eerst) wanneer kostdata beschikbaar is
- [ ] **RANK-02**: De engine berekent total_cost als som van box_material_cost + box_pick_cost + box_pack_cost + transport_purchase_cost
- [ ] **RANK-03**: Dozen waarvoor geen preferred route bestaat voor het bestemmingsland worden uitgesloten als kandidaat
- [ ] **RANK-04**: Bij gelijke kosten wordt gesorteerd op specificiteit en volume (bestaande tiebreakers)

### Multi-Box Optimization

- [ ] **MULTI-01**: Bij orders die niet in 1 doos passen, evalueert de engine meerdere combinaties op totaalkosten (niet-greedy solver)
- [ ] **MULTI-02**: De multi-box solver heeft een 200ms timeout met fallback naar het bestaande greedy algoritme

### Single-SKU Fast Path

- [ ] **SINGLE-01**: Per product (SKU) kan vastgelegd worden welke standaard verpakking erbij hoort
- [ ] **SINGLE-02**: Bij orders met 1 uniek SKU gebruikt het systeem de directe product → verpakking mapping
- [ ] **SINGLE-03**: De single-SKU mapping heeft prioriteit boven de compartment rules engine

### Graceful Degradation

- [x] **DEGRAD-01**: Bij onbereikbare facturatie database valt de engine terug op specificiteit-ranking zonder te crashen
- [ ] **DEGRAD-02**: De UI toont een amber waarschuwing wanneer advies op specificiteit is gebaseerd i.p.v. kosten
- [x] **DEGRAD-03**: Na herstel van facturatie DB schakelt het systeem automatisch terug naar kosten-ranking (via cache TTL expiry)

### Cost Display

- [ ] **DISPLAY-01**: Het advies-panel toont per doos: dooskosten, pick/pack kosten, transportkosten en totaalkosten
- [ ] **DISPLAY-02**: Bij multi-box advies toont het systeem per-doos kosten en totaalkosten van de complete oplossing
- [ ] **DISPLAY-03**: Het systeem toont bestemmingsland en geselecteerde carrier bij het kostenadvies

## v3.0 Requirements (deferred)

### Future Enhancements

- **FUTURE-01**: Carrier override UI — medewerker kan handmatig carrier kiezen
- **FUTURE-02**: A/B dashboard — vergelijk kosten oud vs nieuw advies over tijd
- **FUTURE-03**: Real-time kostenmonitoring dashboard
- **FUTURE-04**: Predictive cost analytics

## Out of Scope

| Feature | Reason |
|---------|--------|
| Facturatie app aanpassen | Read-only, single source of truth — facturatie bouwt apart |
| Verkooprijs/marge berekening | Facturatie-domein, niet batchmaker |
| Carrier contract onderhandelingen | Business process, niet software |
| Dynamische carrier selectie | Carrier per doos/land staat contractueel vast |
| Shadow mode (cost vs specificiteit) | v1 direct geactiveerd, geen rollback-mechanisme nodig |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| COST-01 | Phase 4 | Complete |
| COST-02 | Phase 4 | Complete |
| COST-03 | Phase 4 | Complete |
| COST-04 | Phase 4 | Complete |
| SKU-01 | Phase 4 | Complete |
| SKU-02 | Phase 4 | Complete |
| SKU-03 | Phase 4 | Complete |
| WEIGHT-01 | Phase 4 | Pending |
| WEIGHT-02 | Phase 4 | Pending |
| WEIGHT-03 | Phase 4 | Pending |
| RANK-01 | Phase 5 | Pending |
| RANK-02 | Phase 5 | Pending |
| RANK-03 | Phase 5 | Pending |
| RANK-04 | Phase 5 | Pending |
| MULTI-01 | Phase 5 | Pending |
| MULTI-02 | Phase 5 | Pending |
| SINGLE-01 | Phase 5 | Pending |
| SINGLE-02 | Phase 5 | Pending |
| SINGLE-03 | Phase 5 | Pending |
| DEGRAD-01 | Phase 4 | Complete |
| DEGRAD-02 | Phase 6 | Pending |
| DEGRAD-03 | Phase 4 | Complete |
| DISPLAY-01 | Phase 6 | Pending |
| DISPLAY-02 | Phase 6 | Pending |
| DISPLAY-03 | Phase 6 | Pending |

**Coverage:**
- v2.0 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after roadmap v2.0 creation*
