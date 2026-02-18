# Verpakkingsadvies-systeem — Technisch Ontwerp

> **Status:** Definitief ontwerp — klaar voor implementatie
> **Datum:** 2026-02-13
> **Deadline:** 2026-02-27 (2 weken)
> **Auteur:** Mary (Business Analyst) + Kenny
> **Vervangt:** Everspring verpakkingslogica
> **Volume:** ~500 orders/dag, ~3.000 actieve producten

---

## 1. Executive Summary

EveryPlants vervangt Everspring als logistiek systeem. Everspring bepaalt momenteel welke verzenddoos bij een order hoort en schiet die als product in de Picqer-order. Dit systeem wordt vervangen door een **eigen verpakkingsadvies-engine** die:

1. Producten automatisch classificeert naar verzendeenheden (op basis van type, potmaat, hoogte)
2. Per order de beste doos(combinatie) berekent via compartimenten-regels
3. Het advies als tag op de Picqer-order schrijft
4. Het advies toont in de verpakkingsmodule bij het inpakken
5. Bij het sluiten van een picklijst opslaat wat er daadwerkelijk is ingepakt
6. Over tijd leert van afwijkingen en regels verbetert

**Picqer is de single source of truth** voor productdata. Supabase is de spiegel (cache) en bevat de logica (regels, advieshistorie).

---

## 2. Context & Probleemstelling

### Huidige situatie (Everspring)

- Everspring kent per product de potmaat, hoogte en type
- Everspring berekent de juiste doos en schiet die als product in de Picqer-order
- De verpakkingsmodule leest order-tags voor doos-suggesties (beperkt, 3 regels)
- Medewerkers kiezen vaak een andere doos dan gesuggereerd — dat wordt niet bijgehouden

### Gewenste situatie (eigen systeem)

- Productdata (potmaat, hoogte, type) leeft in Picqer als custom fields
- Onze engine classificeert producten en berekent dozen automatisch
- Advies wordt als tag op de order geschreven in Picqer
- De verpakkingsmodule toont het advies en laat overrulen toe
- Bij afsluiting wordt de werkelijke keuze opgeslagen voor analyse
- Het systeem wordt slimmer over tijd

### Waarom slimmer dan Everspring?

1. **Automatische classificatie** i.p.v. handmatig per product-template
2. **Feedback loop** — Everspring weet niet of medewerkers afwijken
3. **Centraal beheer** — regels aanpasbaar via admin-pagina
4. **Transparant** — je kunt zien waarom een doos is geadviseerd

---

## 3. Systeemarchitectuur

### Dataflow overzicht

```
BRONNEN
  │
  ├── Everspring Export (.xlsx) ──→ [Eenmalig import script]
  │                                        │
  │                                        ▼
  ├── Picqer Admin UI ──→ Product custom fields wijzigen
  │                              │
  │                              ▼
  │                       ┌──────────────┐
  │                       │    PICQER     │
  │                       │   (master)    │
  │                       │              │
  │                       │  Products:   │
  │                       │  • potmaat   │ ← custom field
  │                       │  • hoogte    │ ← custom field
  │                       │  • type      │ ← custom field
  │                       │  • breekbaar │ ← custom field
  │                       │  • mixable   │ ← custom field
  │                       │  • weight    │ ← native field
  │                       │              │
  │                       │  Orders:     │
  │                       │  • tags  ←───┼──── Engine schrijft doos-tag(s)
  │                       └──────┬───────┘
  │                              │
  │                     sync (polling/webhook)
  │                              │
  │                              ▼
  │  ┌───────────────────────────────────────────────────────────┐
  │  │              SUPABASE (cache + logica)                    │
  │  │                                                           │
  │  │  product_attributes ←── sync van Picqer products          │
  │  │  product_composition_parts ←── sync van Picqer parts      │
  │  │       │                                                   │
  │  │       ▼ auto-classificatie                                │
  │  │  shipping_units (verzendeenheid-definities + ranges)      │
  │  │       │                                                   │
  │  │       ▼ matching                                          │
  │  │  compartment_rules ──→ packagings (dozen + Picqer IDs)    │
  │  │       │                                                   │
  │  │       ▼ resultaat                                         │
  │  │  packaging_advice (berekend advies per order)              │
  │  │       │                                                   │
  │  │       ├──→ Schrijf tag(s) naar Picqer order               │
  │  │       └──→ Toon in verpakkingsmodule                      │
  │  │                                                           │
  │  │  packing_history ←── bij sluiten picklijst                │
  │  │  (advies vs werkelijkheid, feedback loop)                 │
  │  └───────────────────────────────────────────────────────────┘
  │
  └── Verpakkingsmodule (bestaand)
        ├── Leest doos-tags → voorgeselecteerde dozen
        ├── Medewerker pakt in (bestaande flow)
        ├── Kan overrulen indien nodig
        └── Bij sluiten: opslaan werkelijke keuze
```

### Principes

1. **Picqer = source of truth** voor productdata
2. **Supabase = spiegel + logica** (cache, regels, advieshistorie)
3. **Tags = communicatiemiddel** tussen engine en verpakkingsmodule
4. **Feedback > regels** — het systeem leert van de praktijk

---

## 4. Database Schema

### 4.1 Nieuwe tabellen

#### `product_attributes` — Productcache met classificatie

