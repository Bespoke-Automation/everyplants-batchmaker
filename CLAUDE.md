# CLAUDE.md - EveryPlants Batchmaker

## Overzicht

Intern operations-platform voor **EveryPlants** (plantengroothandel). Het platform heeft 4 functionele modules die elk een apart domein bedienen:

| Module | Route | Doel |
|--------|-------|------|
| **Portal** | `/` | Dashboard en navigatie naar alle modules |
| **Batchmaker** | `/batchmaker/batches` | Multi-order batch creatie voor het magazijn |
| **Verpakkingsmodule** | `/verpakkingsmodule` | Inpak- en verzendworkflow met adviesengine |
| **Floriday** | `/floriday` | Voorraad synchronisatie naar Floriday marktplaats |

Elke module heeft zijn eigen routes, componenten en business logica, maar ze delen dezelfde Picqer- en Supabase-integraties.

---

## Tech Stack

| Technologie | Versie | Doel |
|-------------|--------|------|
| Next.js | 16.1.1 | App Router framework |
| React | 19.2.3 | UI library |
| TypeScript | 5.8.2 | Type safety |
| Tailwind CSS | 3.4.17 | Styling |
| Supabase | 2.90.1 | Database (PostgreSQL), Storage |
| Inngest | 3.49.1 | Event-driven achtergrondtaken |
| pdf-lib | 1.17.1 | PDF bewerking (verzendlabels) |
| @dnd-kit | 6.3+ | Drag & drop (box inpakken) |
| lucide-react | 0.562.0 | Iconen |

---

## Externe Integraties

### Picqer (Warehouse Management) - `src/lib/picqer/`

**Wat**: Picqer is het warehouse management systeem (WMS). Alle order-, product-, picklist-, en verzenddata komt uit Picqer.

**API docs**: https://picqer.com/en/api

**Hoe we het gebruiken**:
- **Orders ophalen** — GET `/orders` met status=processing, inclusief picklists en tags
- **Picklists & batches** — Batches aanmaken, picklists ophalen, producten per batch
- **Verzending** — Shipments aanmaken, labels ophalen, multicollo ondersteuning
- **Producten** — Product details, custom fields, composities (bundels), voorraad per magazijn
- **Tags** — Tags lezen/schrijven op orders en producten (gebruikt voor verpakkingsadvies)
- **Verpakkingen** — Packaging types synchroniseren voor boxkeuze
- **Users** — Medewerkerlijst voor worker-selector in verpakkingsmodule
- **Comments** — Opmerkingen op picklists en batches

**Client** (`src/lib/picqer/client.ts`):
- Base URL: `https://{PICQER_SUBDOMAIN}.picqer.com/api/v1`
- Auth: HTTP Basic met `PICQER_API_KEY` als username
- Rate limiting: max 20 concurrent requests, exponential backoff bij 429
- 30-seconden in-memory cache voor orders
- Alle functies gebruiken `rateLimitedFetch()` wrapper

**Custom Picqer Fields** (order- en productniveau):

| Veld | Type | Field ID | Env var |
|------|------|----------|---------|
| Plantnummer | orderfield | 3262 | - |
| Retailer name | orderfield | 3332 | - |
| Retailer order number | orderfield | 3333 | - |
| Leverdag | orderfield | 3507 | - |
| Potmaat (cm) | productfield | 5768 | `PICQER_FIELD_POTMAAT` |
| Planthoogte (cm) | productfield | 5769 | `PICQER_FIELD_PLANTHOOGTE` |
| Producttype | productfield | 5770 | `PICQER_FIELD_PRODUCTTYPE` |
| Breekbaar | productfield | 5771 | `PICQER_FIELD_BREEKBAAR` |
| Mixable | productfield | 5772 | `PICQER_FIELD_MIXABLE` |
| Alternatieve SKU | productfield | 4875 | `PICQER_FIELD_ALTERNATIEVE_SKU` |

### Floriday (B2B Marktplaats Sierteelt) - `src/lib/floriday/`

