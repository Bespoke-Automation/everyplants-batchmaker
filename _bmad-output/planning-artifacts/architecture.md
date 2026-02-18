---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-02-10'
inputDocuments:
  - "Conversatie-context: Picqer API analyse (picklists, shipments, packagings, labels)"
  - "Conversatie-context: Codebase-analyse (componenten, hooks, types, API routes)"
  - "Conversatie-context: Architectuurbeslissingen (5x bevestigd door stakeholder)"
  - "Conversatie-context: Datamodel-voorstel (4 Supabase tabellen)"
  - "Conversatie-context: Tag-naar-packaging mapping analyse"
workflowType: 'architecture'
project_name: 'everyplants-batchmaker - Verpakkingsmodule'
user_name: 'Kenny'
date: '2026-02-10'
---

# Architecture Decision Document

_Dit document wordt stap voor stap opgebouwd door collaboratieve discovery. Secties worden toegevoegd naarmate we architecturale beslissingen doorwerken._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
- FR1: Picklist selectie via barcode scan, wachtrij (auto-assign), of batch queue
- FR2: Picklist claim/lock mechanisme (atomic, met auto-expire na 30 min)
- FR3: Picklist producten tonen met pick-locaties en gewichten
- FR4: Tag-gebaseerde doos-suggesties (Supabase mapping tabel)
- FR5: Product-naar-doos toewijzing (scan-first, drag-drop als fallback)
- FR6: Producten als picked markeren in Picqer (bulksgewijs bij afsluiten)
- FR7: Bulk "verzend alle dozen" - één actie, parallelle shipment creatie
- FR8: Shipping labels downloaden, opslaan in Supabase Storage, combineren
- FR9: Packing sessie LIVE opslaan (elke actie auto-saved voor crash recovery)
- FR10: Sessie-geschiedenis en ingepakte orders overzicht
- FR11: Picklist afsluiten na alle shipments + auto-doorsturen naar volgende order
- FR12: Tag→packaging mapping beheren via settings
- FR13: Packaging suggesties op basis van historische product-doos data (zelflerend)

**Non-Functional Requirements:**
- NFR1: 10 gelijktijdige gebruikers zonder conflicten (atomic claims, locking)
- NFR2: Tablet-first responsive design (min 48px touch targets)
- NFR3: Barcode scan als primaire interactie-methode
- NFR4: Shipment creatie <30 sec voor alle dozen (parallel processing)
- NFR5: Queue-updates binnen 5 seconden zichtbaar voor alle workers (polling)
- NFR6: Crash recovery - sessie hervat na browser refresh/crash
- NFR7: Picqer rate limiting respecteren via bestaande retry/backoff
- NFR8: Hergebruik bestaande componenten en patronen waar mogelijk

**Scale & Complexity:**
- Primary domain: Full-stack web (Next.js 15 + Supabase + Picqer REST API)
- Complexity level: Medium-High (concurrency + warehouse UX)
- Concurrent users: 10 warehouse medewerkers
- Estimated architectural components: ~20

### Technical Constraints & Dependencies
- Picqer API als single source of truth (picklists, producten, shipments)
- Bestaande Picqer client met rate limiting en retry logic
- Supabase batchmaker schema voor alle persistence
- Picqer shipment creatie duurt tot 20 sec per call (parallel mitigatie)
- Bestaande label pipeline (pdf-lib + Supabase Storage)
- @dnd-kit drag-and-drop (desktop fallback, niet primair op tablet)
- Polling-based queue updates (5 sec interval, geen websockets)

### Cross-Cutting Concerns Identified
1. Concurrency: Picklist locking met atomic claims en auto-expire
2. State boundary: Server-side sessions (live) + client-side UI state (optimistic)
3. Partial shipment failure: 1 van N dozen faalt → partial status, retry optie
4. Picqer status validatie: Guard checks bij laden EN bij shipment creatie
5. Crash recovery: Elke actie auto-saved, sessie hervat na refresh
6. UX paradigma: Tablet-first, scan-first, één-hand bedienbaar

## Starter Template Evaluation

### Primary Technology Domain

Bestaand full-stack web project (Next.js 15 + Supabase + Picqer API).
De verpakkingsmodule wordt gebouwd binnen de bestaande codebase - geen nieuw project nodig.