```sql
CREATE TABLE batchmaker.product_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picqer_product_id INTEGER NOT NULL UNIQUE,
  productcode TEXT NOT NULL,
  product_name TEXT NOT NULL,

  -- Classificatie
  product_type TEXT NOT NULL DEFAULT 'unknown',
    -- CONSTRAINT: Plant, Pot, Pot+Plant, Kunstplant, Oppotten, Bundel, Accessoire, Onbekend
  picqer_product_type TEXT,
    -- Picqer's eigen type: normal, virtual_composition, composition_with_stock, unlimited_stock
  is_composition BOOLEAN NOT NULL DEFAULT FALSE,

  -- Dimensies (uit Picqer custom fields)
  pot_size DECIMAL(5,1),       -- potmaat in cm (bijv. 17.0)
  height DECIMAL(5,1),         -- planthoogte in cm (bijv. 85.0)
  weight INTEGER,              -- gewicht in gram (native Picqer veld)

  -- Eigenschappen
  is_fragile BOOLEAN NOT NULL DEFAULT FALSE,
  is_mixable BOOLEAN NOT NULL DEFAULT TRUE,

  -- Automatische classificatie
  shipping_unit_id UUID REFERENCES batchmaker.shipping_units(id),
  classification_status TEXT NOT NULL DEFAULT 'unclassified',
    -- CONSTRAINT: classified, unclassified, manual_override, no_data

  -- Sync metadata
  source TEXT NOT NULL DEFAULT 'picqer_sync',
    -- CONSTRAINT: everspring_import, picqer_sync, manual
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  picqer_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_product_attributes_productcode ON batchmaker.product_attributes(productcode);
CREATE INDEX idx_product_attributes_type ON batchmaker.product_attributes(product_type);
CREATE INDEX idx_product_attributes_classification ON batchmaker.product_attributes(classification_status);
CREATE INDEX idx_product_attributes_shipping_unit ON batchmaker.product_attributes(shipping_unit_id);
```

#### `product_composition_parts` — Compositie-onderdelen

```sql
CREATE TABLE batchmaker.product_composition_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id INTEGER NOT NULL,  -- de compositie (idproduct)
  part_product_id INTEGER NOT NULL,    -- het onderdeel (idproduct)
  amount INTEGER NOT NULL DEFAULT 1,
  part_shipping_unit_id UUID REFERENCES batchmaker.shipping_units(id),
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(parent_product_id, part_product_id)
);

CREATE INDEX idx_composition_parts_parent ON batchmaker.product_composition_parts(parent_product_id);
```

#### `shipping_units` — Verzendeenheden (classificatie-ranges)

```sql
CREATE TABLE batchmaker.shipping_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
    -- bijv. "PLANT | P17-P21 | H0-H100"
  product_type TEXT NOT NULL,
    -- CONSTRAINT: Plant, Pot, Pot+Plant, Kunstplant, Oppotten, Bundel

  -- Classificatie-ranges (inclusief aan beide kanten)
  pot_size_min DECIMAL(5,1),   -- NULL voor kunstplanten (alleen hoogte)
  pot_size_max DECIMAL(5,1),
  height_min DECIMAL(5,1),     -- NULL voor potten (alleen potmaat)
  height_max DECIMAL(5,1),
  is_fragile_filter BOOLEAN,   -- NULL = niet relevant, TRUE/FALSE = filter

  -- Fysieke afmetingen van de verzendeenheid
  dimensions_l INTEGER,        -- cm
  dimensions_w INTEGER,        -- cm
  dimensions_h INTEGER,        -- cm
  volume DECIMAL(8,2),         -- liter

  -- Beheer
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### `compartment_rules` — Doosregels (EN/OF/ALTERNATIEF)

```sql
CREATE TABLE batchmaker.compartment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packaging_id UUID NOT NULL REFERENCES batchmaker.packagings(id),
    -- welke doos deze regel definieert
  rule_group INTEGER NOT NULL,
    -- elke OF-branch heeft een uniek nummer binnen de doos
    -- regel_groep 1, 2, 3... = alternatieve configuraties (OF)
  shipping_unit_id UUID NOT NULL REFERENCES batchmaker.shipping_units(id),
    -- welke verzendeenheid
  quantity INTEGER NOT NULL DEFAULT 1,
    -- hoeveel stuks van deze verzendeenheid

  operator TEXT NOT NULL DEFAULT 'EN',
    -- CONSTRAINT: EN, OF, ALTERNATIEF
    -- EN = deze eenheid moet er ook bij (in dezelfde rule_group)
    -- OF = start nieuwe rule_group (impliciet, via rule_group nummer)
    -- ALTERNATIEF = uitwisselbaar met een andere eenheid in dezelfde positie

  alternative_for_id UUID REFERENCES batchmaker.compartment_rules(id),
    -- als operator = ALTERNATIEF: verwijst naar de regel die dit vervangt

  -- Beheer
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_compartment_rules_packaging ON batchmaker.compartment_rules(packaging_id);
CREATE INDEX idx_compartment_rules_group ON batchmaker.compartment_rules(packaging_id, rule_group);
```

#### `packaging_advice` — Engine resultaten per order

```sql
CREATE TABLE batchmaker.packaging_advice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id INTEGER NOT NULL,
  picklist_id INTEGER,         -- nullable, want advies is op order-niveau

  -- Resultaat
  status TEXT NOT NULL DEFAULT 'calculated',
    -- CONSTRAINT: calculated, applied (tags geschreven), stale (order gewijzigd),
    --            overridden (medewerker week af), expired
  confidence TEXT NOT NULL DEFAULT 'full_match',
    -- CONSTRAINT: full_match, partial_match, fallback, no_match

  -- Gedetailleerd advies (JSON)
  advice_boxes JSONB NOT NULL DEFAULT '[]',
    -- [{
    --   "packaging_id": "uuid",
    --   "picqer_packaging_id": 123,
    --   "packaging_name": "Vouwdoos 100cm",
    --   "rule_group_matched": 3,
    --   "products": [
    --     {"product_id": 456, "productcode": "MON-P17", "amount": 1,
    --      "shipping_unit_id": "uuid", "shipping_unit_name": "PLANT | P17-P21 | H0-H100"}
    --   ]
    -- }]

  shipping_units_detected JSONB NOT NULL DEFAULT '[]',
    -- [{"product_id": 456, "shipping_unit_id": "uuid",
    --   "shipping_unit_name": "...", "quantity": 2}]

  unclassified_products JSONB DEFAULT '[]',
    -- producten die niet geclassificeerd konden worden

  tags_written JSONB DEFAULT '[]',
    -- [{"idtag": 123, "title": "C - Vouwdoos 100cm"}]

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,      -- wanneer tags geschreven
  invalidated_at TIMESTAMPTZ,  -- wanneer order gewijzigd (stale)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_packaging_advice_order ON batchmaker.packaging_advice(order_id);