**Wat**: Floriday is de digitale handelsinfrastructuur voor de sierteeltsector. We pushen voorraad als batches naar Floriday zodat klanten kunnen bestellen.

**API docs**:
- Swagger (staging): https://api.staging.floriday.io/suppliers-api-2025v2/swagger/index.html
- Developer docs: https://developer.floriday.io/docs/welcome
- API versie: Suppliers API 2025v2

**Hoe we het gebruiken**:
- **Trade items syncen** — Catalogus ophalen via sequence-based sync
- **Batches pushen** — Voorraad als batch(es) naar Floriday sturen (1 voor bulk stock + 1 per inkooporder)
- **Product mapping** — Automatische koppeling Picqer product ↔ Floriday trade item
- **Stock berekenen** — Combinatie van huidige voorraad + inkooporders deze week
- **Orders ontvangen** — Sales orders ophalen en verwerken

**Client** (`src/lib/floriday/client.ts`):
- Auth: OAuth2 Client Credentials met token caching (5 min safety margin)
- Rate limiting: 3.4 req/sec sync, 10 req/sec stock, max 3 concurrent requests
- Sequence-based sync loop voor incrementele updates
- Exponential backoff (max 5 retries)

### Supabase (Database & Storage) - `src/lib/supabase/`

**Wat**: PostgreSQL database voor alle applicatiedata. Picqer is source of truth voor orders/producten, Supabase slaat configuratie, sessies, en engine-resultaten op.

**Schema**: Alle tabellen in `batchmaker` schema (niet `public`). Client selecteert expliciet: `.schema('batchmaker').from(...)`.

**Storage**: Bucket `shipment_labels` voor verzendlabel PDFs.

**Client** (`src/lib/supabase/client.ts`):
- `persistSession: false` (geen user auth, app-level auth)
- `cache: 'no-store'` override op fetch (voorkomt Next.js caching)

---

## Projectstructuur

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout
│   ├── (auth)/login/             # Login pagina
│   ├── (portal)/                 # Dashboard (route: /)
│   ├── (batchmaker)/batchmaker/  # Batchmaker module
│   │   ├── batches/              # Multi-order batches
│   │   │   └── history/          # Batch creatie historie
│   │   ├── single-orders/        # Individuele orders
│   │   │   └── history/          # Verzendhistorie
│   │   └── settings/             # Postcoderegio's
│   ├── (floriday)/floriday/      # Floriday module
│   │   ├── stock/                # Voorraadoverzicht
│   │   ├── orders/               # Floriday orders
│   │   └── logs/                 # Sync logs
│   ├── (verpakkingsmodule)/verpakkingsmodule/
│   │   ├── dashboard/            # Inpak statistieken
│   │   ├── instellingen/         # Verpakkingen, tags, regels
│   │   ├── geschiedenis/         # Sessiehistorie
│   │   └── engine-log/           # Engine advies log
│   └── api/                      # ~80 API routes (zie API sectie)
├── components/
│   ├── BatchmakerClient.tsx      # Hoofd batch pagina
│   ├── SingleOrdersClient.tsx    # Hoofd single orders pagina
│   ├── batches/                  # Batch historie componenten
│   ├── filters/                  # FilterPanel
│   ├── floriday/                 # FloridayDashboard, Stock, Orders, SyncLog
│   ├── layout/                   # Header, Footer
│   ├── orders/                   # OrdersTable
│   ├── presets/                  # PresetsPanel
│   ├── settings/                 # PostalRegionsManager
│   ├── single-orders/            # GroupedOrdersTable, BatchHistory
│   ├── ui/                       # Dialog, ConfirmDialog, TableSearch, etc.
│   └── verpakking/               # 16 componenten (zie Verpakkingsmodule)
├── hooks/                        # 20 custom hooks
├── lib/
│   ├── picqer/                   # Picqer API client, types, transform
│   ├── floriday/                 # Floriday API client, auth, sync, mappers
│   ├── supabase/                 # 12 Supabase helper modules
│   ├── engine/                   # Verpakkingsadvies engine
│   ├── pdf/                      # PDF label bewerking
│   └── singleOrders/             # Single order processing logica
└── types/
    ├── order.ts                  # TransformedOrder type
    ├── singleOrder.ts            # SingleOrder + ProductGroup types
    ├── database.ts               # Supabase schema types
    ├── verpakking.ts             # Verpakkingsmodule types (~264 lines)
    └── filters.ts                # Filter types