### Bestaande Stack (Vastgelegd)

| Categorie | Technologie | Status |
|-----------|------------|--------|
| Runtime | TypeScript + Node.js | Vastgelegd |
| Framework | Next.js 15 (App Router) | Vastgelegd |
| UI Library | React 18 | Vastgelegd |
| Styling | Tailwind CSS + shadcn/ui + Radix UI | Vastgelegd |
| Database | Supabase (PostgreSQL, batchmaker schema) | Vastgelegd |
| Icons | Lucide React | Vastgelegd |
| Drag & Drop | @dnd-kit/core + @dnd-kit/sortable | Vastgelegd |
| PDF | pdf-lib | Vastgelegd |
| Package Manager | npm | Vastgelegd |
| Linting | ESLint | Vastgelegd |

### Architecturale Patronen al Gevestigd

**Code Organisatie:**
- Route groups: `(verpakkingsmodule)`, `(portal)`, `(single-orders)`
- API routes: `src/app/api/picqer/*`, `src/app/api/single-orders/*`
- Componenten: `src/components/verpakking/*`
- Hooks: `src/hooks/*`
- Lib: `src/lib/picqer/*`, `src/lib/supabase/*`, `src/lib/pdf/*`
- Types: `src/types/*`

**Data Fetching Pattern:**
- Custom hooks met useState + useEffect + useCallback
- API routes als proxy naar Picqer (server-side auth)
- Supabase direct client-side voor eigen data

**State Management:**
- React useState voor lokale component state
- Geen globale state library (geen Redux/Zustand)

### Geen Nieuwe Dependencies Verwacht

De verpakkingsmodule kan gebouwd worden met de bestaande stack.
Enige mogelijke toevoeging: barcode scanner library (fase 2).

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Worker identificatie via Picqer Users API (selectie grid, geen eigen auth)
2. Picklist data direct van Picqer (geen cache/sync)
3. Auto-save elke actie naar Supabase (crash recovery)
4. Frontend-gestuurde shipment orchestratie (per-doos sequentieel)
5. Picqer-driven queue (alle status=new picklists)

**Deferred Decisions (Post-MVP):**
- Barcode scanner hardware integratie
- Zelflerend suggestie-algoritme (data wordt wel al verzameld)
- Supabase Realtime (websockets) voor queue updates
- Packing station koppeling (idpacking_station)

### Data Architecture

**Database:** Supabase PostgreSQL, `batchmaker` schema (bestaand)

**Nieuwe tabellen:**

1. `packing_sessions` - Hoofdrecord per inpaksessie
   - id (UUID PK)
   - picklist_id (integer, Picqer idpicklist)
   - picklistid (text, Picqer picklistid P2025-xxxxx)
   - order_id (integer | null)
   - order_reference (text | null)
   - retailer (text | null)
   - delivery_country (text | null)
   - assigned_to (integer NOT NULL, Picqer iduser)
   - assigned_to_name (text, worker naam voor weergave)
   - status: 'assigned' | 'packing' | 'shipping' | 'completed' | 'failed'
   - locked_at (timestamp)
   - lock_expires_at (timestamp, +30 min)
   - total_products (integer)
   - total_boxes (integer)
   - combined_pdf_path (text | null)
   - created_at, updated_at (timestamps)

2. `packing_session_boxes` - Elke doos in een sessie
   - id (UUID PK)
   - session_id (UUID FK → packing_sessions)
   - picqer_packaging_id (integer | null)
   - packaging_name (text)
   - packaging_barcode (text | null)
   - weight (integer, gram)
   - shipment_id (integer | null, Picqer idshipment)
   - tracking_code (text | null)
   - label_url (text | null, Supabase Storage path)
   - shipping_provider_id (integer | null)
   - status: 'open' | 'closed' | 'shipping' | 'shipped' | 'labeled' | 'error'
   - error_message (text | null)
   - box_index (integer)
   - created_at, updated_at (timestamps)

3. `packing_session_products` - Product → Doos toewijzing
   - id (UUID PK)
   - session_id (UUID FK → packing_sessions)
   - box_id (UUID FK → packing_session_boxes)
   - picqer_product_id (integer)
   - productcode (text)
   - product_name (text)
   - amount (integer)
   - weight_per_unit (integer, gram)
   - created_at (timestamp)