CREATE INDEX idx_packaging_advice_status ON batchmaker.packaging_advice(status);
```

### 4.2 Uitbreidingen bestaande tabellen

#### `packagings` — uitbreiden met kosten en limieten

```sql
ALTER TABLE batchmaker.packagings ADD COLUMN IF NOT EXISTS
  handling_cost DECIMAL(8,2) DEFAULT 0,
  material_cost DECIMAL(8,2) DEFAULT 0,
  max_weight INTEGER,              -- gram, NULL = geen limiet
  max_volume DECIMAL(8,2),         -- liter, NULL = geen limiet
  num_shipping_labels INTEGER DEFAULT 1,
  box_category TEXT,
    -- vouwdoos, kokerdoos, eurodoos, open_doos, speciaal, oppotten, pallet
  specificity_score INTEGER DEFAULT 50,
    -- hoe specifiek deze doos is (hoger = specifieker, voor ranking)
  volume DECIMAL(8,2);             -- inhoud in liter (voor ranking "kleinste")
```

#### `packing_session_products` — uitbreiden met verzendeenheid

```sql
ALTER TABLE batchmaker.packing_session_products ADD COLUMN IF NOT EXISTS
  shipping_unit_id UUID REFERENCES batchmaker.shipping_units(id),
  shipping_unit_name TEXT;
```

#### `packing_session_boxes` — uitbreiden met advies-tracking

```sql
ALTER TABLE batchmaker.packing_session_boxes ADD COLUMN IF NOT EXISTS
  suggested_packaging_id INTEGER,     -- Picqer packaging ID dat geadviseerd was
  suggested_packaging_name TEXT,
  was_override BOOLEAN DEFAULT FALSE, -- week medewerker af van advies?
  packaging_advice_id UUID REFERENCES batchmaker.packaging_advice(id);
```

---

## 5. Verzendeenheid-classificatie

### 5.1 Classificatie-algoritme

```
Input: product met pot_size, height, product_type, is_fragile
Output: shipping_unit_id

Stappen:
1. Filter shipping_units op product_type
2. Filter op pot_size_min <= pot_size <= pot_size_max
   (als pot_size_min/max NULL → skip deze filter, bijv. kunstplanten)
3. Filter op height_min <= height <= height_max
   (als height_min/max NULL → skip deze filter, bijv. potten)
4. Filter op is_fragile_filter
   (als NULL → geen filter; anders moet matchen)
5. Resultaat: 0 of 1 match
   → 0 matches: classification_status = 'unclassified'
   → 1 match: classification_status = 'classified'
   → 2+ matches: FOUT — ranges overlappen, admin moet fixen
```

### 5.2 Composition-classificatie

```
Input: composition product (is_composition = true)
Output: lijst van shipping_units (van de parts)

Stappen:
1. Check: heeft het product ZELF een shipping_unit_id?
   → JA (bijv. BUNDEL type): gebruik die. Klaar.
   → NEE: ga naar stap 2

2. Haal parts op uit product_composition_parts
3. Per part:
   a. Zoek part in product_attributes
   b. Classificeer part (zie 5.1)
   c. Vermenigvuldig met part.amount
4. Resultaat: lijst van (shipping_unit_id, quantity) per part
```

### 5.3 Volledige product-classificatie voor een order

```
Input: lijst van order producten [{product_id, amount}]
Output: lijst van shipping_units [{shipping_unit_id, quantity}]

Per product:
  1. Zoek in product_attributes
  2. Als is_composition EN geen eigen shipping_unit:
     → Decomponeer (zie 5.2)
     → Vermenigvuldig part quantities met order amount
  3. Als NIET composition:
     → Gebruik shipping_unit_id
     → quantity = order amount
  4. Als classification_status = 'unclassified':
     → Toevoegen aan unclassified_products lijst
     → NIET meenemen in doos-berekening

Aggregeer: groepeer op shipping_unit_id, sommeer quantities
Resultaat: [{shipping_unit_id, total_quantity}]
```

---

## 6. Doos-advies Engine

### 6.1 Compartiment-matching

```
Input: [(shipping_unit_id, quantity)] — de verzendeenheden van de order
Output: packaging_id of NULL (geen match)

Per doos (packaging):
  Per rule_group binnen die doos:
    1. Verzamel alle regels in deze rule_group (operator = EN)
    2. Voor elke regel:
       a. Check: zit shipping_unit_id in de order-set?
       b. Of: als er ALTERNATIEVEn zijn, check die ook
       c. Check: is quantity >= regel.quantity?
    3. Als ALLE regels in de group matchen → deze doos past
    4. Als NIET → probeer volgende rule_group (OF-branch)

  Als minstens 1 rule_group matcht → doos is kandidaat
```

### 6.2 Ranking (specifiekst → kleinst → goedkoopst)

```
Input: lijst van kandidaat-dozen
Output: gesorteerde lijst (beste eerst)

Score berekening per doos:
  specificiteit = packagings.specificity_score    (0-100, hoger = specifieker)
  kleinheid     = 100 - (packagings.volume / max_volume * 100)  (kleiner = hoger)
  goedkoopheid  = 100 - ((handling_cost + material_cost) / max_cost * 100)

  totaal_score  = (specificiteit * 1000) + (kleinheid * 100) + (goedkoopheid * 10)

Sorteer: hoogste score eerst
Resultaat: beste doos als primair advies
```

### 6.3 Multi-box algoritme (greedy bin-packing)

```
Input: [(shipping_unit_id, quantity)] — alle verzendeenheden
       mixability per product
Output: [{packaging_id, products: [...]}] — doos-toewijzingen

Algoritme:

STAP 1: SEPAREER NOT_MIXABLE producten
  → Elk NOT_MIXABLE product krijgt eigen doos
  → Gebruik compartiment-matching voor elke apart
  → Voeg toe aan resultaat

STAP 2: PROBEER alle MIXABLE producten in 1 doos
  → Run compartiment-matching op volledige set
  → Als match → klaar, voeg toe aan resultaat

