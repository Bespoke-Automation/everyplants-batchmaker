# Floriday ↔ Picqer Integratie

**Status:** In ontwikkeling — Fase 1 (Orders)
**Datum:** 2026-02-18
**Locatie:** Binnen bestaand everyplants-batchmaker Next.js project
**Database:** Supabase `floriday` schema

---

## 1. Projectoverzicht

Koppeling tussen Floriday (B2B sierteelt handelsplatform) en Picqer (warehouse management) voor Everyplants BV. Everyplants is **supplier** op Floriday — kopers plaatsen orders die wij verwerken in Picqer.

Vervangt de bestaande Duxly-koppeling die niet wordt overgedragen.

| # | Stroom | Richting | Prioriteit |
|---|--------|----------|------------|
| 1 | **Orders** | Floriday → Picqer | Hoog (Fase 1) |
| 2 | **Voorraad** | Picqer → Floriday | Hoog (Fase 2) |
| 3 | **Content/Foto's** | Extern → Floriday | Laag (Fase 3) |

---

## 2. Architectuurbeslissingen

### Kernprincipe: 1 SalesOrder = 1 Picqer Order

Geen groepering van orders. Elke Floriday SalesOrder wordt exact 1 Picqer order.

### Runtime: Next.js API Routes (binnen batchmaker)

```
src/
├── app/
│   ├── (floriday)/floriday/              ← Dashboard/logging UI
│   └── api/floriday/
│       ├── webhooks/route.ts             ← Floriday webhook ontvanger (primair)
│       ├── sync/orders/route.ts          ← Polling fallback / handmatige trigger
│       └── orders/route.ts              ← Dashboard data endpoint
├── lib/floriday/
│   ├── auth.ts                           ← OAuth2 Client Credentials (bestaand)
│   ├── client.ts                         ← Floriday API client (bestaand)
│   ├── types.ts                          ← Type definitions (bestaand, uitbreiden)
│   ├── sync/
│   │   └── order-sync.ts               ← Sales order + fulfillment sync
│   └── mappers/
│       ├── order-mapper.ts              ← Floriday → Picqer order transformatie
│       ├── customer-resolver.ts         ← Floriday org → Picqer klant
│       └── product-resolver.ts          ← supplierArticleCode → Picqer product
```

### Database: Supabase `floriday` schema

| Tabel | Doel |
|-------|------|
| `sync_state` | Sequence numbers per resource bijhouden |
| `order_mapping` | Floriday salesOrderId ↔ Picqer orderId + verwerkingsstatus |
| `customer_mapping` | Floriday organizationId ↔ Picqer customerId |
| `product_mapping` | supplierArticleCode ↔ Picqer idproduct (cache) |
| `warehouse_cache` | GLN → adres lookup (van Floriday warehouses endpoint) |
| `sync_log` | Audit trail van alle sync operaties |

### Sync mechanisme: Webhooks + Polling fallback

**Primair:** Floriday webhooks voor sales order events → directe verwerking
**Fallback:** Sequence-based polling via handmatige trigger of cron

We schrijven NIET terug naar Floriday (geen commit, geen status updates). Alleen lezen.

---

## 3. Definitieve Data Mapping

### Floriday SalesOrder → Picqer Order

| Bron | Veld | → Picqer | Transformatie |
|------|------|----------|---------------|
| — | — | `idtemplate` | Hardcode **9102** |
| SalesOrder | `customerOrganizationId` → org lookup → name | `idcustomer` | Zoek op naam, maak aan als nieuw |
| FulfillmentOrder | `loadCarriers[].loadCarrierItems[].deliveryNoteCode + deliveryNoteLetter` | `reference` | Kommagescheiden (bijv. "F2AC98A, F2AC99A") |
| SalesOrder | `delivery.latestDeliveryDateTime` | `preferred_delivery_date` | Neem datum deel (YYYY-MM-DD) |
| SalesOrder | `delivery.location.gln` → warehouse lookup | `deliveryname` | Warehouse naam |
| SalesOrder | `delivery.location.gln` → warehouse lookup | `deliveryaddress` | Warehouse adres |
| SalesOrder | `delivery.location.gln` → warehouse lookup | `deliveryzipcode` | Warehouse postcode |
| SalesOrder | `delivery.location.gln` → warehouse lookup | `deliverycity` | Warehouse stad |
| SalesOrder | `delivery.location.gln` → warehouse lookup | `deliverycountry` | Warehouse land (al 2-letter ISO) |
| — | — | `language` | Hardcode "nl" |
| SalesOrder | `deliveryRemarks` | `customer_remarks` | Direct (kan null zijn) |

### Productregels