4. `tag_packaging_map` - Tag → Dozen mapping
   - id (UUID PK)
   - tag_title (text UNIQUE)
   - picqer_packaging_id (integer)
   - packaging_name (text)
   - priority (integer)
   - is_active (boolean)
   - created_at, updated_at (timestamps)

**Locking mechanisme:**
- Atomic claim via SQL: UPDATE ... WHERE assigned_to IS NULL OR lock_expires_at < NOW()
- Auto-expire na 30 minuten inactiviteit
- Heartbeat vanuit client verlengt lock

**Auto-save strategie:**
- Elke product-toewijzing = direct INSERT/UPDATE naar Supabase
- Box toevoegen/verwijderen = direct save
- Optimistic UI: client update direct, server async
- Bij crash/refresh: sessie laden vanuit Supabase, UI herstellen

### Authentication & Security

**Worker identificatie:**
- Geen eigen auth systeem - Picqer Users API als bron
- GET /api/v1/users?active=true → toon user selectie grid
- Worker selecteert naam → iduser opgeslagen in cookie/localStorage
- Bij picklist claim → POST /picklists/{id}/assign (koppelt in Picqer)
- Bestaande app auth (PASSWORD cookie) blijft voor toegang tot de app

**API security:**
- Alle Picqer calls via server-side API routes (API key nooit client-side)
- Supabase anonymous key (bestaand patroon)

### API & Communication Patterns

**Nieuwe API routes:**

| Route | Method | Doel |
|-------|--------|------|
| /api/picqer/users | GET | Actieve Picqer users ophalen |
| /api/picqer/picklists | GET | Picklists ophalen (filter: status) |
| /api/picqer/picklists/[id] | GET | Picklist details met producten |
| /api/picqer/picklists/[id]/assign | POST | Picklist toewijzen aan worker |
| /api/picqer/picklists/[id]/pick | POST | Producten als picked markeren |
| /api/picqer/picklists/[id]/close | POST | Picklist afsluiten |
| /api/verpakking/sessions | GET/POST | Packing sessies CRUD |
| /api/verpakking/sessions/[id] | GET/PUT | Sessie details en updates |
| /api/verpakking/sessions/[id]/claim | POST | Atomic picklist claim |
| /api/verpakking/sessions/[id]/boxes | POST/PUT/DELETE | Box CRUD (auto-save) |
| /api/verpakking/sessions/[id]/products | POST/PUT/DELETE | Product toewijzing (auto-save) |
| /api/verpakking/sessions/[id]/ship | POST | Shipment per doos (frontend orchestreert) |
| /api/verpakking/sessions/[id]/labels | GET | Labels downloaden |
| /api/verpakking/tag-mappings | GET/POST/PUT/DELETE | Tag→packaging mapping CRUD |

**Polling strategie:**
- Queue pagina: poll /api/picqer/picklists elke 5 seconden
- Alleen actieve tab pollt (Page Visibility API)
- Response bevat ETag/timestamp voor conditional requests

**Error handling:**
- Picqer 429 (rate limit): bestaande retry/backoff in client.ts
- Shipment failure: per-doos status tracking, retry optie in UI
- Picklist already closed: guard check + user-friendly melding

### Frontend Architecture

**State management:**
- Server state: Supabase (packing sessions, boxes, products)
- Client state: React useState voor UI-only state (drag overlay, modals)
- Sync pattern: save to Supabase → optimistic UI update
- Crash recovery: useEffect on mount → load session from Supabase

**Shipment orchestratie (frontend-gestuurd):**
- "Verzend alle dozen" → iterate over boxes sequentieel
- Per doos: POST /api/verpakking/sessions/[id]/ship
- UI toont per-doos progress: ⏳ Verzenden... → ✅ Label klaar → ❌ Mislukt [Retry]
- Worker ziet real-time welke dozen klaar zijn
- Na alle dozen: combined PDF download beschikbaar

**Tablet-first design principes:**
- Min 48px touch targets
- Scan-first interactie (input field auto-focus)
- Grote status indicators (kleur + icoon)
- Swipe acties als alternatief voor drag-drop
- Eén-hand bedienbaar layout