STAP 3: GREEDY SPLIT (als stap 2 faalt)
  remaining = alle MIXABLE shipping_units

  WHILE remaining niet leeg:
    best_box = NULL
    best_coverage = 0

    FOR EACH doos in dozen (gesorteerd op specificiteit DESC):
      FOR EACH rule_group in doos:
        coverage = hoeveel remaining units deze rule_group afdekt
        IF coverage > best_coverage:
          best_box = doos
          best_coverage = coverage
          best_group = rule_group

    IF best_box gevonden:
      Wijs matched units toe aan best_box
      Verwijder matched units uit remaining
      Voeg toe aan resultaat
    ELSE:
      → Fallback: wijs alle remaining toe aan "Open Doos"
      → Break

STAP 4: RESULTAAT
  → Lijst van [{packaging_id, packaging_name, products, rule_group_matched}]
  → Confidence: full_match / partial_match / fallback
```

### 6.4 Fallback-strategie — GEEN tag bij onzekerheid

> **Beslissing:** Als de engine niet zeker is, wordt er GEEN tag geschreven. De medewerker kiest dan handmatig.

| Situatie | Actie | Tag schrijven? |
|----------|-------|---------------|
| Alle producten matchen in 1 doos | confidence = `full_match` | **Ja** |
| Greedy split, alle delen matchen | confidence = `partial_match` | **Ja** |
| Product niet classificeerbaar (geen data) | `unclassified_products` lijst | **Nee** |
| Geen enkele doos matcht | confidence = `no_match` | **Nee** |
| Gewicht overschrijdt alle dozen | confidence = `weight_exceeded` | **Nee** |

Er is **geen Open Doos fallback**. Als het niet zeker is, geen tag. Dit voorkomt foutief advies.

### 6.5 Gewichts-validatie

Dozen hebben een maximaal gewicht (`max_weight` in gram). De engine:

1. Berekent totaalgewicht van producten per doos (uit `product_attributes.weight`)
2. Sluit dozen uit waarvan `max_weight` wordt overschreden
3. Als geen enkele doos qua gewicht past → `confidence = weight_exceeded`, geen tag

---

## 7. Picqer Integratie

### 7.1 Custom Product Fields

Aan te maken in Picqer admin (eenmalig, handmatig):

| Veld | Type | Verplicht | Voorbeeld |
|------|------|-----------|-----------|
| Planthoogte (cm) | Nummer | Nee | `85` |
| Potmaat (cm) | Nummer | Nee | `17` |
| Producttype | Tekst/Dropdown | Nee | `Plant` |
| Breekbaar | Ja/Nee | Nee | `Nee` |
| Mixable | Ja/Nee | Nee | `Ja` |

> **Beslissing:** Custom field "Planthoogte" is de bron van waarheid (niet het native Picqer `height` veld, dat is inconsistent gevuld).
> **Status:** Nog niet aangemaakt in Picqer. Dit is stap 1 van de implementatie.
> **Let op:** Na aanmaken de `idproductfield` waarden noteren — die hebben we nodig in de code voor sync.

#### Instructie voor Kenny: Custom Fields aanmaken in Picqer

1. Ga naar Picqer → Instellingen → Productvelden
2. Maak de volgende 5 velden aan:
   - **Planthoogte (cm)** — type: Nummer
   - **Potmaat (cm)** — type: Nummer
   - **Producttype** — type: Tekst (waarden: Plant, Pot, Pot+Plant, Kunstplant, Oppotten, Bundel, Accessoire)
   - **Breekbaar** — type: Ja/Nee
   - **Mixable** — type: Ja/Nee
3. Noteer per veld de `idproductfield` (zichtbaar in de URL of via API)
4. Sla deze ID's op in `.env.local`:
   ```
   PICQER_FIELD_PLANTHOOGTE=<id>
   PICQER_FIELD_POTMAAT=<id>
   PICQER_FIELD_PRODUCTTYPE=<id>
   PICQER_FIELD_BREEKBAAR=<id>
   PICQER_FIELD_MIXABLE=<id>
   ```

### 7.2 Nieuwe Picqer API endpoints (te bouwen)

#### Product tags (lezen/schrijven)

```
GET    /api/v1/products/{id}/tags           → lees product tags
POST   /api/v1/products/{id}/tags           → voeg tag toe {"idtag": N}
DELETE /api/v1/products/{id}/tags/{idtag}   → verwijder tag
```

#### Order tags (lezen/schrijven)

```
POST   /api/v1/orders/{id}/tags             → voeg doos-tag toe {"idtag": N}
DELETE /api/v1/orders/{id}/tags/{idtag}     → verwijder oude doos-tag
```

#### Product custom fields (lezen/schrijven)

```
GET    /api/v1/products/{id}                → bevat productfields[]
PUT    /api/v1/products/{id}                → update met productfields[]
```

#### Product compositions (lezen)

```
GET    /api/v1/products/{id}/parts          → lijst van composition parts
```

#### Producten syncen

```
GET    /api/v1/products?updated_since=X     → gewijzigde producten ophalen
GET    /api/v1/products?tag=X               → producten filteren op tag
```

### 7.3 Tag-conventie voor doos-advies

Alle doos-tags in Picqer gebruiken het prefix `C - ` (Compartiment):

```
C - Vouwdoos 100cm
C - Vouwdoos 130cm
C - Vouwdoos 160cm
C - Vouwdoos 180cm
C - Kokerdoos 2x P12
C - Kokerdoos 100cm
C - 2x Kokerdoos 100cm
C - 3x Kokerdoos 100cm
C - Eurodoos 40
C - Eurodoos 60
C - Open Doos
C - Surprise box
C - Oppotten P22-P40
C - Oppotten P41-P65
C - Oppotten P66-P80
C - Oppotten P81-P100
... etc.
```

**Bij multi-box advies:** meerdere tags op dezelfde order (Picqer ondersteunt dit).

**Bij herberekening:** eerst alle `C - ` tags verwijderen, dan nieuwe schrijven.

### 7.4 Sync-strategie

#### Initieel (eenmalig)

```
Everspring .xlsx
  → Parse: Pot_size, Size_z, Type per product
  → Match op productcode met Picqer producten
  → PUT /api/v1/products/{id} met custom fields
  → INSERT product_attributes in Supabase
  → Voor compositions: GET /parts, INSERT product_composition_parts
  → Run classificatie: product → shipping_unit

