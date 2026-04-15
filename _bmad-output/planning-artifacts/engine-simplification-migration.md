# Engine Simplification — Migration Plan & Risico-analyse

> Companion bij `simple-advice-poc.ts`. Beschrijft het schematische verschil tussen de huidige en nieuwe engine, het migratiepad, en de risico's per fase met mitigaties.

---

## 1. Schematisch: huidig vs. nieuw

### Huidige engine (`coreAdvice.ts`, 1.038 regels)

```
                   ┌───────────────────────────────────────┐
   Order/products ─┤  Classify → shipping_units            │
                   └────────────────┬──────────────────────┘
                                    │
                ┌───────────────────┴───────────────────┐
                │ Build 2 fingerprints (productcode +   │
                │ shipping-unit+country)                │
                └───────────────────┬───────────────────┘
                                    │
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ Fetch costs                                          │
   └──────────────────────────────────────────────────────┘
                                    │
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [4]  learned_packing_patterns                        │
   │      status ∈ {learning, active, invalidated}        │ ──► hit?  ──► DONE
   │      1338 rijen, 81 active                           │
   └──────────────────────────────────────────────────────┘
                                    │ miss
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [5]  product_attributes.default_packaging_id         │
   │      85 SKUs, root cause van het bug-ticket          │ ──► hit?  ──► DONE
   └──────────────────────────────────────────────────────┘
                                    │ miss
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [5b] shipping_units.default_packaging_id             │
   │      (alleen als alle units zelfde default delen)    │ ──► hit?  ──► DONE
   └──────────────────────────────────────────────────────┘
                                    │ miss
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [6]  compartment_rules → solveMultiBox               │
   │      0 rijen in productie — altijd miss              │ ──► hit?  ──► DONE
   └──────────────────────────────────────────────────────┘
                                    │ miss
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [7]  boxOptimizer (greedy bin-pack, 437 regels)      │ ──► hit?  ──► DONE
   └──────────────────────────────────────────────────────┘
                                    │ miss
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [8]  default-fallback per shipping unit              │ ──► hit?  ──► DONE
   └──────────────────────────────────────────────────────┘
                                    │
                                    ▼
                     [9] strapped consolidation
                     [10] weight validation
                     [11] alternatives
```

**Eigenschappen:**
- 6 onafhankelijke "bronnen van waarheid" (regels 4, 5, 5b, 6, 7, 8)
- 3 daarvan zijn in de praktijk dood (compartment_rules leeg, optimizer alleen bij partial match, SU-default als productdefault ontbreekt)
- 1 (productdefault) is de root cause van het ticket
- Pattern-status-machine met 3 toestanden (learning/active/invalidated) die zichzelf invalideert bij precies de orders waar zij meeste waarde zou hebben

### Nieuwe engine (POC, ~250 regels)

```
                   ┌───────────────────────────────────────────────────┐
   Order/products ─┤  [0]  Split core / accompanying                   │
                   │       accompanying = flyers, kaartjes, giftcards, │
                   │       inserts, platen/karren. Hergebruikt bestaande│
                   │       criteria uit classifyOrderProducts():       │
                   │         - product_type = 'Accessoire'             │
                   │         - product_type = 'Onbekend' + missing_data│
                   │         - productcode is 1-3 digits numeriek      │
                   │         - hardcoded logistics codes               │
                   │       core → fingerprint. accompanying → output   │
                   │       (worker pakt ze mee, geen invloed op advies)│
                   └────────────────┬──────────────────────────────────┘
                                    │
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [1]  packing_observations   (LAND-ONAFHANKELIJK)     │
   │      Counts per (fingerprint, packaging).            │
   │      Dominant box als ≥ 3 samples én ≥ 50% share.    │ ──► hit?  ──► DONE  (source: observation)
   │      Drempels komen uit bestaande engine_settings    │
   │      (promotion_threshold, invalidation_override_ratio).│
   │      Geen status. Geen invalidation. Alleen counts.  │
   │      Workers pakken overal hetzelfde — 1 land-       │
   │      agnostic telling geeft maximaal signaal.        │
   └──────────────────────────────────────────────────────┘
                                    │ miss (geen / te weinig observations)
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [2]  default_packaging_id op product                 │
   │      Alleen bij single-SKU order. Leest              │ ──► hit?  ──► DONE  (source: default_packaging)
   │      product_attributes.default_packaging_id.        │
   │      Behouden als fallback; ops kan per SKU wijzigen │
   │      zonder code-deploy.                             │
   └──────────────────────────────────────────────────────┘
                                    │ miss
                                    ▼
   ┌──────────────────────────────────────────────────────┐
   │ [3]  no_advice → manual                              │
   │      Geen suggestie. Worker kiest. Keuze landt in    │
   │      packing_observations → self-healing.            │
   │      Na 3× dezelfde doos wint stap 1.                │
   └──────────────────────────────────────────────────────┘
```