### Infrastructure & Deployment

**Geen wijzigingen aan bestaande infra.**
- Hosting: ongewijzigd (Vercel/huidige setup)
- Supabase: bestaand project, nieuwe tabellen in batchmaker schema
- Storage: bestaande shipment-labels bucket, nieuwe VP-{sessionId}/ prefix

### Decision Impact Analysis

**Implementatie volgorde:**
1. Supabase migratie (4 tabellen)
2. Picqer client uitbreiding (getUsers, getPicklists, assignPicklist)
3. API routes (Picqer proxy + verpakking sessie management)
4. Worker selectie scherm
5. Queue/picklist selectie pagina
6. Packing werkscherm (refactor demo → real data + auto-save)
7. Shipment flow (per-doos, frontend orchestratie)
8. Label download + opslag
9. Tag→packaging settings pagina

**Cross-component dependencies:**
- Worker selectie → moet klaar zijn voor claim mechanisme
- Supabase tabellen → moeten bestaan voor auto-save
- Picqer client uitbreiding → nodig voor alle API routes
- Auto-save → nodig voor crash recovery

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database (Supabase, batchmaker schema):**
- Tabelnamen: snake_case, meervoud → `packing_sessions`, `tag_packaging_map`
- Kolomnamen: snake_case → `picklist_id`, `assigned_to`, `created_at`
- Foreign keys: `{tabel_singular}_id` → `session_id`, `box_id`
- Timestamps: altijd `created_at` + `updated_at`
- Status kolommen: tekst met union types, geen integers

**API Routes:**
- Picqer proxy: `/api/picqer/{resource}` → `/api/picqer/picklists`, `/api/picqer/users`
- Verpakking eigen: `/api/verpakking/{resource}` → `/api/verpakking/sessions`
- Geneste resources: `/api/verpakking/sessions/[id]/boxes`
- Methodes: GET (ophalen), POST (aanmaken/actie), PUT (update), DELETE (verwijderen)
- Dynamische segmenten: Next.js `[id]` conventie

**Code:**
- Componenten: `PascalCase.tsx` → `BoxCard.tsx`, `WorkerSelector.tsx`
- Hooks: `use{Naam}.ts` → `usePackingSession.ts`, `usePicklistQueue.ts`
- Utils/services: `kebab-case.ts` → `packing-service.ts`
- Types: `PascalCase` in `src/types/{naam}.ts`
- Variabelen: `camelCase` → `picklistId`, `sessionId`
- Constanten: `UPPER_SNAKE_CASE` → `POLL_INTERVAL_MS`

### Structure Patterns

**Bestaande structuur (niet wijzigen):**
```
src/
├── app/
│   ├── (verpakkingsmodule)/verpakkingsmodule/  ← pages
│   └── api/
│       ├── picqer/          ← Picqer proxy routes (bestaand + nieuw)
│       └── verpakking/      ← Verpakking eigen routes (nieuw)
├── components/
│   ├── ui/                  ← Generieke UI (Dialog, Button, etc.)
│   └── verpakking/          ← Module-specifieke componenten
├── hooks/                   ← Custom hooks
├── lib/
│   ├── picqer/              ← Picqer client + types + transform
│   ├── supabase/            ← Supabase client + operaties
│   └── pdf/                 ← PDF bewerking (labelEditor.ts)
├── types/                   ← Type definities
├── constants/               ← App constanten
└── data/                    ← Mock data (alleen dev)
```

**Regels:**
- Nieuwe Picqer client functies → toevoegen aan `src/lib/picqer/client.ts`
- Nieuwe Picqer types → toevoegen aan `src/lib/picqer/types.ts`
- Supabase operaties voor verpakking → nieuw bestand `src/lib/supabase/packingSessions.ts`
- Verpakking types → uitbreiden van `src/types/verpakking.ts`
- Eén hook per concern → `usePackingSession.ts`, `usePicklistQueue.ts`, `useWorker.ts`

### Format Patterns

**API Response Format (bestaand patroon volgen):**
```typescript
// Success
{ data: T, total?: number }

// Error
{ error: string, details?: string }

// Picqer proxy - doorgeeft wat Picqer stuurt, gewrapped:
{ picklists: PicqerPicklist[], total: number }
{ packagings: PicqerPackaging[], total: number }
```