Geschatte duur: ~45-60 min voor 3000+ producten (rate limited)
```

#### Ongoing (polling, elke 15 minuten of on-demand)

```
1. GET /api/v1/products?updated_since={last_sync_timestamp}
2. Per gewijzigd product:
   a. Lees custom fields (potmaat, hoogte, type, breekbaar, mixable)
   b. Update product_attributes in Supabase
   c. Herbereken shipping_unit_id als classificatie-relevant veld gewijzigd
   d. Als shipping_unit gewijzigd:
      → Markeer packaging_advice als 'stale' voor openstaande orders met dit product
3. Voor compositions: check of parts gewijzigd zijn
4. Update last_synced_at
```

#### Just-in-time fallback

```
Engine vraagt product op dat niet in cache zit (nieuw product):
  → GET /api/v1/products/{id} van Picqer
  → Parse custom fields
  → INSERT in product_attributes
  → Classificeer
  → Ga door met berekening
```

---

## 8. Verpakkingsmodule Integratie

### 8.1 Bij openen picklijst

```
Huidige flow:
  1. Worker selecteert picklijst
  2. Packing session wordt aangemaakt
  3. Producten worden geladen

Nieuwe stappen (na stap 3):
  4. Lees order-tags uit Picqer
  5. Filter op C- prefix → dit zijn doos-adviezen
  6. Per C- tag: zoek packaging in lokale packagings tabel
  7. Toon adviesbanner:

     ┌──────────────────────────────────────────────┐
     │  Doos-advies: Vouwdoos 100cm                 │
     │  [Toepassen]  [Andere doos kiezen]            │
     └──────────────────────────────────────────────┘

  8. Bij "Toepassen": maak automatisch een box aan met die packaging
  9. Bij "Andere doos kiezen": handmatige flow (zoals nu)
```

### 8.2 Bij multi-box advies

```
     ┌──────────────────────────────────────────────┐
     │  Doos-advies: 2 dozen                        │
     │                                               │
     │  1. Vouwdoos 130cm                            │
     │     └─ 2x Monstera P30                       │
     │                                               │
     │  2. Kokerdoos 2x P12                          │
     │     └─ 2x Succulent P12 + 2x Pot P12         │
     │                                               │
     │  [Alle toepassen]  [Handmatig kiezen]         │
     └──────────────────────────────────────────────┘
```

### 8.3 Waarschuwingen

| Situatie | Waarschuwing |
|----------|-------------|
| Product niet classificeerbaar | `"Product X kon niet geclassificeerd worden (potmaat/hoogte ontbreekt)"` |
| Advies = fallback (Open Doos) | `"Geen specifieke doos gevonden, Open Doos wordt geadviseerd"` |
| Advies = no_match | `"Geen passende doos gevonden, kies handmatig"` |
| Picklijst producten wijken af van order | `"Let op: picklijst bevat andere producten dan verwacht"` |
| Advies is stale | `"Doos-advies is mogelijk verouderd (order gewijzigd sinds berekening)"` |

### 8.4 Bij sluiten picklijst (feedback opslag)

```
Wanneer: alle dozen zijn verscheept (shipments aangemaakt)
Wat: automatisch opslaan in bestaande tabellen + uitbreidingen

Per box in packing_session_boxes:
  → suggested_packaging_id = advies uit packaging_advice
  → was_override = (gekozen doos != geadviseerde doos)
  → packaging_advice_id = link naar het advies

Per product in packing_session_products:
  → shipping_unit_id = classificatie van dit product
  → shipping_unit_name = naam voor historische referentie

In packaging_advice:
  → status = 'applied' of 'overridden' (afhankelijk van was_override)
```

---

## 9. Admin Interface

### 9.1 Pagina-structuur (onder /verpakkingsmodule/instellingen)

```
Instellingen
├── Tag-mappings (bestaand, wordt uitgebreid)
├── Verzendeenheden
│   ├── Lijst van alle 71+ shipping units
│   ├── Toevoegen / bewerken / deactiveren
│   └── Ranges visueel weergeven
├── Dozen
│   ├── Lijst van alle dozen (uit Picqer sync + extra velden)
│   ├── Kosten, limieten, specificiteit instellen
│   └── Sync met Picqer triggeren
├── Compartimenten-regels
│   ├── Per doos: alle rule_groups tonen
│   ├── EN/OF/ALTERNATIEF visueel bewerken
│   └── Import vanuit Everspring data (eenmalig)
├── Product sync
│   ├── Sync status (laatste sync, aantal producten)
│   ├── Handmatige sync triggeren
│   ├── Producten zonder classificatie (overzicht + fix)
│   └── Bulk import vanuit Everspring
└── Analyse (feedback loop)
    ├── Override-statistieken per doos
    ├── Meest voorkomende combinaties
    ├── Combinaties zonder regel
    └── Suggesties voor regelaanpassingen