**Eigenschappen:**
- 2 bronnen van waarheid: observaties (gedrag) + product-default (handmatige baseline)
- Géén pattern-status: een fingerprint die ooit gezien is blijft meetellen en zwaarder wegen naarmate hij vaker voorkomt
- Géén capaciteit-check, géén cost-optimal algoritme, géén afhankelijkheid van volume-data
- Self-healing: elke worker-keuze verbetert het advies voor de volgende identieke order
- **Fingerprint wint altijd van default**: zodra workers 3× dezelfde andere doos kiezen dan de default, verschuift advies vanzelf
- **Fingerprint land-onafhankelijk** → maximaal signaal per SKU-combinatie (POC-validatie: 13 → 21 samples voor Strelitzia door samenvoegen landen)
- **Flyers/accessoires blijven in de output** (`accompanying_products`) zodat workers ze nog verpakken, maar beïnvloeden fingerprint nooit → orders met/zonder flyer matchen op hetzelfde patroon
- **Cost-display** (voor UI/dashboard) blijft werken via `published_box_costs`, maar speelt geen rol in het advies zelf

### Wat dit doet voor de bug-picklists

| Picklist | Stap 1 (observation) | Stap 2 (default) | Nieuwe advies | Huidig advies | Delta |
|---|---|---|---|---|---|
| 176714126 (Strelitzia) | ✅ Tupe box 100 cm small (14/21 = 67%) | — | **Tupe box 100 cm small** | Fold box 98 | ✅ **bug opgelost** |
| 176635762 (Philodendron) | ❌ 0 observations | Fold box 98 (huidige default) | Fold box 98 | Fold box 98 | = geen regressie, bug blijft tot 3× andere doos → dan self-healing |

### Accompanying-criteria (exact overgenomen uit bestaande engine)

Uit `packagingEngine.ts:231-262` — géén nieuwe classificatie-logica nodig:

```ts
function isAccompanying(productcode: string, attr: ProductAttribute | undefined): boolean {
  const type = attr?.product_type?.toLowerCase()
  if (type === 'accessoire') return true
  if (type === 'onbekend' && attr?.classification_status === 'missing_data') return true
  if (/^[0-9]{1,3}$/.test(productcode)) return true                // korte numerieke codes (Flyer "1")
  if (['100000011','100000012','100000013'].includes(productcode)) return true  // Platen, Deense/Veiling kar
  return false
}
```

Belangrijk: **`product_type='Plant' + classification_status='missing_data'` is géén accompanying** — dat zijn ongeclassificeerde echte planten (~60 rijen) die een aparte data-fix nodig hebben. Die blijven core-producten en produceren `no_advice` totdat ze geclassificeerd zijn of totdat er observations voor ze zijn.

### Datamodel-delta

| Object | Huidig | Nieuw | Actie |
|---|---|---|---|
| `learned_packing_patterns` | 14 kolommen, status-machine, hash-vergelijking | weg | Vervangen door `packing_observations` |
| `compartment_rules` | tabel + UI + matcher | weg | Géén rol meer; keuze komt uit observation of product-default |
| `product_attributes.default_packaging_id` | nullable kolom, 85 ingevuld | **behouden** | Fallback bij cold-start. Ops kan per SKU wijzigen. Quick-win: lijst SKUs met >50% override-rate opruimen |
| `shipping_units.default_packaging_id` | nullable kolom | weg | Redundant; product-default is specifieker |
| `packing_observations` | – | nieuw | `(fingerprint, packaging) → count`. Land-onafhankelijk (zie rationale in diagram) |
| `packagings.volume`, `max_weight` | aanwezig | niet meer gebruikt in engine | Kan blijven staan voor toekomstig gebruik/display, geen blocker meer |
| `published_box_costs` | aanwezig | niet meer gebruikt in engine | Blijft voor kostendisplay/rapportage, geen rol in advies |

---

## 2. Migratiepad in 4 fases

### Fase 1 — Observaties verzamelen (1 week, productie ongewijzigd)