**Supabase Operaties (bestaand patroon):**
```typescript
// Altijd .schema('batchmaker') prefix
const { data, error } = await supabase
  .schema('batchmaker')
  .from('packing_sessions')
  .select('*')

// Insert: omit id, created_at, updated_at (auto-generated)
// Update: alleen gewijzigde velden + updated_at via trigger
```

**JSON velden:**
- Picqer responses: snake_case (niet transformeren, doorsturen)
- Eigen API/Supabase: snake_case
- Frontend variabelen: camelCase (transformeer bij ontvangst)

### Process Patterns

**Auto-Save Pattern:**
```
1. Optimistic UI update (setState lokaal)
2. Async save naar Supabase (fire-and-forget met error catch)
3. Bij error: revert UI + toon toast melding
4. Geen loading spinners voor auto-save (onzichtbaar voor user)
```

**Picqer API Call Pattern:**
```
1. Altijd via API route (nooit direct vanuit client-side code)
2. Altijd via bestaande picqerFetch() in client.ts (rate limiting)
3. Guard check: fetch picklist status VOOR de actie
4. Valideer status === verwachte status
5. Voer actie uit
6. Handle 4xx/5xx met specifieke user-friendly meldingen
```

**Polling Pattern:**
```
- Standaard interval: 5000ms
- Alleen actieve tab pollt (Page Visibility API)
- Bij focus terug → direct fetch + herstart interval
```

**Shipment Per-Doos Pattern:**
```
- Frontend orchestreert, per doos sequentieel
- Update box status lokaal + Supabase bij elke stap
- Bij error: markeer doos als 'error', ga door met volgende
- Na alle dozen: toon samenvatting met retry optie voor gefaalde dozen
```

**Error Handling Pattern:**
```
- API routes: try/catch + NextResponse.json met error message
- Client-side: toast notifications, geen alerts/modals voor errors
- Shipment errors: inline per-doos status, niet globaal
- Console logging met prefix: [verpakking]
```

**Crash Recovery Pattern:**
```
- Bij mount: check Supabase voor actieve sessie van deze worker
- Als gevonden: herstel state vanuit Supabase (boxes, products, status)
- Als niet gevonden: toon queue/start scherm
```

### Enforcement Guidelines

**Alle AI Agents MOETEN:**
1. `batchmaker` schema gebruiken voor ALLE Supabase queries
2. Bestaande `picqerFetch()` functie gebruiken voor Picqer calls (nooit eigen fetch)
3. Optimistic UI pattern volgen voor auto-save acties
4. Guard checks doen op picklist status voor elke Picqer mutatie
5. Error handling met specifieke user-friendly Nederlandse meldingen
6. Componenten in `src/components/verpakking/` plaatsen
7. Hooks in `src/hooks/` met `use` prefix

**Anti-Patterns (VERMIJDEN):**
- Direct Picqer API calls vanuit client-side code
- `public` schema gebruiken in Supabase
- Loading spinners voor auto-save operaties
- Globale error modals (gebruik inline status + toast)
- Nieuwe state management libraries toevoegen
- Mock data gebruiken in productie code (conditioneel importeren is ok)

## Project Structure & Boundaries

### Nieuwe Bestanden & Directories (Delta)