```

### 9.2 Compartimenten-regels UI

De compartimenten-regels zijn het meest complexe onderdeel om te beheren. Voorstel voor de UI:

```
┌───────────────────────────────────────────────────────────────┐
│  Compartiment: Vouwdoos 100cm                                 │
│                                                               │
│  Configuratie 1 (OF-groep 1):                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ EN  PLANT | P17-P21 | H0-H100          ×2              │  │
│  │ EN  PLANT | P10,5-P16 | H40-H100       ×4              │  │
│  │     ALT: PLANT | P10,5-P14 | H0-H60                    │  │
│  │ EN  POT | P10,5-P16                     ×4              │  │
│  │ EN  POT | P22-P24                       ×1              │  │
│  │     ALT: POT | P17-P18                                  │  │
│  │     ALT: POT | P19-P21                                  │  │
│  │ [+ Eenheid toevoegen]                                   │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  Configuratie 2 (OF-groep 2):                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ EN  PLANT | P22-P30 | H0-H100          ×1              │  │
│  │ EN  PLANT | P10,5-P16 | H40-H100       ×4              │  │
│  │ [+ Eenheid toevoegen]                                   │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  [+ Configuratie toevoegen (OF)]                              │
└───────────────────────────────────────────────────────────────┘
```

---

## 10. Edge Cases & Oplossingen

### 10.1 Productdata

| Edge Case | Oplossing |
|-----------|-----------|
| Product zonder potmaat/hoogte | `classification_status = 'no_data'`, toon waarschuwing, handmatige doos |
| Product valt in geen enkele range (bijv. P15) | Nieuwe verzendeenheid aanmaken of bestaande range uitbreiden |
| Product matcht meerdere ranges (overlap) | Admin-fout → toon in admin als conflict, eerste match gebruiken |
| Nieuw product niet in cache | Just-in-time fetch uit Picqer, classificeer, cache |
| Custom field verwijderd in Picqer | Match op `idproductfield` (niet naam), foutmelding bij sync als field mist |
| Potmaat/hoogte als kommagetal (10,5) | Opslaan als DECIMAL(5,1), zowel punt als komma accepteren |

### 10.2 Compositions

| Edge Case | Oplossing |
|-----------|-----------|
| Compositie met 3+ parts | Alle parts apart classificeren, quantities vermenigvuldigen |
| Geneste compositie (composition in composition) | Recursief decomponeren (max 3 niveaus diep) |
| Part is niet classificeerbaar | Toevoegen aan unclassified_products, waarschuwing |
| Bundel met eigen verzendeenheid | Gebruik eigen shipping_unit, NIET decomponeren |
| Bundel zonder eigen verzendeenheid | WEL decomponeren naar parts |
| Order met 3x een compositie van 2 parts | 3 × 2 = 6 verzendeenheden meenemen |

### 10.3 Order/Picklijst

| Edge Case | Oplossing |
|-----------|-----------|
| Order wijzigt na engine-run | Tag detectie: `packaging_advice.status = 'stale'`, waarschuwing in module |
| Meerdere picklijsten per order | Advies op order-niveau, validatie per picklijst in module |
| Order met alleen accessoires | Geen classificatie mogelijk → handmatige doos, geen tag |
| "Overig" producten in order | Negeren in engine (nemen geen significante ruimte in) |
| Lege order (geen producten) | Skip, geen advies |
| Partial picks (niet alles gepickt) | Advies is op basis van volledige order, waarschuwing als incomplete pick |

### 10.4 Doos-selectie

| Edge Case | Oplossing |
|-----------|-----------|
| Meerdere dozen matchen | Ranking: specifiekst → kleinst → goedkoopst |
| Geen enkele doos matcht | **Geen tag schrijven**, confidence = `no_match`, medewerker kiest handmatig |
| MIXABLE + NOT_MIXABLE in order | Split: NOT_MIXABLE apart, MIXABLE samen |
| Breekbaar + niet-breekbaar samen | Afhankelijk van compartiment-regel (als regel het toestaat, mag het) |
| Order te groot voor 1 doos | Multi-box greedy algoritme |
| Gewicht overschrijdt max_weight | Doos uitsluiten uit kandidaten, volgende proberen |
| Gewicht overschrijdt ALLE dozen | **Geen tag schrijven**, confidence = `weight_exceeded` |
| Oppotten-product in order | Herken als apart product, wijs toe aan oppotten-doos op basis van potmaat |

### 10.5 Tags & Sync

| Edge Case | Oplossing |
|-----------|-----------|
| Oude C- tag nog op order | Bij herberekening: eerst ALLE C- tags verwijderen, dan nieuwe schrijven |
| Doos-tag bestaat niet in Picqer | Admin-actie nodig: tag aanmaken in Picqer |
| Rate limiting bij bulk tag-schrijven | Gebruik bestaande `rateLimitedFetch()` met exponential backoff |
| Picqer API down tijdens engine-run | Queue mislukte operaties, retry bij volgende run |
| Sync en engine draaien tegelijk | Sync-lock: engine wacht tot sync klaar is (of vice versa) |

---

## 11. Sprint Plan — 2 Weken (deadline 27 februari 2026)

> **Constraint:** 500 orders/dag, Everspring gaat uit over 2 weken.
> **Strategie:** MVP die Everspring's kernfunctie vervangt (product → doos advies → tag op order).
> **Na deadline:** Feedback loop, intelligence, geavanceerde admin-UI.

### Wat MOET af in 2 weken (MVP)

1. Productdata in Picqer (custom fields + import)
2. Producten classificeerbaar naar verzendeenheden
3. Engine berekent doosadvies (incl. multi-box + gewicht)
4. Tags geschreven op Picqer orders
5. Verpakkingsmodule toont advies + laat overrulen toe
6. Feedback opslag bij sluiten picklijst

### Wat kan NA de deadline (Post-MVP)

- Geavanceerde admin UI voor compartimenten-regels
- Analyse dashboard
- Automatische herberekening (webhooks)
- Suggestie-engine op basis van feedback data

---

### Week 1: Data + Engine (dag 1-7)

#### Dag 1-2: Picqer Voorbereiding (Kenny + Claude)

| # | Taak | Wie | Status |
|---|------|-----|--------|
| 0.1 | Custom product fields aanmaken in Picqer admin | Kenny (handmatig) | |
| 0.2 | `idproductfield` ID's noteren → `.env.local` | Kenny | |
| 0.3 | Everspring compartimenten-regels exporteren (volledig) | Kenny via Claude Cowork | |
| 0.4 | CLI bulk import script bouwen: Everspring .xlsx → Picqer custom fields | Claude | |
| 0.5 | Script draaien (~45-60 min voor 3.000 producten) | Kenny | |
| 0.6 | Validatie: steekproef 20 producten checken | Kenny | |

**Resultaat dag 2:** Alle producten in Picqer hebben potmaat, hoogte, type.

#### Dag 2-3: Database Foundation (Claude)

| # | Taak | Complexiteit |
|---|------|-------------|
| 1.1 | Migratie: `shipping_units` tabel | Laag |
| 1.2 | Migratie: `product_attributes` tabel | Laag |
| 1.3 | Migratie: `product_composition_parts` tabel | Laag |
| 1.4 | Migratie: `compartment_rules` tabel | Laag |
| 1.5 | Migratie: `packaging_advice` tabel | Laag |
| 1.6 | Migratie: uitbreidingen `packagings` (kosten, gewicht, specificiteit) | Laag |
| 1.7 | Migratie: uitbreidingen `packing_session_products` + `packing_session_boxes` | Laag |
| 1.8 | Seed data: 71+ verzendeenheden importeren (incl. P15-P16 range) | Medium |
| 1.9 | Seed data: Everspring compartimenten-regels importeren | Hoog |

**Resultaat dag 3:** Alle tabellen aangemaakt, seed data geladen.

#### Dag 3-4: Picqer Client + Sync (Claude)

| # | Taak | Complexiteit |
|---|------|-------------|
| 2.1 | Picqer client: product custom fields lezen (GET /products/{id}) | Medium |
| 2.2 | Picqer client: product custom fields schrijven (PUT /products/{id}) | Laag |
| 2.3 | Picqer client: composition parts lezen (GET /products/{id}/parts) | Laag |
| 2.4 | Picqer client: order tags schrijven (POST /orders/{id}/tags) | Laag |
| 2.5 | Picqer client: order tags verwijderen (DELETE /orders/{id}/tags/{idtag}) | Laag |
| 2.6 | Sync service: Picqer producten → product_attributes cache | Medium |
| 2.7 | Sync service: compositions → product_composition_parts | Medium |
| 2.8 | Auto-classificatie service: product → shipping_unit_id | Medium |
| 2.9 | API endpoint: `POST /api/verpakking/sync/products` (on-demand trigger) | Laag |

**Resultaat dag 4:** Producten gesynchroniseerd en geclassificeerd.

#### Dag 5-7: Engine Bouwen (Claude)

| # | Taak | Complexiteit |
|---|------|-------------|
| 3.1 | Compartiment-matching algoritme | Hoog |
| 3.2 | Ranking: specifiekst → kleinst → goedkoopst | Medium |
| 3.3 | Multi-box greedy bin-packing | Hoog |
| 3.4 | Gewichts-validatie (max_weight per doos) | Medium |
| 3.5 | Mixability handling (NOT_MIXABLE apart) | Medium |
| 3.6 | Composition decomponeren (parts → shipping units) | Medium |
| 3.7 | Oppotten-herkenning (apart product in order) | Laag |
| 3.8 | Confidence scoring (full_match/partial/no_match → wel/geen tag) | Laag |
| 3.9 | Engine endpoint: `POST /api/verpakking/engine/calculate` | Medium |
| 3.10 | Engine endpoint: `POST /api/verpakking/engine/apply-tags` | Medium |
| 3.11 | Integratie-test: engine draaien op 10 echte orders | Medium |

**Resultaat dag 7:** Engine berekent dozen en schrijft tags naar Picqer.

---

### Week 2: Integratie + Admin + Polish (dag 8-14)

#### Dag 8-9: Verpakkingsmodule Integratie (Claude)

| # | Taak | Complexiteit |
|---|------|-------------|
| 4.1 | Doos-advies banner component in VerpakkingsClient | Medium |
| 4.2 | C- tags uitlezen bij openen picklijst → advies tonen | Laag |
| 4.3 | "Toepassen" actie: automatisch box(en) aanmaken met geadviseerde packaging | Medium |
| 4.4 | Multi-box advies tonen met product-toewijzing per doos | Medium |
| 4.5 | Waarschuwingen: unclassified products, no_match, stale advies | Laag |

**Resultaat dag 9:** Medewerkers zien doos-advies in de inpakmodule.

#### Dag 9-10: Feedback Opslag (Claude)

| # | Taak | Complexiteit |
|---|------|-------------|
| 5.1 | Bij sluiten picklijst: shipping_unit opslaan per product | Medium |
| 5.2 | Bij sluiten picklijst: suggested_packaging + was_override opslaan per box | Medium |
| 5.3 | packaging_advice status updaten (applied/overridden) | Laag |

**Resultaat dag 10:** Elke afgesloten picklijst slaat feedback op.

#### Dag 10-12: Admin Pagina's (Claude)

| # | Taak | Complexiteit |
|---|------|-------------|
| 6.1 | Admin: verzendeenheden lijst + toevoegen/bewerken/deactiveren | Medium |
| 6.2 | Admin: dozen beheren (kosten, max gewicht, specificiteit) | Medium |
| 6.3 | Admin: compartimenten-regels viewer (read-only kaarten per doos) | Medium |
| 6.4 | Admin: compartimenten-regels basis-editor (toevoegen/verwijderen van regels) | Hoog |
| 6.5 | Admin: product sync status + handmatige trigger | Medium |
| 6.6 | Admin: producten zonder classificatie overzicht | Laag |
| 6.7 | Admin: engine on-demand trigger (bereken dozen voor openstaande orders) | Laag |

**Resultaat dag 12:** Admin kan verzendeenheden, dozen en regels beheren.

#### Dag 12-13: On-demand Engine Trigger (Claude)

| # | Taak | Complexiteit |
|---|------|-------------|
| 7.1 | UI knop in Batchmaker: "Bereken dozen voor geselecteerde orders" | Laag |
| 7.2 | Bulk engine run: bereken + tag alle openstaande orders | Medium |
| 7.3 | Progress indicator tijdens bulk berekening | Laag |

**Resultaat dag 13:** Kenny kan dozen laten berekenen en taggen voor alle orders.

#### Dag 13-14: Testen + Bugfixes (Claude + Kenny)

| # | Taak |
|---|------|
| 8.1 | End-to-end test: order → engine → tag → verpakkingsmodule → sluiten → feedback |
| 8.2 | Test met echte orders: 20 orders handmatig valideren |
| 8.3 | Edge case tests: compositions, oppotten, onclassificeerbaar, multi-box |
| 8.4 | Performance test: engine draaien op 500 orders |
| 8.5 | Bugfixes en polish |

**Resultaat dag 14:** Systeem productie-klaar.

---

### Post-MVP (na deadline, incrementeel)

| # | Taak | Prioriteit |
|---|------|-----------|
| P.1 | Compartimenten-regels visuele editor (drag-and-drop configuraties) | Hoog |
| P.2 | Analyse dashboard: override-statistieken per doos | Hoog |
| P.3 | Analyse dashboard: combinaties zonder regel | Hoog |
| P.4 | Picqer webhook: real-time product sync | Medium |
| P.5 | Automatische herberekening bij order-wijziging | Medium |
| P.6 | Suggestie-engine: regelaanpassingen op basis van feedback | Medium |
| P.7 | Polling sync (elke 15 min) als tussenstap naar webhooks | Laag |
| P.8 | Stale-detection: advies markeren als order wijzigt | Laag |

---

## 12. Beslissingen (genomen)

| # | Beslissing | Gekozen | Reden |
|---|-----------|---------|-------|
| 1 | Planthoogte bron | **Custom field** (niet native Picqer `height`) | Native veld inconsistent gevuld |
| 2 | Fallback bij onzekerheid | **Geen tag schrijven** | Liever geen advies dan fout advies |
| 3 | Doos-prioritering | **Specifiekst → kleinst → goedkoopst** | |
| 4 | Multi-box advies | **Ja, vanaf dag 1** | Essentieel voor 500 orders/dag |
| 5 | Gewicht meenemen | **Ja, max_weight per doos** | Dozen hebben gewichtslimieten |
| 6 | Import methode | **CLI script** (eenmalig) | Simpel, geen UI nodig |
| 7 | Engine trigger | **On-demand + bij batch creatie** (MVP), webhook later | |
| 8 | Product sync | **On-demand** (MVP), polling/webhook later | |
| 9 | "Overig" producten | **Negeren** in engine | Nemen geen significante ruimte in |
| 10 | Oppotten-herkenning | **Via apart product in order** | Niet via tag of ordertype |
| 11 | Bundels/compositions | **Hybride:** eigen shipping_unit als BUNDEL, anders decomponeren | Flexibel |
| 12 | Compartimenten-regels UI | **Kaarten-view met basis-editor** (MVP), visuele editor post-MVP | Beheersbaar voor kantoor + warehouse |
| 13 | Grenzen verzendeenheid-ranges | **Inclusief** aan beide kanten | P14 zit in P10,5-P14 |
| 14 | Meerdere picklijsten per order | **Advies op order-niveau**, validatie per picklijst | Komt zelden voor |
| 15 | Doos-tags bij multi-box | **Meerdere tags** per order (1 per doos) | Picqer ondersteunt dit |

---

## 13. Technische Afhankelijkheden

```
Week 1:
  Dag 1-2: Picqer voorbereiding (Kenny handmatig + import script)
    └─ BLOKKEERT alles (zonder productdata geen classificatie)

  Dag 2-3: Database tabellen (parallel met import)
    └─ BLOKKEERT sync + engine

  Dag 3-4: Picqer client + sync
    ├─ VEREIST: tabellen + Picqer custom fields
    └─ BLOKKEERT: engine (heeft geclassificeerde producten nodig)

  Dag 5-7: Engine bouwen
    ├─ VEREIST: sync + compartiment seed data
    └─ BLOKKEERT: verpakkingsmodule integratie