**Wat:**
- Migration: `batchmaker.packing_observations` aanmaken — **PK (fingerprint, packaging_id)**, kolommen `count int default 1`, `last_seen_at timestamptz`
- `ON CONFLICT (fingerprint, packaging_id) DO UPDATE SET count = packing_observations.count + 1, last_seen_at = excluded.last_seen_at`
- Hook toevoegen in `tryCompleteSession.ts` die voor elke voltooide doos een observation upsert doet — nadat de core-set via `isAccompanying()` is gefilterd
- Backfill-script: lees `packing_session_boxes` + `packing_session_products` van laatste 90 dagen, filter accompanying weg, groepeer per (fingerprint, packaging), doe één bulk-insert

**Niet wijzigen:** `coreAdvice.ts`, geen UI, geen flags

### Fase 2 — Parallel-adviseren & meten (2 weken)

**Wat:**
- POC `simpleAdvice()` in `src/lib/engine/simpleAdvice.ts` plaatsen
- In de bestaande advice-flow: na elke `coreAdvice()`-call ook `simpleAdvice()` aanroepen en het resultaat loggen in nieuwe tabel `engine_advice_comparisons`
- Dashboard-pagina (`/verpakkingsmodule/engine-comparison`) die laat zien:
  - Hoe vaak de twee engines hetzelfde adviseerden
  - Wanneer ze verschillen: wat koos de worker?
- Geen UI-effect voor workers

**Doel:** kwantitatief bewijs dat `simpleAdvice` ≥ `coreAdvice` qua follow-rate

### Fase 3 — Switch (1 dag)

**Wat:**
- Feature-flag `USE_SIMPLE_ENGINE` (env var, default false)
- `packagingEngine.calculateAdvice()` checkt de flag en delegeert
- Stapsgewijs uitrollen:
  1. Eerst alleen DE-orders (grootste volume, beste statistische signaal)
  2. Dan NL, BE, FR
  3. Dan rest
- Oude engine blijft beschikbaar voor instant rollback

### Fase 4 — Opruimen (1 week)

**Wat:**
- Verwijder `learned_packing_patterns`, `compartment_rules` tabellen (na backup)
- Drop kolom `shipping_units.default_packaging_id` (redundant)
- **Behoud** `product_attributes.default_packaging_id` (blijft stap 2 fallback)
- Verwijder `coreAdvice.ts`, `boxOptimizer.ts`, `patternLearner.ts`, `insightsDetector.ts` (deel ervan)
- Schatting: ~4.000 regels weg

---

## 3. Risico-analyse

Risico-categorieën: **D** = data, **C** = correctness, **O** = operational, **R** = rollback