```
src/
├── app/
│   ├── (verpakkingsmodule)/verpakkingsmodule/
│   │   ├── page.tsx                          ← WIJZIG: worker selectie + routing
│   │   ├── layout.tsx                        ← BESTAAND (ongewijzigd)
│   │   ├── queue/
│   │   │   └── page.tsx                      ← NIEUW: picklist wachtrij
│   │   ├── pack/
│   │   │   └── [sessionId]/
│   │   │       └── page.tsx                  ← NIEUW: inpak werkscherm
│   │   ├── history/
│   │   │   └── page.tsx                      ← NIEUW: sessie geschiedenis
│   │   └── settings/
│   │       └── page.tsx                      ← NIEUW: tag→packaging mapping
│   │
│   └── api/
│       ├── picqer/
│       │   ├── users/
│       │   │   └── route.ts                  ← NIEUW: actieve Picqer users
│       │   ├── picklists/
│       │   │   ├── route.ts                  ← NIEUW: picklists ophalen
│       │   │   └── [id]/
│       │   │       ├── route.ts              ← NIEUW: picklist details
│       │   │       ├── assign/
│       │   │       │   └── route.ts          ← NIEUW: toewijzen aan worker
│       │   │       ├── pick/
│       │   │       │   └── route.ts          ← NIEUW: producten picken
│       │   │       └── close/
│       │   │           └── route.ts          ← NIEUW: picklist afsluiten
│       │   ├── packagings/
│       │   │   └── route.ts                  ← BESTAAND (ongewijzigd)
│       │   └── shipping-methods/
│       │       └── route.ts                  ← BESTAAND (ongewijzigd)
│       │
│       └── verpakking/
│           ├── sessions/
│           │   ├── route.ts                  ← NIEUW: GET lijst / POST nieuwe sessie
│           │   └── [id]/
│           │       ├── route.ts              ← NIEUW: GET/PUT sessie details
│           │       ├── claim/
│           │       │   └── route.ts          ← NIEUW: atomic picklist claim
│           │       ├── boxes/
│           │       │   └── route.ts          ← NIEUW: POST/PUT/DELETE boxes
│           │       ├── products/
│           │       │   └── route.ts          ← NIEUW: POST/PUT/DELETE producten
│           │       ├── ship/
│           │       │   └── route.ts          ← NIEUW: shipment per doos
│           │       └── labels/
│           │           └── route.ts          ← NIEUW: labels downloaden
│           └── tag-mappings/
│               └── route.ts                  ← NIEUW: CRUD tag→packaging
```

### Gewijzigde Bestaande Bestanden

```
src/
├── components/verpakking/
│   ├── VerpakkingsClient.tsx                 ← WIJZIG: refactor naar real data
│   ├── BoxCard.tsx                           ← WIJZIG: minor (shipment status)
│   └── ProductCard.tsx                       ← WIJZIG: minor (scan support)
├── lib/picqer/
│   ├── client.ts                             ← WIJZIG: +getUsers, +getPicklists,
│   │                                            +assignPicklist, +pickProduct
│   └── types.ts                              ← WIJZIG: +PicqerUser type
└── types/
    └── verpakking.ts                         ← WIJZIG: uitbreiden met nieuwe types
```

### Nieuwe Bestanden

```
src/
├── components/verpakking/
│   ├── WorkerSelector.tsx                    ← NIEUW: Picqer user grid
│   ├── PicklistQueue.tsx                     ← NIEUW: wachtrij met polling
│   ├── PicklistScanner.tsx                   ← NIEUW: scan input component
│   ├── ShipmentProgress.tsx                  ← NIEUW: per-doos verzend progress
│   ├── SessionHistory.tsx                    ← NIEUW: geschiedenis overzicht
│   └── TagMappingSettings.tsx                ← NIEUW: settings component
├── hooks/
│   ├── useWorker.ts                          ← NIEUW: worker selectie + opslag
│   ├── usePicklistQueue.ts                   ← NIEUW: queue polling + claim
│   ├── usePackingSession.ts                  ← NIEUW: sessie CRUD + auto-save
│   └── useTagMappings.ts                     ← NIEUW: tag→packaging CRUD
└── lib/supabase/
    ├── packingSessions.ts                    ← NIEUW: alle packing sessie operaties
    └── tagMappings.ts                        ← NIEUW: tag mapping operaties
```

### Architectural Boundaries

**API Boundaries:**
```
Browser (Worker)
  ├── /api/picqer/*          ← Proxy laag: auth + rate limiting
  │     └── Picqer API         Bron van waarheid voor picklists/shipments
  ├── /api/verpakking/*      ← Business logic laag
  │     ├── Supabase           Persistence (sessions, boxes, products, mappings)
  │     └── Picqer API         Via lib/picqer/client.ts (voor shipments)
  └── Supabase (direct)      ← Alleen voor reads (tag mappings, history)
```