Week 2:
  Dag 8-9: Verpakkingsmodule integratie
    ├─ VEREIST: engine werkt
    └─ PARALLEL MET: feedback opslag

  Dag 9-10: Feedback opslag
    ├─ VEREIST: tabel-uitbreidingen + classificatie
    └─ PARALLEL MET: admin pagina's

  Dag 10-12: Admin pagina's
    └─ PARALLEL MET: engine trigger UI

  Dag 12-14: Testen + bugfixes
    └─ VEREIST: alles hierboven
```

---

## 14. Risico's & Mitigatie

| Risico | Impact | Kans | Mitigatie |
|--------|--------|------|----------|
| Everspring compartimenten-data onvolledig | Engine mist regels → verkeerde adviezen | Medium | Manuele validatie met Kenny op dag 7 |
| Picqer rate limiting bij bulk import | Import duurt langer dan verwacht | Laag | Bestaande rateLimitedFetch, nachtelijk draaien |
| Compositions complexer dan verwacht | Geneste compositions, onverwachte types | Medium | Max 3 niveaus diep, fallback naar no_match |
| Potmaat/hoogte data mist voor veel producten | Veel producten niet classificeerbaar | Medium | Overzicht in admin, handmatig bijwerken |
| Engine performance bij 500 orders/dag | Berekening te langzaam | Laag | Caching, batch-verwerking, async |
| Medewerkers negeren advies | Feedback data toont veel overrides | Hoog | Is juist de bedoeling — feedback loop verbetert regels |

---

## 15. Instructies voor Kenny

### Stap 1: Custom Fields aanmaken (dag 1)
1. Ga naar Picqer → Instellingen → Productvelden
2. Maak 5 velden aan (zie sectie 7.1)
3. Noteer de `idproductfield` per veld
4. Voeg toe aan `.env.local`

### Stap 2: Everspring compartimenten exporteren (dag 1-2)
1. Open Claude Cowork met Everspring
2. Exporteer de VOLLEDIGE compartimenten-configuratie per doos:
   - Alle OF-branches met alle EN-regels en ALTERNATIEVEn
   - Inclusief aantallen per verzendeenheid
   - Alle 14+ actieve doostypen
3. Sla op als gestructureerd bestand (JSON of CSV)

### Stap 3: Bulk import draaien (dag 2)
1. Zorg dat de Everspring export .xlsx beschikbaar is
2. Run het CLI import script (wordt door Claude gebouwd)
3. Wacht ~45-60 min
4. Check 20 willekeurige producten in Picqer

### Stap 4: Validatie (dag 7 + dag 13-14)
1. Dag 7: Engine test met 10 echte orders — klopt het advies?
2. Dag 13-14: End-to-end test door warehouse-medewerker

---

*Document gegenereerd op 2026-02-13 door Mary (Business Analyst Agent) in samenwerking met Kenny.*
*Gebaseerd op: Everspring export analyse, Picqer API documentatie, bestaande verpakkingsmodule codebase analyse, en brainstormsessie.*
*Laatste update: 2026-02-13 — Sprint plan toegevoegd, alle beslissingen genomen.*