| # | Fase | Risico | Cat | Kans | Impact | Mitigatie |
|---|---|---|---|---|---|---|
| R1 | 1 | Backfill bevat ruis (gebroken sessies, test-data, cancellations) | D | hoog | mid | Filter op `status = 'completed'`, sluit sessies uit met `was_override IS NULL` (oude data zonder advice-link), exclude testaccounts |
| R2 | 1 | `(fingerprint, packaging)` cardinaliteit groter dan verwacht → tabel groeit hard | D | laag | laag | Land-weglaten halveert cardinaliteit al ~5×. Index aanmaken vooraf; bij > 1M rijen monthly-aggregate of TTL op `last_seen_at < 180 days` |
| R3 | 1 | Trigger-races bij gelijktijdige sessie-completion (zelfde fingerprint) | D | laag | laag | `ON CONFLICT DO UPDATE` is atomair in Postgres; geen lock nodig |
| R4 | 1 | Dubbele observations bij retry van Inngest event | D | mid | laag | Idempotency-key (session_id+box_index) in apart unique-table; observation alleen inserten als (session, box) nog niet eerder verwerkt |
| R5 | 2 | `simpleAdvice` adviseert vaker `no_advice` voor zeldzame fingerprints → workers verliezen advies | C | laag | mid | Stap 2 (default_packaging_id) vangt single-SKU gevallen op. Alleen multi-SKU zonder observation → no_advice. In fase 2 volume daarvan meten |
| R6 | 2 | Observation-engine bevooroordeeld door bestaande worker-overrides die zelf fout zijn | C | mid | mid | Dashboard toont per fingerprint: dominant gepakt vs. default. Ops kan dominante doos overrulen via `DELETE FROM packing_observations WHERE fingerprint = ...` |
| R7 | alle | Fingerprint cold-start: bug-SKUs waar de default_packaging fout is blijven fout totdat 3 workers dezelfde andere doos kiezen | C | hoog | mid | Quick-win vóór fase 2: lijst de ~85 SKUs met `default_packaging_id` + >50% historische override-rate, corrigeer handmatig naar de dominante actuele doos. Daarna wint stap 1 op dag 1 |
| R8 | 3 | Eerste switch leidt tot golf van workers die advies negeren → throughput daalt | O | mid | hoog | Soft-launch in dal-uren, dashboard live met follow-rate per uur, hard rollback ≤ 5 min via env-var |
| R9 | 3 | `no_advice` voor multi-SKU zonder observation-hit overweldigt UI | O | laag | mid | Baseline meten in fase 2. Als > 5% van orders `no_advice` krijgt, overweeg stap 2 te uitbreiden naar "alle producten delen zelfde default" (zoals huidige 5b). Anders accepteren als self-healing input |
| R10 | 3 | Insights-pagina's (1.446 regels in `insights.ts`) breken doordat ze leunen op learned_pattern_id | C | hoog | mid | In fase 2 ook `engine_advice_comparisons` laten meeschrijven naar packaging_advice met source='observation'; insights-pagina pas in fase 4 herschrijven |
| R11 | 4 | Drop kolom `default_packaging_id` faalt doordat ergens nog code joined (sync, admin tool) | C | mid | mid | Eerst grep over hele repo, dan kolom op DEPRECATED zetten (rename + maandlang draaien) vóór drop |
| R12 | 4 | Verlies van historische learned_patterns context bij audit/debug | D | laag | laag | Dump tabel als CSV naar S3/Supabase Storage vóór drop, bewaren 1 jaar |
| R13 | alle | Worker UI-flow (`VerpakkingsClient.tsx`) rekent op `advice_source` enum | C | mid | mid | Nieuwe enum-waarden (`'observation'`, `'cost_optimal'`, `'no_advice'`) toevoegen voor i18n + iconografie vóór fase 3 |
| R14 | alle | Engine_advice_comparisons tabel groeit ongebreideld | D | mid | laag | TTL: rows > 30 dagen wegrollen door cron-job; aggregate-tabel met dagelijkse stats bewaren |
| R15 | – | "Niemand snapt het meer" bij review/audit | O | hoog (huidig) → laag (na) | hoog | Doc deze in repo; bewaar als ADR |
| R16 | alle | Nieuw product is nog niet geclassificeerd (`product_type='Onbekend'` maar classification_status ≠ `missing_data`, of een korte code > 3 digits) → komt in fingerprint en fragmenteert patronen | D | mid | mid | Dagelijkse monitoring-query die nieuwe productcodes zonder classificatie vlagt; ops-taak om binnen 24u te classificeren. Fallback: bij `product_type IS NULL` zelfde behandeling als 'Onbekend' geven |
| R17 | 3 | Land-onafhankelijk advies maskeert land-specifiek gedrag (bv. DE workers gebruiken strapping, NL niet) | C | laag | mid | POC-dashboard toont per fingerprint ook een country-uitsplitsing. Als in 1 land >30% een andere dominante doos heeft dan cross-country, flaggen voor review. Simpelste mitigatie bij regressie: keer terug naar `(fingerprint, country, packaging)` PK — geen logica-verandering nodig, alleen schema |

### Showstoppers (afstemmen vóór start)

1. **R7**: Quick-win `default_packaging_id` opruimen vóór fase 3. Zonder deze stap blijven fout-default-SKUs het foute advies geven tot observation opgroeit. Eenvoudige SQL (zie §5) — kan los van rest.
2. **R10**: Insights/dashboard. Als business hier dagelijks naar kijkt (en niet alleen incidenteel), eerst alternatief in fase 2 leveren.
3. **R8**: Throughput-impact. Vereist dat worker-UI **hetzelfde** werkt bij fout advies (worker kan gewoon overschrijven), dus geen hard-block bij `no_advice`.

### Rollback-strategie

- Fase 1: drop tabel, rollback migratie. Trigger weg. Geen impact op huidige flow.
- Fase 2: vlag uitzetten of comparison-call try/catchen. Géén effect op productie-advies want is alleen log-laag.
- Fase 3: env-var `USE_SIMPLE_ENGINE=false` → terug naar `coreAdvice`. <1 min via Vercel.
- Fase 4: backup beschikbaar. Restore uit dump als nodig (zeer onwaarschijnlijk na 2 weken stabiel draaien).

---

## 4. Definition of Done per fase