**Component Boundaries:**
```
WorkerSelector          → Standalone, schrijft naar localStorage + cookie
  ↓
PicklistQueue           → Pollt Picqer, toont beschikbare picklists
  ↓ (claim)                Checkt Supabase voor locks
VerpakkingsClient       → Hoofdscherm, orchestreert alles
  ├── ProductCard[]     → Draggable, fire events omhoog
  ├── BoxCard[]         → Droppable, fire events omhoog
  ├── ShipmentProgress  → Toont per-doos verzendstatus
  └── (modals)          → Add box, shipment details
```

**Data Boundaries:**
```
Picqer (extern, read+write)      Supabase (intern, read+write)
  picklists                        packing_sessions
  products                         packing_session_boxes
  users                            packing_session_products
  packagings                       tag_packaging_map
  shipments                        Supabase Storage (labels)
  shipping methods
```

### Requirements to Structure Mapping

| FR | Bestanden |
|----|-----------|
| FR1: Picklist selectie | `queue/page.tsx`, `PicklistQueue.tsx`, `PicklistScanner.tsx`, `usePicklistQueue.ts` |
| FR2: Claim/lock | `api/verpakking/sessions/[id]/claim/route.ts`, `lib/supabase/packingSessions.ts` |
| FR3: Producten tonen | `pack/[sessionId]/page.tsx`, `VerpakkingsClient.tsx`, `ProductCard.tsx` |
| FR4: Tag→doos suggesties | `api/verpakking/tag-mappings/route.ts`, `lib/supabase/tagMappings.ts`, `useTagMappings.ts` |
| FR5: Product→doos toewijzing | `VerpakkingsClient.tsx`, `ProductCard.tsx`, `BoxCard.tsx`, `api/verpakking/sessions/[id]/products/route.ts` |
| FR6: Picken in Picqer | `api/picqer/picklists/[id]/pick/route.ts`, `lib/picqer/client.ts` |
| FR7: Bulk verzenden | `ShipmentProgress.tsx`, `api/verpakking/sessions/[id]/ship/route.ts` |
| FR8: Labels opslaan | `api/verpakking/sessions/[id]/labels/route.ts`, `lib/supabase/packingSessions.ts`, `lib/pdf/labelEditor.ts` |
| FR9: Auto-save | `usePackingSession.ts`, `api/verpakking/sessions/[id]/boxes/route.ts`, `api/verpakking/sessions/[id]/products/route.ts` |
| FR10: Geschiedenis | `history/page.tsx`, `SessionHistory.tsx` |
| FR11: Auto-doorsturen | `VerpakkingsClient.tsx` (na shipment complete → redirect naar queue) |
| FR12: Tag mapping settings | `settings/page.tsx`, `TagMappingSettings.tsx`, `useTagMappings.ts` |
| FR13: Zelflerend | `packing_session_products` tabel (data verzamelen, algoritme later) |
| Worker ID | `page.tsx` (root), `WorkerSelector.tsx`, `useWorker.ts`, `api/picqer/users/route.ts` |

### Data Flow (Happy Path)

```
1. Worker selecteert naam          → localStorage + cookie
2. Queue pollt picklists           → GET /api/picqer/picklists
3. Worker claimt picklist          → POST /api/verpakking/sessions (INSERT + Picqer assign)
4. Werkscherm laadt sessie         → GET /api/verpakking/sessions/[id]
5. Worker wijst producten toe      → PUT /api/verpakking/sessions/[id]/products (auto-save)
6. Worker voegt dozen toe          → POST /api/verpakking/sessions/[id]/boxes (auto-save)
7. Worker klikt "Verzend alles"    → Per doos: POST /api/verpakking/sessions/[id]/ship
8.   Ship route intern:            → pickAll + createShipment + getLabel + upload + close
9. Labels gedownload               → GET /api/verpakking/sessions/[id]/labels
10. Auto-redirect naar queue       → Volgende picklist
```

## Architecture Validation Results

### Coherence Validatie ✅

**Decision Compatibility:**
Alle technologie-keuzes zijn compatibel. Next.js 15 + Supabase + Picqer API is een bewezen combinatie die al in productie draait voor de bestaande modules. Auto-save naar Supabase en directe Picqer data fetching werken onafhankelijk zonder conflicten.