| Bron | Veld | → Picqer | Transformatie |
|------|------|----------|---------------|
| SalesOrder | `tradeItemId` → trade item → `supplierArticleCode` | `products[0].idproduct` | Zoek op Picqer field **4875** (Alternatieve SKU) |
| SalesOrder | `numberOfPieces` | `products[0].amount` | Direct |
| — | — | `products[0].price` | Hardcode **0** |
| SalesOrder | `packingConfiguration.loadCarrier` | `products[1].idproduct` | DANISH_TROLLEY → **38535312**, AUCTION_TROLLEY → **38535557** |
| FulfillmentOrder | `loadCarriers[].length` | `products[1].amount` | Aantal load carriers |
| — | — | `products[1].price` | Hardcode **0** |

### Tags

Na order aanmaken: `addOrderTag(orderId, "Floriday" tag ID)`

### Load Carrier Mapping

| Floriday `packingConfiguration.loadCarrier` | Picqer productcode | Picqer idproduct | Naam |
|---|---|---|---|
| `DANISH_TROLLEY` | 100000012 | 38535312 | Deense kar - Danish trolley |
| `AUCTION_TROLLEY` | 100000013 | 38535557 | Veiling kar - Auction trolley |
| Anders / onbekend | — | — | Geen kar-product toevoegen |

### Product Matching

```
Floriday: tradeItem.supplierArticleCode (bijv. "13630")
    ↓
Picqer: productfield 4875 "Alternatieve SKU" (bijv. "13630")
    ↓
Match → idproduct (bijv. 46275607 voor Ficus Benjamina 180cm)
```

Bewezen matches uit staging:
- `13630` → Picqer 333016328 (kunstplant Ficus Benjamina 180cm)
- `14005` → Picqer 333016323 (kunstplant Bamboe 180cm)

### Klant Matching

```
Floriday: salesOrder.customerOrganizationId
    ↓
Floriday API: GET /organizations/{id} → org.name
    ↓
Picqer: GET /customers?search={name} → eerste match
    ↓
Niet gevonden → POST /customers (naam + adres uit org)
```

### Afleveradres Resolutie

```
SalesOrder: delivery.location.gln (bijv. "8713783461099")
    ↓
Warehouse cache: GLN → adres lookup
    ↓
Match: "KLOK FLORAHOLLAND AALSMEER", Legmeerdijk 313, 1431 GB Aalsmeer, NL
```

Warehouses worden gecached bij opstarten via `GET /warehouses`.

---

## 4. Floriday Data Model

### Entity hiërarchie (relevant voor orders)

```
SalesOrder (bestelling)
  ├── tradeItemId → TradeItem → supplierArticleCode
  ├── customerOrganizationId → Organization → name, address
  ├── delivery.location.gln → Warehouse → adres
  ├── packingConfiguration.loadCarrier → kar type
  └── FulfillmentOrder (logistiek)
       └── loadCarriers[] (Deense/Veiling karren)
            └── loadCarrierItems[] (per kar)
                 ├── salesOrderId (koppeling terug)
                 ├── deliveryNoteCode + deliveryNoteLetter → referentie
                 └── numberOfPackages
```

### Sales Order velden (getest)

| Veld | Voorbeeld | Gebruik |
|------|-----------|--------|
| `salesOrderId` | UUID | Unieke identifier, opslaan in order_mapping |
| `salesChannelOrderId` | "9900000545084" | Floriday-referentie (niet voor Picqer) |
| `tradeItemId` | UUID → trade item lookup | Product matching |
| `customerOrganizationId` | UUID → org lookup | Klant matching |
| `numberOfPieces` | 100 | Aantal stuks |
| `salesChannel` | FLORIDAY_FX / RFH_CLOCK | Informatief |
| `tradeInstrument` | DIRECT_SALES / CLOCK_SALES / CLOCK_PRESALES | Informatief |
| `packingConfiguration.loadCarrier` | DANISH_TROLLEY / AUCTION_TROLLEY | Kar-type |
| `delivery.latestDeliveryDateTime` | "2026-02-19T12:00:00Z" | Leverdatum |
| `delivery.location.gln` | "8713783461099" | Afleverlocatie |
| `delivery.incoterm` | "DDP" | Informatief |
| `deliveryRemarks` | "eerste koop" | Opmerkingen |
| `batchReference` | 9110008028092 | Informatief |
| `status` | COMMITTED | Filterveld |
| `sequenceNumber` | 220473064 | Sync tracking |

---

## 5. API Authenticatie (Getest & Werkend)

### Floriday (Staging)

