# Phase 3: Single Orders Batch Creation with Shipments & Labels

## Overview
Implement the single orders batch workflow:
1. User selects product groups from the Single Orders page
2. System creates shipments via Picqer API
3. Fetches shipping labels (PDF) from Picqer
4. Edits PDF labels to include plant name
5. Saves results to Supabase
6. Triggers n8n webhook for print processing

---

## Current State

### What Already Exists
| Component | Path | Status |
|-----------|------|--------|
| Single Orders UI | `/src/components/SingleOrdersClient.tsx` | Complete |
| Grouped Table with Selection | `/src/components/single-orders/GroupedOrdersTable.tsx` | Complete |
| Single Order Analysis | `/src/lib/picqer/singleOrders.ts` | Complete |
| API Endpoint | `/src/app/api/single-orders/route.ts` | Complete |
| Batch API Stub | `/src/app/api/single-orders/batch/route.ts` | **STUB ONLY** |
| Picqer Client | `/src/lib/picqer/client.ts` | Partial (no shipments) |

### Data Flow (Current)
```
Picqer Orders → /api/single-orders → useSingleOrders → GroupedOrdersTable
                                                              ↓
                                              User selects product groups
                                                              ↓
                                              "Create Batch" button (NOT WIRED)
```

---

## Implementation Plan

### 1. Add Picqer Shipment Functions
**File:** `/src/lib/picqer/client.ts`

```typescript
// Create shipment for a picklist
export async function createShipment(picklistId: number, shippingProviderId?: number): Promise<ShipmentResult>

// Get shipping label PDF
export async function getShipmentLabel(shipmentId: number): Promise<Buffer>
```

**Picqer API Endpoints:**
- `POST /api/v1/picklists/{id}/shipments` - Create shipment
- `GET /api/v1/shipments/{id}/label` - Get label PDF

### 2. Add Picqer Shipment Types
**File:** `/src/lib/picqer/types.ts`

```typescript
export interface PicqerShipment {
  idshipment: number
  idpicklist: number
  provider: string
  providername: string
  labelurl?: string
  tracktraceurl?: string
  trackingcode?: string
}

export interface CreateShipmentResult {
  success: boolean
  shipment?: PicqerShipment
  error?: string
}
```

### 3. PDF Label Editing
**New File:** `/src/lib/pdf/labelEditor.ts`

**Dependencies to add:**
```bash
npm install pdf-lib
```

```typescript
import { PDFDocument } from 'pdf-lib'

export async function addPlantNameToLabel(
  labelPdf: Buffer,
  plantName: string,
  position?: { x: number, y: number }
): Promise<Buffer>
```

**Considerations:**
- Position of plant name on label (top, bottom, margin?)
- Font size and styling
- Not covering barcodes or essential info
- Multiple label formats from different carriers?

### 4. Supabase Storage for Labels
**New Table:** `batchmaker.shipment_labels`

```sql
CREATE TABLE batchmaker.shipment_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL,
  picklist_id INTEGER NOT NULL,
  shipment_id INTEGER,
  order_reference TEXT,
  retailer TEXT,
  plant_name TEXT,
  original_label_url TEXT,
  edited_label_path TEXT,  -- Supabase Storage path
  tracking_code TEXT,
  status TEXT DEFAULT 'pending',  -- pending, created, labeled, error
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies for anon access
```

**Supabase Storage Bucket:** `shipment-labels`
- Store edited PDF labels
- Public or signed URLs for download

### 5. Implement Batch API Route
**File:** `/src/app/api/single-orders/batch/route.ts`

```typescript
export async function POST(request: Request) {
  const { productGroups } = await request.json()

  // 1. Validate input
  // 2. For each order in selected groups:
  //    a. Create shipment in Picqer
  //    b. Fetch label PDF
  //    c. Edit PDF with plant name
  //    d. Upload to Supabase Storage
  //    e. Save record to shipment_labels table
  // 3. Trigger n8n webhook with batch summary
  // 4. Return results
}
```

### 6. Wire Up UI
**File:** `/src/components/SingleOrdersClient.tsx`

- Add "Maak batch" button (like BatchmakerClient)
- Confirmation dialog showing selected groups/orders count
- Progress indicator during batch creation
- Success/error result display

**File:** `/src/components/single-orders/GroupedOrdersTable.tsx`

- Selection state is already tracked via `selectedGroups`
- Need to pass selection to parent for batch creation

### 7. N8N Webhook Integration
**Similar to batches:**
```typescript
const webhookPayload = {
  batchId: string,
  productGroups: [...],
  shipments: [...],
  labelUrls: [...],
  retailerSummary: Record<string, number>,
  timestamp: string
}
```

---

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| Modify | `/src/lib/picqer/client.ts` | Add shipment functions |
| Modify | `/src/lib/picqer/types.ts` | Add shipment types |
| Create | `/src/lib/pdf/labelEditor.ts` | PDF editing with pdf-lib |
| Create | `/src/lib/supabase/shipmentLabels.ts` | CRUD for shipment_labels |
| Modify | `/src/app/api/single-orders/batch/route.ts` | Full implementation |
| Modify | `/src/components/SingleOrdersClient.tsx` | Add batch creation UI |
| Create | Migration for `shipment_labels` table | Database schema |

---

## Dependencies to Add

```bash
npm install pdf-lib
```

---

## Environment Variables Needed

```env
# Already exists
PICQER_API_KEY=...
PICQER_BASE_URL=...

# New (optional)
N8N_SINGLE_ORDER_WEBHOOK_URL=...  # Separate webhook for single orders?
SUPABASE_STORAGE_BUCKET=shipment-labels
```

---

## Decisions Made

1. **Label Position:** ✅ RESOLVED
   - Add plant name in the **white space between sender info and recipient box**
   - Position: Middle-right area of label (approximately 60% from left, 50% from top)
   - Font: Bold, readable size (~14-16pt)
   - Avoid: Left side (barcode area), recipient box, sender info

2. **Shipping Provider:** ✅ RESOLVED
   - Dynamic based on **country + packaging type**
   - User will provide mapping document later
   - Build system to accept provider as parameter
   - Example: NL + Foldbox = PostNL

3. **Error Handling:** ✅ RESOLVED
   - **Continue with other orders** if one fails
   - Skip failed orders, process the rest
   - Report all errors at the end in response

4. **Print Output:** ✅ RESOLVED
   - **Single combined PDF** per batch
   - Sorted by: **Product first, then Retailer**
   - User selects product groups → creates batch → one PDF output

## Remaining Questions

1. **N8N Webhook:** Same webhook as batches or separate?
   - What data does n8n need for print processing?

---

## Verification Steps

1. Select product groups on `/single-orders`
2. Click "Maak batch" button
3. Confirm in dialog
4. Verify shipments created in Picqer
5. Verify labels fetched and edited with plant name
6. Verify records saved in Supabase `shipment_labels` table
7. Verify PDFs stored in Supabase Storage
8. Verify n8n webhook triggered with correct data

---

## Estimated Scope

| Task | Complexity |
|------|------------|
| Picqer shipment functions | Medium |
| PDF label editing | Medium-High |
| Supabase table & storage | Low |
| Batch API route | High |
| UI integration | Medium |
| N8N webhook | Low |
| Error handling & edge cases | Medium |

**Total:** Significant feature requiring careful implementation of Picqer API integration and PDF manipulation.