| Fase | Done = |
|---|---|
| 1 | `packing_observations` heeft ≥ 30 dagen aan backfill + alle nieuwe sessies schrijven correct. |
| 2 | Comparison-dashboard draait 2 weken zonder fouten; rapport beschikbaar met follow-rate per engine per land per dag. **Insights library heeft `?model=observation` toggle die leest uit `packing_observations`.** |
| 3 | `simpleAdvice` actief op alle landen; follow-rate ≥ baseline van `coreAdvice`; geen handmatige escalaties. **Insights library default staat op nieuw model.** |
| 4 | Oude code/tabellen weg; CI groen; documentatie bijgewerkt; ADR toegevoegd. **`LearnedPatternDetail.tsx` verwijderd, `InsightsOverview` vereenvoudigd.** |

---

## 5. Insights library (`/verpakkingsmodule/insights/library`) — migratie

> Deze pagina toont nu nog het oude model (shipping-unit fingerprint + country). Niet meeveranderen is risico **R10** uit de tabel hierboven. Dit is het uitgewerkte plan.

### Wat er nu staat

**Data-source**: `batchmaker.packaging_advice` — kolommen `shipping_unit_fingerprint`, `country_code`, `outcome`, `advice_boxes`, `actual_boxes`.

**Aggregatie** (in `src/lib/engine/insights.ts:396-526`, `getFingerprintStats()`):
- Groepeer per `(shipping_unit_fingerprint, country)`
- Tel totaal, resolved, followed, modified, ignored
- Dominante doos-combo komt uit `actual_boxes` met fallback naar `advice_boxes`
- `followRate` = followed / resolved
- `suggestedAction` afgeleid uit total + followRate + distinctBoxCombos

**UI** (`FingerprintLibrary.tsx`): tabel met kolom "Fingerprint" (format: `country|shipping_unit:qty|...`), sort op volume/volgrate/kosten, filter op status-enum.

**URL-contract**: `/library/[fingerprint]?country=DE` — country is querystring.

### Wat niet meer klopt in het nieuwe model

| Aspect | Oud | Nieuw |
|---|---|---|
| Fingerprint-inhoud | `country\|shipping_unit:qty\|...` | `productcode:qty\|...` (geen country, geen shipping-unit-labels) |
| Cardinaliteit | ~hoog (land × shipping-unit combos) | lager (geen land-fragmentatie) |
| Dominante doos | afgeleid uit `actual_boxes` per rij | directe telling in `packing_observations` |
| Volgrate | `followed / resolved` (advice vs actual outcome) | `share van dominante observation` (count max / count total) |
| Country-kolom | primaire filter-as | niet meer zichtbaar in lib; valt nog wel op te halen voor drill-down via `packing_sessions.order_id → packaging_advice.country_code` |
| Status "drifting" | vereist time-series | kan nog steeds — afleidbaar uit `last_seen_at` shift per fingerprint (tellen recente vs. oude observations) |
| Accompanying-info | ontbreekt | nieuwe kolom/sectie: "flyers in dit patroon" (optioneel, komt uit session-detail) |

### Nieuw datamodel voor insights (géén nieuwe tabellen)

| Vraag | Query-bron |
|---|---|
| Totaal samples + dominante doos per fingerprint | `packing_observations` (1 query, GROUP BY fingerprint) |
| Trend (drifting/rising) | `packing_observations.last_seen_at` + optional 2e count-kolom voor 30d-window (nice-to-have, later) |
| Recent activity (drill-down) | `packing_sessions` JOIN `packing_session_boxes` JOIN `packing_session_products` — live aggregeren, géén cache nodig (volumes zijn laag) |
| Country uitsplitsing (voor drill-down R17 check) | zelfde live query, JOIN met `packaging_advice.country_code` via `order_id` |
| Advice-vs-actual follow-rate (optioneel, voor comparison) | blijft `packaging_advice.outcome` — zolang oude engine nog draait |

**Conclusie**: geen nieuwe tabellen nodig. `packing_observations` + bestaande session-tabellen bieden alles. Country alleen in drill-down, niet in lib-overzicht.

### Code-wijzigingen per bestand