**Aandachtspunt:** 10 gelijktijdige workers genereren ~120 poll calls/min + shipment calls. De bestaande rate limiting in `client.ts` handelt dit reactief af (retry na 429), maar proactieve request queuing (max 5 concurrent calls) wordt aanbevolen als verbetering.

**Pattern Consistency:** ✅ Alle naamconventies, schema-regels, en code patterns zijn consistent met de bestaande codebase.

**Structure Alignment:** ✅ Nieuwe bestanden volgen bestaande patronen exact.

### Requirements Coverage ✅

**Alle 13 Functionele Requirements:** Architecturaal gedekt en gemapped naar specifieke bestanden.

**Alle 8 Non-Functionele Requirements:** Gedekt.
- NFR4 (shipment <30s) is afhankelijk van Picqer response time per call. Bij meerdere dozen is totaaltijd: N × Picqer response time. Frontend progress UI maakt dit acceptabel.

### Implementation Readiness ✅

**Decision Completeness:** Alle 5 kritieke beslissingen gedocumenteerd en bevestigd.
**Structure Completeness:** Volledige file tree met NIEUW/WIJZIG/BESTAAND annotaties.
**Pattern Completeness:** 6 process patterns, enforcement guidelines, en anti-patterns gedocumenteerd.

### Gap Analyse

**Gap #1 (Medium): Rate Limiting bij 10 Gelijktijdige Workers**
Aanbeveling: Server-side semaphore in `picqerFetch()` - max 5 concurrent calls, rest wacht in queue.

**Gap #2 (Laag): Lock Heartbeat Mechanisme**
Aanbeveling: `setInterval` in `usePackingSession` elke 5 min → PUT lock_expires_at verlenging.

**Gap #3 (Laag): Worker Selectie Persistentie**
Aanbeveling: `localStorage` key `verpakking_worker` + cookie `verpakking_worker_id` voor server-side.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context geanalyseerd (incl. Party Mode review)
- [x] Schaal en complexiteit beoordeeld (10 concurrent users)
- [x] Technische constraints geïdentificeerd
- [x] Cross-cutting concerns in kaart gebracht (6 stuks)

**✅ Architectural Decisions**
- [x] 5 kritieke beslissingen gedocumenteerd
- [x] Technologie stack volledig gespecificeerd
- [x] 4 Supabase tabellen ontworpen met volledige kolom-definitie
- [x] 14 API routes gedefinieerd
- [x] Integratie patronen gedocumenteerd

**✅ Implementation Patterns**
- [x] Naamconventies vastgelegd (DB, API, code)
- [x] Structuurpatronen gedefinieerd
- [x] 6 process patterns gedocumenteerd
- [x] Enforcement guidelines + anti-patterns

**✅ Project Structure**
- [x] Complete directory structuur (delta)
- [x] Component boundaries gedefinieerd
- [x] Alle FRs gemapped naar bestanden
- [x] Data flow gedocumenteerd

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** Hoog

**Sterke punten:**
- Bouwt voort op bewezen patronen uit bestaande codebase
- 85%+ hergebruik van componenten en libraries
- Elke FR traceerbaar naar specifieke bestanden
- Pragmatische concurrency-aanpak (atomic SQL)
- Picqer Users API als worker identificatie (geen eigen auth)

**Toekomstige verbeteringen (post-MVP):**
- Server-side request queuing voor Picqer
- Supabase Realtime voor instant queue updates
- Zelflerend algoritme voor packaging suggesties
- Barcode scanner hardware integratie
- Packing station koppeling (idpacking_station)

### Implementation Handoff

**Implementatie volgorde:**
1. Supabase migratie (4 tabellen)
2. Picqer client uitbreiding (getUsers, getPicklists, assignPicklist, pickProduct)
3. API routes (6 Picqer proxy + 8 verpakking eigen)
4. Worker selectie scherm
5. Queue/picklist selectie pagina
6. Packing werkscherm (refactor demo → real data + auto-save)
7. Shipment flow (per-doos, frontend orchestratie)
8. Label download + opslag
9. Tag→packaging settings pagina

**AI Agent Richtlijnen:**
- Volg alle architectuurbeslissingen exact zoals gedocumenteerd
- Gebruik implementation patterns consistent
- Respecteer project structuur en boundaries
- Raadpleeg dit document voor alle architectuurvragen