```

---

## Modules in Detail

### 1. Batchmaker (`/batchmaker/batches`)

**Doel**: Meerdere orders groeperen in een batch (picklijst) voor efficiënt magazijnwerk.

**Flow**:
1. Orders ophalen uit Picqer (status=processing, picklist status=new, niet in batch)
2. Filteren op retailer, tags, bezorgland, leverdag, postcoderegio
3. Orders selecteren → batch aanmaken in Picqer
4. Optioneel n8n webhook triggeren

**Key files**:
- `src/components/BatchmakerClient.tsx` — Hoofd UI met tabel, filters, presets
- `src/components/filters/FilterPanel.tsx` — Filter dropdowns
- `src/components/presets/PresetsPanel.tsx` — Opslaan/laden van filterpresets
- `src/hooks/useOrders.ts` — Orders ophalen met polling
- `src/hooks/useFilters.ts` — Filter state management
- `src/hooks/usePresets.ts` — Preset CRUD
- `src/lib/picqer/transform.ts` — Picqer order → TransformedOrder

**Data transformatie**: Orders worden getransformeerd via `transformOrder()`:
- Retailer wordt uit tags gehaald (Green Bubble, Everspring, Ogreen, Florafy, Trendyplants, Plantura)
- Leverdag uit custom orderfield (3507)
- Orders met excluded tags worden uitgefilterd ("Versturen wanneer niet te koud", etc.)
- `isPartOfBatch` check: heeft order een picklist met status=new die niet in batch zit?

### 2. Single Orders (`/batchmaker/single-orders`)

**Doel**: Individuele orders verwerken met automatische verzendlabel generatie.

**Flow**:
1. Orders groeperen op product
2. Selecteren en batch aanmaken
3. Per order: shipment aanmaken in Picqer → label ophalen → PDF bewerken → uploaden naar Supabase Storage
4. Gecombineerde PDF beschikbaar

**Key files**:
- `src/components/SingleOrdersClient.tsx` — Hoofd UI
- `src/components/single-orders/GroupedOrdersTable.tsx` — Orders gegroepeerd op product
- `src/hooks/useSingleOrders.ts`, `useSingleOrderFilters.ts`
- `src/lib/singleOrders/` — Processing logica
- `src/lib/pdf/` — PDF label bewerking (pdf-lib)

### 3. Verpakkingsmodule (`/verpakkingsmodule`)

**Doel**: Complete inpak- en verzendworkflow. Medewerker pakt een batch, scant producten, kiest dozen, en verstuurt.

**Flow**:
1. **WorkerSelector** → Medewerker selecteren
2. **BatchQueue** → Open batches tonen, batch claimen
3. **BatchOverview** → Picklists in batch bekijken, picklist starten
4. **VerpakkingsClient** → Producten scannen, in dozen plaatsen, verzenden

**Key files**:
- `src/components/verpakking/WorkerSelector.tsx` — Medewerker kiezen
- `src/components/verpakking/BatchQueue.tsx` — Batch queue met claim
- `src/components/verpakking/BatchOverview.tsx` — Picklist overzicht
- `src/components/verpakking/VerpakkingsClient.tsx` — Inpakscherm
- `src/components/verpakking/BoxCard.tsx` — Doos met producten
- `src/components/verpakking/ProductCard.tsx` — Product kaart
- `src/components/verpakking/BarcodeListener.tsx` — Barcode scanner
- `src/components/verpakking/ShipmentProgress.tsx` — Verzendvoortgang
- `src/hooks/useBatchQueue.ts`, `useBatchSession.ts`, `usePackingSession.ts`

**State management**: Session state in Supabase + `sessionStorage`:
- `verpakking_active_batch_session` — Actieve batch sessie ID
- `verpakking_active_session` — Actieve packing sessie ID

**Concurrency**: 30-minuten lock op packing sessions via `lock_expires_at`. Auto-refresh bij activiteit.

**Instellingen** (`/verpakkingsmodule/instellingen`):
- `PackagingList.tsx` — Verpakkingen beheren (uit Picqer + engine config)
- `ShippingUnitList.tsx` — Verzendeenheden classificatie
- `TagList.tsx` — Tags synchroniseren uit Picqer
- `TagMappingSettings.tsx` — Tag → verpakking koppelingen
- `CompartmentRules.tsx` — Dozen-regels (EN/OF/ALTERNATIEF)
- `ProductStatus.tsx` — Productclassificatie status

### 4. Packaging Advice Engine (`src/lib/engine/packagingEngine.ts`)

**Doel**: Automatisch de optimale doos(en) bepalen voor een order.

**Algoritme**:
1. **classifyOrderProducts** — Producten → shipping units classificeren (on-demand sync uit Picqer indien nodig)
2. **matchCompartments** — Compartment rules matchen (EN/OF/ALTERNATIEF operators)
3. **rankPackagings** — Ranking: specifiekst → kleinst → goedkoopst
4. **solveMultiBox** — Greedy bin-packing als 1 doos niet past
5. **persist** — Resultaat opslaan + tags schrijven naar Picqer order

**Confidence levels**: `full_match` | `partial_match` | `no_match`
- Geen tag als engine niet confident is (geen fallback)

**Feedback tracking** (`feedbackTracking.ts`): Registreert wanneer medewerker afwijkt van advies.

### 5. Floriday Module (`/floriday`)

**Doel**: Voorraad van EveryPlants producten synchroniseren naar het Floriday platform zodat klanten kunnen bestellen.

**Flow**:
1. **Trade items syncen** — Floriday catalogus ophalen (sequence-based incremental sync)
2. **Product mapping** — Picqer producten koppelen aan Floriday trade items (auto-match op productcode of alternatieve SKU)
3. **Stock berekenen** — Huidige voorraad (warehouse 9979, excl. PPS locaties) + inkooporders deze week
4. **Batch pushen** — Per product: 1 batch voor bulk stock (vandaag) + 1 batch per inkooporder (met PO leverdatum)

**Key files**:
- `src/lib/floriday/auth.ts` — OAuth2 token management
- `src/lib/floriday/client.ts` — HTTP client met rate limiting
- `src/lib/floriday/stock-service.ts` — Stock berekening
- `src/lib/floriday/push-batch-service.ts` — Batch push logica met auto-mapping
- `src/lib/floriday/types.ts` — 20+ TypeScript types
- `src/lib/floriday/sync/` — Sync services (trade items, orders)
- `src/lib/floriday/mappers/` — Data mapping (products, customers, orders)
- `src/components/floriday/FloridayDashboard.tsx` — Overzichtspagina
- `src/components/floriday/FloridayStock.tsx` — Voorraadtabel
- `src/components/floriday/FloridayOrders.tsx` — Orders overzicht

---

## Database Schema (Supabase, `batchmaker` schema)

### Configuratie & Filtering

| Tabel | Doel |
|-------|------|
| `batch_presets` | Opgeslagen filterpresets voor batchmaker (retailer[], tags[], bezorgland[], leverdag[], postal_regions[]) |
| `single_order_presets` | Opgeslagen filterpresets voor single orders |
| `excluded_products` | Producten uitgesloten van batching (idproduct, productcode) |
| `postal_regions` | Postcoderegio-definities met countries[] en postal_ranges[] |

### Batch & Verzending

| Tabel | Doel |
|-------|------|
| `batch_creations` | Log van batch creatie events (picqer_batch_id, picklist_count, status) |
| `single_order_batches` | Batch jobs voor single order verwerking (status tracking) |
| `shipment_labels` | Individuele verzendlabel tracking met status progressie |

### Verpakkingsmodule - Sessies

| Tabel | Doel |
|-------|------|
| `packing_batch_sessions` | Worker batch claims (assigned_to, status, voortgang) |
| `packing_sessions` | Individuele picklist sessies met 30-min lock |
| `packing_session_boxes` | Dozen binnen sessie (packaging, shipment tracking, suggested vs override) |
| `packing_session_products` | Producten toegewezen aan dozen |

### Verpakkingsmodule - Configuratie & Engine

| Tabel | Doel |
|-------|------|
| `packagings` | Verpakkingen gesynchroniseerd uit Picqer + engine config (max_weight, cost, specificity, picqer_tag_name, num_shipping_labels) |
| `tags` | Tags uit Picqer met type classificatie (packaging/plantura/other) |
| `tag_packaging_map` | Tag → verpakking aanbevelingen |
| `shipping_units` | 56 verzendeenheden met classificatieranges (pot_size, height, fragile) |
| `product_attributes` | Product cache uit Picqer met classificatie naar shipping_unit |
| `product_composition_parts` | Onderdelen van composities/bundels |
| `compartment_rules` | Dozen-regels per verpakking (EN/OF/ALTERNATIEF operators) |

### Floriday (apart `floriday` schema)

| Tabel | Doel |
|-------|------|
| `trade_items` | Gesynchroniseerde Floriday catalogus |
| `product_mapping` | Koppeling Picqer product ↔ Floriday trade item |
| `floriday_stock_cache` | Gecachte voorraaddata |

---

## API Routes (~80 endpoints)

### Auth (`/api/auth`)
- `POST /api/auth` — Login met wachtwoord, set auth cookie

### Orders (`/api/orders`, `/api/single-orders`)
- `GET /api/orders` — Alle processing orders ophalen (gecached 30s), transformeren, filteren
- `GET /api/single-orders` — Orders voor single-order modus met productgroepering
- `POST /api/single-orders/batch` — Batch aanmaken voor single orders
- `GET /api/single-orders/batch/active` — Actieve batch ophalen
- `POST /api/single-orders/batch/[batchId]/process` — Batch verwerken (shipments + labels)
- `GET /api/single-orders/batch/[batchId]/status` — Status polling
- `GET /api/single-orders/history` — Verzendhistorie

### Batches (`/api/batches`)
- `POST /api/batches/create` — Batch aanmaken in Picqer + optioneel n8n webhook
- `GET /api/batches/history` — Creatie historie

### Picqer Proxy (`/api/picqer/...`)
Proxied Picqer API calls met server-side auth:
- `GET /api/picqer/orders/[id]` — Enkele order
- `GET /api/picqer/picklist-batches` — Open batches ophalen
- `GET /api/picqer/picklist-batches/[id]` — Batch detail met picklists en producten
- `POST /api/picqer/picklist-batches/[id]/assign` — Batch toewijzen aan user
- `GET /api/picqer/picklist-batches/[id]/picklists` — Picklists in batch
- `GET /api/picqer/picklist-batches/[id]/pdf` — Batch PDF
- `GET /api/picqer/picklists/[id]` — Picklist detail
- `POST /api/picqer/picklists/[id]/pick` — Producten picken
- `POST /api/picqer/picklists/[id]/close` — Picklist sluiten
- `POST /api/picqer/picklists/[id]/assign` — Picklist toewijzen
- `POST /api/picqer/picklists/[id]/shipments` — Shipment aanmaken
- `POST /api/picqer/picklists/[id]/shipments/multicollo` — Multicollo shipment
- `GET/POST /api/picqer/picklists/[id]/comments` — Comments CRUD
- `POST /api/picqer/picklists/comments-bulk` — Bulk comments ophalen
- `GET /api/picqer/picklists/packinglistpdf` — Pakbon PDF
- `GET /api/picqer/shipments/[id]` — Shipment details + label
- `DELETE /api/picqer/comments/[id]` — Comment verwijderen
- `GET /api/picqer/packagings` — Alle verpakkingen
- `GET /api/picqer/tags` — Alle tags
- `GET /api/picqer/users` — Alle gebruikers
- `GET /api/picqer/me` — Huidige user
- `GET /api/picqer/shipping-methods` — Verzendmethoden

### Verpakkingsmodule (`/api/verpakking/...`)

**Sessies**:
- `GET/POST /api/verpakking/sessions` — Lijst / nieuwe sessie aanmaken
- `GET/PUT /api/verpakking/sessions/[id]` — Sessie detail / update
- `POST /api/verpakking/sessions/[id]/claim` — Picklist claimen (met lock)
- `GET/POST/DELETE /api/verpakking/sessions/[id]/boxes` — Dozen CRUD
- `GET/POST/PUT/DELETE /api/verpakking/sessions/[id]/products` — Producten in dozen
- `POST /api/verpakking/sessions/[id]/ship` — Enkele doos verzenden
- `POST /api/verpakking/sessions/[id]/ship-all` — Alle dozen verzenden
- `GET /api/verpakking/sessions/[id]/labels` — Labels ophalen
- `GET /api/verpakking/sessions/[id]/details` — Volledige sessie details

**Batch sessies**:
- `GET/POST /api/verpakking/batch-sessions` — Lijst / batch claimen
- `GET/PUT /api/verpakking/batch-sessions/[id]` — Detail / update

**Engine**:
- `POST /api/verpakking/engine/calculate` — Verpakkingsadvies berekenen
- `POST /api/verpakking/engine/apply-tags` — Tags schrijven naar Picqer order
- `GET /api/verpakking/engine/log` — Engine advies log

**Configuratie**:
- `GET /api/verpakking/packagings` — Lokale verpakkingen
- `POST /api/verpakking/packagings/create` — Nieuwe verpakking
- `PUT /api/verpakking/packagings/update` — Update (Picqer fields apart van engine fields)
- `DELETE /api/verpakking/packagings/delete` — Verwijderen
- `POST /api/verpakking/packagings/upload-image` — Afbeelding uploaden
- `GET /api/verpakking/tags` — Lokale tags
- `GET/POST/PUT/DELETE /api/verpakking/tag-mappings` — Tag ↔ verpakking mapping
- `GET /api/verpakking/shipping-units` — Verzendeenheden
- `GET/POST/PUT/DELETE /api/verpakking/compartment-rules` — Dozen-regels
- `GET /api/verpakking/product-attributes` — Product classificatie data
- `GET /api/verpakking/products/status` — Classificatie status overzicht

**Sync**:
- `POST /api/verpakking/sync/packagings` — Sync verpakkingen uit Picqer
- `POST /api/verpakking/sync/tags` — Sync tags uit Picqer
- `POST /api/verpakking/sync/products` — Sync producten uit Picqer

**Dashboard**:
- `GET /api/verpakking/dashboard/stats` — Inpak statistieken
- `GET /api/verpakking/dashboard/trends` — Trend data

### Floriday (`/api/floriday/...`)
- `POST /api/floriday/sync-trade-items` — Trade items syncen (sequence-based)
- `GET/POST /api/floriday/sync-stock` — GET: cached stock, POST: live stock berekenen
- `POST /api/floriday/push-batch` — Batch pushen voor 1 product
- `GET /api/floriday/mapped-products` — Actieve product mappings
- `GET /api/floriday/orders` — Floriday orders ophalen
- `POST /api/floriday/orders/[id]/retry` — Order opnieuw proberen
- `POST /api/floriday/sync/orders` — Orders syncen
- `POST /api/floriday/sync/trigger` — Volledige sync triggeren
- `GET /api/floriday/test-auth` — Auth connectie testen
- `POST /api/floriday/webhooks` — Webhook ontvanger

### Admin
- `POST /api/admin/sync-packaging-costs` — Verpakkingskosten syncen
- `POST /api/sync-excluded-products` — Excluded products lijst updaten

---

## Hooks (20 custom hooks)

| Hook | Module | Doel |
|------|--------|------|
| `useOrders` | Batchmaker | Orders ophalen met polling en caching |
| `useFilters` | Batchmaker | Filter state (retailer, tags, land, leverdag, regio) |
| `usePresets` | Batchmaker | Preset CRUD operaties |
| `useSingleOrders` | Single Orders | Orders met productgroepering |
| `useSingleOrderFilters` | Single Orders | Filters voor single orders |
| `usePostalRegions` | Batchmaker | Postcoderegio beheer |
| `useBatchCreationHistory` | Batchmaker | Batch creatie historie |
| `useBatchHistory` | Single Orders | Verzendlabel batch historie |
| `useBatchQueue` | Verpakking | Open batches ophalen + enrichen |
| `useBatchSession` | Verpakking | Batch sessie state + picklist navigatie |
| `usePackingSession` | Verpakking | Inpak sessie met boxes, producten, shipping |
| `usePicklistQueue` | Verpakking | Picklists binnen batch |
| `usePicklistComments` | Verpakking | Comments op picklists |
| `useWorker` | Verpakking | Medewerker selectie en state |
| `useLocalPackagings` | Verpakking | Lokale verpakkingen CRUD |
| `useLocalTags` | Verpakking | Tags synchronisatie |
| `useTagMappings` | Verpakking | Tag ↔ verpakking mappings |
| `useCompartmentRules` | Verpakking | Dozen-regels CRUD |
| `useTableSearch` | Shared | Generieke tabelsearch |
| `usePicqerUsers` | Shared | Picqer gebruikers ophalen |

---

## Authenticatie

Simpele cookie-based auth via middleware (`src/middleware.ts`):
- `/api/*` routes passeren zonder auth
- Login pagina valideert tegen `APP_PASSWORD` env var
- Set cookie `auth=authenticated`
- Middleware redirect naar `/login` als cookie ontbreekt

---

## Environment Variables

Vereist in `.env.local`:

```bash
# App
APP_PASSWORD=                         # Login wachtwoord

# Supabase
NEXT_PUBLIC_SUPABASE_URL=             # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # Supabase anon key

# Picqer
PICQER_SUBDOMAIN=                     # Picqer account subdomain
PICQER_API_KEY=                       # Picqer API key

# Picqer Custom Product Field IDs
PICQER_FIELD_POTMAAT=5768
PICQER_FIELD_PLANTHOOGTE=5769
PICQER_FIELD_PRODUCTTYPE=5770
PICQER_FIELD_BREEKBAAR=5771
PICQER_FIELD_MIXABLE=5772
PICQER_FIELD_ALTERNATIEVE_SKU=4875

# Floriday (staging)
FLORIDAY_CLIENT_ID=                   # OAuth2 client ID
FLORIDAY_CLIENT_SECRET=               # OAuth2 client secret
FLORIDAY_AUTH_URL=                     # Token endpoint
FLORIDAY_API_URL=                     # API base URL

# Optioneel
N8N_BATCH_WEBHOOK_URL=                # n8n webhook voor batch creatie
INNGEST_EVENT_KEY=                    # Inngest event key
INNGEST_SIGNING_KEY=                  # Inngest signing key
FACTURATIE_SUPABASE_URL=              # Facturatie project URL
FACTURATIE_SUPABASE_ANON_KEY=         # Facturatie project key
```

---

## Development Commands

```bash
npm run dev      # Start development server (Next.js 16)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

---

## Codebase Conventies

### Bestandsnamen
- Components: `PascalCase.tsx` (bijv. `BatchQueue.tsx`, `VerpakkingsClient.tsx`)
- Hooks: `camelCase.ts` met `use` prefix (bijv. `useBatchSession.ts`)
- API routes: `route.ts` in mappenstructuur
- Lib files: `camelCase.ts` of `kebab-case.ts`
- Types: `camelCase.ts` (bijv. `verpakking.ts`, `order.ts`)

### Component Patterns
- Client components met `'use client'` directive
- Server components als pages die client components laden
- Hooks voor alle data fetching (polling interval patroon)
- `lucide-react` voor iconen
- Tailwind utility classes, geen CSS modules
- `min-h-[44px]` voor touch targets
- Kleuren: emerald=completed, blue=in-progress, amber=warnings

### API Route Patterns
- `export const dynamic = 'force-dynamic'` op alle routes
- Next.js 16 dynamic params: `params: Promise<{ id: string }>` (await nodig)
- Response format: `NextResponse.json({ data/error, message? })`
- Error codes: 400=validation, 409=conflict/duplicate, 422=business logic, 500=server, 502=external service

### Database Patterns
- Alle queries via `supabase.schema('batchmaker').from('table')`
- Upsert met `onConflict` voor sync operaties
- Preserve local fields bij sync (kosten, engine config worden NIET overschreven door Picqer sync)
- Status progressie via enum-achtige strings

### Verpakkingsmodule Routing
Let op: de verpakkingsmodule gebruikt action-based routing in plaats van RESTful:
- `/api/verpakking/packagings/create` i.p.v. `POST /api/verpakking/packagings`
- `/api/verpakking/packagings/update` i.p.v. `PUT /api/verpakking/packagings/[id]`
- `/api/verpakking/packagings/delete` i.p.v. `DELETE /api/verpakking/packagings/[id]`

### Taal
- UI tekst: Nederlands
- Code, variabelen, comments: Engels
- Commit messages: Engels met conventional commits (feat:, fix:, refactor:)

---

## Veelvoorkomende Taken

### Nieuwe pagina toevoegen
1. Maak route in `src/app/(module)/module/pad/page.tsx`
2. Maak client component in `src/components/module/`
3. Server component laadt client component
4. Voeg navigatie toe in relevante layout

### Nieuw API endpoint
1. Maak `src/app/api/path/route.ts`
2. Voeg `export const dynamic = 'force-dynamic'` toe
3. Gebruik `NextResponse.json()` voor responses
4. Picqer calls via `src/lib/picqer/client.ts` functies
5. Supabase calls via `src/lib/supabase/` helper modules

### Nieuwe database tabel
1. Maak migratie via `mcp__supabase__apply_migration`
2. Voeg types toe aan `src/types/database.ts`
3. Maak helper module in `src/lib/supabase/`
4. Run `mcp__supabase__get_advisors` voor security check

### Nieuwe Picqer integratie
1. Voeg types toe aan `src/lib/picqer/types.ts`
2. Voeg API functie toe aan `src/lib/picqer/client.ts` (gebruik `rateLimitedFetch()`)
3. Maak proxy route in `src/app/api/picqer/`

### Nieuwe hook
1. Maak `src/hooks/useXxx.ts`
2. Patroon: `useState` + `useEffect` + `useCallback` met polling via `setInterval`
3. Return object met data, loading, error, en action functies

---

## Bekende Complexiteiten & Valkuilen

- **Picqer rate limits**: Max 500 req/min. Client heeft ingebouwde backoff maar bij bulk operaties (product sync) moet je batches van 5 gebruiken
- **Order caching**: Orders worden 30 seconden gecached. Bij real-time updates kan dit verwarrend zijn
- **Session locking**: Verpakkingsmodule gebruikt 30-min locks. Als een medewerker de browser sluit zonder af te ronden, moet de lock expiren
- **Picqer tags als object**: `order.tags` is een `Record<string, PicqerTag>` (niet een array!). Keys zijn string IDs
- **Supabase schema**: Altijd `.schema('batchmaker')` gebruiken, nooit `.from()` direct
- **Packaging field segregation**: Bij update van verpakkingen worden Picqer-velden (name, barcode, dimensions) apart gesynchroniseerd naar Picqer. Engine-velden (cost, weight, tag_name) blijven alleen lokaal
- **Composities**: Bundel-producten hebben een `type` dat 'composition' bevat. Parts moeten apart opgehaald worden via `getProductParts()`
- **Floriday sequence sync**: Lege resultaten betekenen niet "klaar". De sync loop springt naar `maximumSequenceNumber` en gaat door
- **Next.js 16 params**: Dynamic route params zijn nu `Promise<>` en moeten ge-await worden

## Supabase MCP

Gebruik de Supabase MCP tools voor database operaties:
- `mcp__supabase__execute_sql` — Queries uitvoeren
- `mcp__supabase__apply_migration` — Schema wijzigingen
- `mcp__supabase__list_tables` — Tabellen bekijken
- `mcp__supabase__get_advisors` — Security/performance checks na DDL changes