| Bestand | Wijziging |
|---|---|
| `src/lib/engine/insights.ts` | `getFingerprintStats()` en `getFingerprintDetail()` herschrijven: queryen `packing_observations` i.p.v. `packaging_advice.shipping_unit_fingerprint`. Behoud de `FingerprintStatsRow`-shape zo veel mogelijk — alleen `country` weg, `fingerprint`-semantiek verandert |
| `src/app/api/verpakking/insights/fingerprints/route.ts` | Blijft — roept dezelfde functie aan |
| `src/app/api/verpakking/insights/fingerprints/[fingerprint]/route.ts` | Country-param negeren (blijft backward compatible) |
| `src/components/verpakking/insights/FingerprintLibrary.tsx` | Country-chip verwijderen (regel 253-257); header-text "shipping-unit patronen" → "product-combinaties"; fingerprint-parser om productcodes leesbaar te maken (bv. productnaam ernaast via een resolver) |
| `src/components/verpakking/insights/FingerprintDetail.tsx` | Sectie "Accompanying producten" toevoegen; dozen-distributie uit `packing_observations` i.p.v. `actual_boxes`; recent-activity tabel blijft werken want leest live uit sessions |
| `src/lib/engine/insightsActions.ts` | Check of acties (bv. "invalidate pattern") nog nuttig zijn — oude patterns-tabel gaat weg, dus waarschijnlijk DELETE FROM observations als ops-actie |
| `src/components/verpakking/insights/InsightsOverview.tsx` + `ActionQueue.tsx` | KPI-bronnen herzien (compliance-pct, learning-funnel) — veel is learned-pattern-afhankelijk. Simplificatie: één KPI "% fingerprints met dominante doos ≥ 70%" + "cold-starts deze week" |
| `src/components/verpakking/insights/LearnedPatternDetail.tsx` | Weg in fase 4 (pattern-concept vervalt) |

### Uitrol-koppeling met engine-fases

| Fase | Insights library stand |
|---|---|
| 1 (observaties verzamelen) | Niets veranderen. `packing_observations` wordt gevuld, maar UI leest nog oude bron |
| 2 (parallel adviseren) | **Dual view**: library krijgt een togglet "Oud model / Nieuw model". Ops kan vergelijken. Backend: twee endpoints of één endpoint met `?model=observation` param |
| 3 (switch) | Default naar nieuw model. Oude toggle blijft een week als safety net |
| 4 (opruim) | Oude model-code + `learned_packing_patterns`-afhankelijkheden weg. `InsightsOverview` vereenvoudigen |

### Risico-update

| # | Risico | Status |
|---|---|---|
| R10 | Insights breekt door refactor | Nu concreet: 6 bestanden aanraken, backward-compatible via `?model=` toggle in fase 2 |
| R18 *nieuw* | Fingerprint-display is onleesbaar (alleen productcodes, geen namen) | Resolver toevoegen: fingerprint-string → "1× Strelitzia Nicolai Ø17 + 1× flyer" via join met `product_attributes.product_name` |
| R19 *nieuw* | Bestaande bookmarks/URLs met `?country=DE` breken | Country-param stil negeren, geen redirect nodig; diepe links blijven werken |

---

## 6. Wat we NU al kunnen doen (zonder migratie)

**Quick-win**: identificeer de 85 SKUs met `default_packaging_id` waar de override-rate > 50% is, en verwijder die defaults handmatig. Dat lost het bug-ticket op (de 55 open picklists krijgen direct ander advies via fallback) zonder code-wijziging. De clean engine kan daarna in alle rust gebouwd worden.

Concreet:
```sql
-- Audit: welke SKUs hebben default_packaging_id én > 50% override?
WITH pa AS (
  SELECT pa.id as packaging_advice_id,
         pa.advice_boxes->0->>'packaging_id' as advised_pkg
  FROM batchmaker.packaging_advice pa
  WHERE pa.advice_source = 'single_sku_default'
    AND pa.calculated_at > NOW() - INTERVAL '90 days'
),
overrides AS (
  SELECT psb.packaging_advice_id,
         COUNT(*) FILTER (WHERE psb.was_override) as overrides,
         COUNT(*) as total
  FROM batchmaker.packing_session_boxes psb
  JOIN batchmaker.packing_sessions ps ON ps.id = psb.session_id
  WHERE ps.status = 'completed'
  GROUP BY psb.packaging_advice_id
)
SELECT pa.advised_pkg, SUM(o.total) as samples,
       SUM(o.overrides)::float / SUM(o.total) as override_rate
FROM pa
JOIN overrides o USING (packaging_advice_id)
GROUP BY pa.advised_pkg
HAVING SUM(o.total) >= 5 AND SUM(o.overrides)::float / SUM(o.total) > 0.5
ORDER BY override_rate DESC;
```

Resultaat = lijst SKUs waar workers consequent afwijken. Voor die SKUs: `UPDATE batchmaker.product_attributes SET default_packaging_id = NULL WHERE picqer_product_id IN (...)`.