```
Token URL:  https://idm.staging.floriday.io/oauth2/ausmw6b47z1BnlHkw0h7/v1/token
Base URL:   https://api.staging.floriday.io/suppliers-api-2025v2
Auth:       OAuth2 Client Credentials + X-Api-Key header
Scopes:     role:app catalog:read/write supply:read/write
            sales-order:read/write fulfillment:read/write
Token TTL:  3600s
```

### Picqer

```
Base URL:   https://{subdomain}.picqer.com/api/v1
Auth:       HTTP Basic (API key als username, leeg wachtwoord)
Rate limit: 500 req/min
User-Agent: Verplicht
```

---

## 6. Bouwvolgorde (Fase 1 — Orders)

### Stap 1 — Database tabellen
- [ ] `floriday.sync_state` — sequence tracking per resource
- [ ] `floriday.order_mapping` — salesOrderId ↔ Picqer order
- [ ] `floriday.customer_mapping` — orgId ↔ Picqer customer
- [ ] `floriday.product_mapping` — articleCode ↔ Picqer product (cache)
- [ ] `floriday.warehouse_cache` — GLN ↔ adres
- [ ] `floriday.sync_log` — audit trail

### Stap 2 — Picqer client uitbreiden
- [ ] `createOrder()` — POST /orders
- [ ] `processOrder()` — POST /orders/{id}/process
- [ ] `searchCustomers()` — GET /customers?search=
- [ ] `createCustomer()` — POST /customers
- [ ] `searchProductByField()` — zoek op custom field (Alternatieve SKU)

### Stap 3 — Floriday client uitbreiden
- [ ] `syncFulfillmentOrders()` — fulfillment orders ophalen
- [ ] `getWarehouses()` — warehouse listing voor GLN cache
- [ ] FulfillmentOrder type toevoegen aan types.ts

### Stap 4 — Mapping services
- [ ] `product-resolver.ts` — supplierArticleCode → Picqer idproduct
- [ ] `customer-resolver.ts` — org name → Picqer klant (zoek/maak aan)
- [ ] `order-mapper.ts` — complete SalesOrder + FulfillmentOrder → Picqer payload

### Stap 5 — Sync pipeline
- [ ] `order-sync.ts` — orchestrator: fetch sales orders → fetch fulfillment → map → create in Picqer
- [ ] `POST /api/floriday/sync/orders` — handmatige trigger
- [ ] `POST /api/floriday/webhooks` — webhook ontvanger

### Stap 6 — Dashboard
- [ ] `/floriday` pagina — overzicht orders, sync status, logs
- [ ] `GET /api/floriday/orders` — dashboard data endpoint

---

## 7. Picqer Velden (Nieuwe functies nodig)

### POST /orders — Create Order

```json
{
  "idcustomer": 101376949,
  "idtemplate": 9102,
  "reference": "F2AC98A, F2AC99A",
  "preferred_delivery_date": "2026-02-19",
  "deliveryname": "KLOK FLORAHOLLAND AALSMEER",
  "deliveryaddress": "Legmeerdijk 313",
  "deliveryzipcode": "1431 GB",
  "deliverycity": "AALSMEER",
  "deliverycountry": "NL",
  "language": "nl",
  "customer_remarks": "eerste koop",
  "products": [
    {
      "idproduct": 46275607,
      "amount": 100,
      "price": 0
    },
    {
      "idproduct": 38535312,
      "amount": 9,
      "price": 0
    }
  ]
}
```

### POST /customers — Create Customer

```json
{
  "name": "247flowers.online BV",
  "language": "nl"
}
```

---

## 8. Floriday Rate Limits

| Endpoint categorie | Rate | Burst |
|--------------------|------|-------|
| Sync endpoints | 3.4 req/sec | 1000 |
| Media upload | 2.0 req/sec | 200 |
| Continuous stock | 10 req/sec | 1000 |

---

## 9. Environment Variables

```bash
# Floriday (al geconfigureerd in .env.local)
FLORIDAY_API_BASE_URL=https://api.staging.floriday.io/suppliers-api-2025v2
FLORIDAY_AUTH_URL=https://idm.staging.floriday.io/oauth2/ausmw6b47z1BnlHkw0h7/v1/token
FLORIDAY_CLIENT_ID=<client-id>
FLORIDAY_CLIENT_SECRET=<secret>
FLORIDAY_API_KEY=<api-key>
```

---

## 10. Bekende Constanten

| Constante | Waarde | Gebruik |
|-----------|--------|--------|
| Picqer template ID | 9102 | Order template |
| Picqer field Alternatieve SKU | 4875 | Product matching |
| Deense kar idproduct | 38535312 | Load carrier product |
| Veiling kar idproduct | 38535557 | Load carrier product |
| Deense kar productcode | 100000012 | Load carrier product |
| Veiling kar productcode | 100000013 | Load carrier product |
