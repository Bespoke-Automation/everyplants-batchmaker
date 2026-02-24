# Facturatie App — Schema Spec voor Batchmaker Engine

De batchmaker packaging engine heeft deze tabellen nodig in de facturatie Supabase om kostengeoptimaliseerd verpakkingsadvies te geven.

## Schema

Alle tabellen in een `shipping` schema (of `public` als je geen schema wilt).

### Tabel 1: `packaging_costs` — Dooskosten

```sql
CREATE TABLE packaging_costs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  box_price numeric(8,2) NOT NULL DEFAULT 0,
  interior_price numeric(8,2) DEFAULT 0,
  strap_price numeric(8,2) DEFAULT 0,
  total_purchase_price numeric(8,2) GENERATED ALWAYS AS
    (box_price + COALESCE(interior_price, 0) + COALESCE(strap_price, 0)) STORED,
  selling_price_ep numeric(8,2),
  selling_price_gb numeric(8,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### Tabel 2: `shipping_rates` — Transporttarieven

Per doos x land x carrier de all-in verzendkosten.

```sql
CREATE TABLE shipping_rates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  box_sku text NOT NULL REFERENCES packaging_costs(sku),
  country_code text NOT NULL,
  carrier text NOT NULL,
  shipping_cost numeric(8,2) NOT NULL,
  is_preferred boolean DEFAULT false,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(box_sku, country_code, carrier)
);

-- Index voor de engine query
CREATE INDEX idx_shipping_rates_preferred ON shipping_rates(box_sku, country_code) WHERE is_preferred = true;
```

**Velden:**
- `box_sku` — SKU van de doos (FK naar packaging_costs)
- `country_code` — ISO landcode: NL, BE, DE, FR, AT, LU, SE, IT, ES
- `carrier` — PostNL, DPD, DeRooy, TOV, Postzegel
- `shipping_cost` — All-in tarief inclusief alle toeslagen
- `is_preferred` — `true` voor de carrier die de engine moet gebruiken
- `is_available` — `false` als deze route niet mogelijk is (bijv. Fold box 180 via DPD = "x")

### Tabel 3: `carrier_variables` — Toeslagen (optioneel, voor herberekening)

```sql
CREATE TABLE carrier_variables (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  carrier text NOT NULL,
  variable_name text NOT NULL,
  value numeric(8,4) NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('multiplier', 'fixed', 'percentage')),
  frequency text,
  description text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(carrier, variable_name)
);
```

De batchmaker engine leest NIET uit deze tabel — dit is puur voor jou om `shipping_rates` te herberekenen als toeslagen wijzigen.

---

## Seed Data

### packaging_costs

```sql
INSERT INTO packaging_costs (sku, name, box_price, interior_price, strap_price, selling_price_ep, selling_price_gb) VALUES
('55_1097', 'No box', 0, 0, 0, 0, NULL),
('55_949', 'Surprise box', 1.83, 0, 0, 2.75, 2.48),
('55_921', 'Fold box 100', 1.64, 0.85, 0, 5.61, 5.05),
('55_920', 'Fold box 130', 2.42, 0.85, 0, 5.96, 5.36),
('55_919', 'Fold box 160', 2.89, 1.63, 0, 7.16, 6.44),
('55_918', 'Fold box 180', 3.89, 1.63, 0, 8.66, 7.79),
('55_1099', 'Sale box 170', 2.30, 0.30, 0, 4.67, 4.20),
('55_950', '2x surprise box (strapped)', 1.83, 1.83, 0.20, 5.50, 4.95),
('55_937', 'Eurobox 60', 1.37, 0, 0, 2.33, 2.10),
('55_926', 'Tupe box 60', 0.40, 0.40, 0, 1.58, 1.42),
('55_936', 'Eurobox 40', 1.08, 0, 0, 1.73, 1.56),
('55_926-1', 'Eurobox 40 with 3 layers', 1.08, 1.80, 0, 4.52, 4.07),
('55_924', 'Tupe box 100 Breed', 1.30, 0, 0, 2.63, 2.37),
('55_1070', '2x tupe box 100 (Strapped) breed', 2.60, 0, 0.20, 5.76, 5.18),
('55_1071', 'Euro box 50x50', 4.17, 0, 0, 6.26, 5.63),
('55_923', 'Tupe box 130 cm small', 2.94, 0, 0, 4.79, 4.31),
('55_922', 'Tupe box 130 cm big', 2.94, 0, 0, 4.79, 4.31),
('55_1', 'Envelop', 0, 0, 0, 0.20, 0.18),
('55_1073', 'Colli medium', 2.25, 0, 0, 4.50, 4.05),
('55_915', 'Colli groot', 4.50, 0, 0, 7.88, 7.09),
('55_916', 'HEU (Half pallet)', 4.25, 2.48, 0, 12.72, 11.45),
('55_917', 'EWP (Euro Pallet)', 5.00, 2.48, 0, 13.85, 12.47),
('55_962', 'BLOK (Blok Pallet)', 5.00, 2.48, 0, 13.85, 12.47);
```

### shipping_rates — PostNL tarieven

```sql
INSERT INTO shipping_rates (box_sku, country_code, carrier, shipping_cost, is_preferred) VALUES
-- Surprise box (55_949)
('55_949', 'NL', 'PostNL', 8.15, true),
('55_949', 'BE', 'PostNL', 8.32, true),
('55_949', 'DE', 'PostNL', 7.27, false),
('55_949', 'FR', 'PostNL', 9.47, true),
('55_949', 'AT', 'PostNL', 10.59, true),
('55_949', 'LU', 'PostNL', 12.35, false),
('55_949', 'SE', 'PostNL', 18.35, false),
('55_949', 'IT', 'PostNL', 13.18, true),
('55_949', 'ES', 'PostNL', 12.24, true),

-- Fold box 100 (55_921)
('55_921', 'NL', 'PostNL', 9.09, true),
('55_921', 'BE', 'PostNL', 9.25, true),
('55_921', 'DE', 'PostNL', 9.54, false),
('55_921', 'FR', 'PostNL', 13.39, true),
('55_921', 'AT', 'PostNL', 13.67, true),
('55_921', 'LU', 'PostNL', 15.76, false),
('55_921', 'SE', 'PostNL', 22.53, false),
('55_921', 'IT', 'PostNL', 17.19, true),
('55_921', 'ES', 'PostNL', 17.47, true),

-- Fold box 130 (55_920)
('55_920', 'NL', 'PostNL', 13.86, true),
('55_920', 'BE', 'PostNL', 14.03, true),
('55_920', 'DE', 'PostNL', 14.59, false),
('55_920', 'FR', 'PostNL', 18.44, false),
('55_920', 'AT', 'PostNL', 18.72, true),
('55_920', 'LU', 'PostNL', 20.81, false),
('55_920', 'SE', 'PostNL', 27.58, false),
('55_920', 'IT', 'PostNL', 22.24, true),
('55_920', 'ES', 'PostNL', 22.52, true),

-- Fold box 160 (55_919)
('55_919', 'NL', 'PostNL', 13.86, true),
('55_919', 'BE', 'PostNL', 14.03, true),
('55_919', 'DE', 'PostNL', 16.30, false),
('55_919', 'FR', 'PostNL', 24.46, false),
('55_919', 'AT', 'PostNL', 22.19, true),
('55_919', 'LU', 'PostNL', 24.72, false),
('55_919', 'SE', 'PostNL', 32.75, false),
('55_919', 'IT', 'PostNL', 25.49, true),
('55_919', 'ES', 'PostNL', 32.14, true),

-- Fold box 180 (55_918) — PostNL only (DPD niet beschikbaar)
('55_918', 'NL', 'PostNL', 13.86, true),
('55_918', 'BE', 'PostNL', 14.03, true),
('55_918', 'DE', 'PostNL', 16.30, true),
('55_918', 'AT', 'PostNL', 22.19, true),
('55_918', 'LU', 'PostNL', 24.72, true),
('55_918', 'SE', 'PostNL', 32.75, true),
('55_918', 'IT', 'PostNL', 25.49, true),
('55_918', 'ES', 'PostNL', 32.14, true),
-- FR = niet beschikbaar ("x")

-- Sale box 170 (55_1099)
('55_1099', 'NL', 'PostNL', 13.86, true),
('55_1099', 'BE', 'PostNL', 14.03, true),
('55_1099', 'DE', 'PostNL', 14.59, false),
('55_1099', 'FR', 'PostNL', 18.44, false),
('55_1099', 'AT', 'PostNL', 18.72, true),
('55_1099', 'LU', 'PostNL', 20.81, false),
('55_1099', 'SE', 'PostNL', 27.58, false),
('55_1099', 'IT', 'PostNL', 22.24, true),
('55_1099', 'ES', 'PostNL', 22.52, true),

-- 2x surprise box strapped (55_950)
('55_950', 'NL', 'PostNL', 11.19, true),
('55_950', 'BE', 'PostNL', 11.35, true),
('55_950', 'DE', 'PostNL', 10.86, false),
('55_950', 'FR', 'PostNL', 14.71, true),
('55_950', 'AT', 'PostNL', 14.99, true),
('55_950', 'LU', 'PostNL', 17.08, false),
('55_950', 'SE', 'PostNL', 23.85, false),
('55_950', 'IT', 'PostNL', 18.51, true),
('55_950', 'ES', 'PostNL', 18.79, true),

-- Eurobox 60 (55_937)
('55_937', 'NL', 'PostNL', 11.19, true),
('55_937', 'BE', 'PostNL', 11.35, true),
('55_937', 'DE', 'PostNL', 10.86, false),
('55_937', 'FR', 'PostNL', 14.71, true),
('55_937', 'AT', 'PostNL', 14.99, true),
('55_937', 'LU', 'PostNL', 17.08, false),
('55_937', 'SE', 'PostNL', 23.85, false),
('55_937', 'IT', 'PostNL', 18.51, true),
('55_937', 'ES', 'PostNL', 18.79, true),

-- Tupe box 60 (55_926)
('55_926', 'NL', 'PostNL', 8.15, true),
('55_926', 'BE', 'PostNL', 8.32, true),
('55_926', 'DE', 'PostNL', 7.27, false),
('55_926', 'FR', 'PostNL', 9.47, true),
('55_926', 'AT', 'PostNL', 10.59, true),
('55_926', 'LU', 'PostNL', 12.35, false),
('55_926', 'SE', 'PostNL', 18.35, false),
('55_926', 'IT', 'PostNL', 13.18, true),
('55_926', 'ES', 'PostNL', 12.24, true),

-- Eurobox 40 (55_936)
('55_936', 'NL', 'PostNL', 9.09, true),
('55_936', 'BE', 'PostNL', 9.25, true),
('55_936', 'DE', 'PostNL', 9.81, false),
('55_936', 'FR', 'PostNL', 13.66, true),
('55_936', 'AT', 'PostNL', 13.95, true),
('55_936', 'LU', 'PostNL', 16.04, false),
('55_936', 'SE', 'PostNL', 22.80, false),
('55_936', 'IT', 'PostNL', 17.47, true),
('55_936', 'ES', 'PostNL', 17.74, true),

-- Eurobox 40 with 3 layers (55_926-1)
('55_926-1', 'NL', 'PostNL', 9.09, true),
('55_926-1', 'BE', 'PostNL', 9.25, true),
('55_926-1', 'DE', 'PostNL', 9.81, false),
('55_926-1', 'FR', 'PostNL', 13.66, true),
('55_926-1', 'AT', 'PostNL', 13.95, true),
('55_926-1', 'LU', 'PostNL', 16.04, false),
('55_926-1', 'SE', 'PostNL', 22.80, false),
('55_926-1', 'IT', 'PostNL', 17.47, true),
('55_926-1', 'ES', 'PostNL', 17.74, true),

-- Tupe box 100 Breed (55_924)
('55_924', 'NL', 'PostNL', 9.09, true),
('55_924', 'BE', 'PostNL', 9.25, true),
('55_924', 'DE', 'PostNL', 9.81, false),
('55_924', 'FR', 'PostNL', 13.66, true),
('55_924', 'AT', 'PostNL', 13.95, true),
('55_924', 'LU', 'PostNL', 16.04, false),
('55_924', 'SE', 'PostNL', 22.80, false),
('55_924', 'IT', 'PostNL', 17.47, true),
('55_924', 'ES', 'PostNL', 17.74, true),

-- 2x tupe box 100 Strapped breed (55_1070) — DPD preferred everywhere
('55_1070', 'NL', 'PostNL', 9.09, false),
('55_1070', 'BE', 'PostNL', 9.25, false),
('55_1070', 'DE', 'PostNL', 9.81, false),
('55_1070', 'FR', 'PostNL', 13.66, false),
('55_1070', 'AT', 'PostNL', 13.95, false),
('55_1070', 'LU', 'PostNL', 16.04, false),
('55_1070', 'SE', 'PostNL', 22.80, false),
('55_1070', 'IT', 'PostNL', 17.47, false),
('55_1070', 'ES', 'PostNL', 17.74, false),

-- Tupe box 130 cm small (55_923)
('55_923', 'NL', 'PostNL', 13.86, true),
('55_923', 'BE', 'PostNL', 14.03, true),
('55_923', 'DE', 'PostNL', 14.59, false),
('55_923', 'FR', 'PostNL', 18.44, false),
('55_923', 'AT', 'PostNL', 18.72, true),
('55_923', 'LU', 'PostNL', 20.81, false),
('55_923', 'SE', 'PostNL', 27.58, false),
('55_923', 'IT', 'PostNL', 22.24, true),
('55_923', 'ES', 'PostNL', 22.52, true),

-- Tupe box 130 cm big (55_922)
('55_922', 'NL', 'PostNL', 13.86, true),
('55_922', 'BE', 'PostNL', 14.03, true),
('55_922', 'DE', 'PostNL', 14.59, false),
('55_922', 'FR', 'PostNL', 18.44, false),
('55_922', 'AT', 'PostNL', 18.72, true),
('55_922', 'LU', 'PostNL', 20.81, false),
('55_922', 'SE', 'PostNL', 27.58, false),
('55_922', 'IT', 'PostNL', 22.24, true),
('55_922', 'ES', 'PostNL', 22.52, true),

-- Euro box 50x50 (55_1071)
('55_1071', 'NL', 'PostNL', 11.19, false),
('55_1071', 'BE', 'PostNL', 9.25, false),
('55_1071', 'DE', 'PostNL', 9.81, false),
('55_1071', 'FR', 'PostNL', 13.66, false),
('55_1071', 'AT', 'PostNL', 13.95, false),
('55_1071', 'LU', 'PostNL', 16.04, false),
('55_1071', 'SE', 'PostNL', 22.80, false),
('55_1071', 'IT', 'PostNL', 17.47, false),
('55_1071', 'ES', 'PostNL', 17.74, false),

-- Envelop (55_1)
('55_1', 'NL', 'Postzegel', 0, true),
('55_1', 'BE', 'Postzegel', 0, true),
('55_1', 'DE', 'Postzegel', 0, true),
('55_1', 'FR', 'Postzegel', 0, true),
('55_1', 'AT', 'Postzegel', 0, true),
('55_1', 'LU', 'Postzegel', 0, true),
('55_1', 'SE', 'Postzegel', 0, true),
('55_1', 'IT', 'Postzegel', 0, true),
('55_1', 'ES', 'Postzegel', 0, true);
```

### shipping_rates — DPD tarieven

```sql
INSERT INTO shipping_rates (box_sku, country_code, carrier, shipping_cost, is_preferred) VALUES
-- Surprise box (55_949) — DPD preferred for DE, LU, SE
('55_949', 'NL', 'DPD', 5.32, false),
('55_949', 'BE', 'DPD', 6.31, false),
('55_949', 'DE', 'DPD', 6.04, true),
('55_949', 'FR', 'DPD', 10.36, false),
('55_949', 'AT', 'DPD', 8.33, false),
('55_949', 'LU', 'DPD', 8.09, true),
('55_949', 'SE', 'DPD', 24.22, true),
('55_949', 'IT', 'DPD', 13.78, false),
('55_949', 'ES', 'DPD', 19.31, false),

-- Fold box 100 (55_921) — DPD preferred for DE, LU, SE
('55_921', 'NL', 'DPD', 5.32, false),
('55_921', 'BE', 'DPD', 6.31, false),
('55_921', 'DE', 'DPD', 6.04, true),
('55_921', 'FR', 'DPD', 10.36, false),
('55_921', 'AT', 'DPD', 8.33, false),
('55_921', 'LU', 'DPD', 8.09, true),
('55_921', 'SE', 'DPD', 24.22, true),
('55_921', 'IT', 'DPD', 13.78, false),
('55_921', 'ES', 'DPD', 19.31, false),

-- Fold box 130 (55_920) — DPD preferred for DE, FR, LU, SE
('55_920', 'NL', 'DPD', 8.86, false),
('55_920', 'BE', 'DPD', 9.85, false),
('55_920', 'DE', 'DPD', 9.58, true),
('55_920', 'FR', 'DPD', 13.90, true),
('55_920', 'AT', 'DPD', 11.87, false),
('55_920', 'LU', 'DPD', 11.63, true),
('55_920', 'SE', 'DPD', 27.76, true),
('55_920', 'IT', 'DPD', 17.32, false),
('55_920', 'ES', 'DPD', 22.85, false),

-- Fold box 160 (55_919) — DPD preferred for DE, FR, LU, SE
('55_919', 'NL', 'DPD', 8.86, false),
('55_919', 'BE', 'DPD', 9.85, false),
('55_919', 'DE', 'DPD', 9.58, true),
('55_919', 'FR', 'DPD', 13.90, true),
('55_919', 'AT', 'DPD', 11.87, false),
('55_919', 'LU', 'DPD', 11.63, true),
('55_919', 'SE', 'DPD', 27.76, true),
('55_919', 'IT', 'DPD', 17.32, false),
('55_919', 'ES', 'DPD', 22.85, false),

-- Fold box 180 (55_918) — NOT available via DPD
('55_918', 'NL', 'DPD', 0, false),
('55_918', 'BE', 'DPD', 0, false),
('55_918', 'DE', 'DPD', 0, false),
('55_918', 'FR', 'DPD', 0, false),
('55_918', 'AT', 'DPD', 0, false),
('55_918', 'LU', 'DPD', 0, false),
('55_918', 'SE', 'DPD', 0, false),
('55_918', 'IT', 'DPD', 0, false),
('55_918', 'ES', 'DPD', 0, false),

-- Sale box 170 (55_1099)
('55_1099', 'NL', 'DPD', 8.86, false),
('55_1099', 'BE', 'DPD', 9.85, false),
('55_1099', 'DE', 'DPD', 9.58, true),
('55_1099', 'FR', 'DPD', 13.90, true),
('55_1099', 'AT', 'DPD', 11.87, false),
('55_1099', 'LU', 'DPD', 11.63, true),
('55_1099', 'SE', 'DPD', 27.76, true),
('55_1099', 'IT', 'DPD', 17.32, false),
('55_1099', 'ES', 'DPD', 22.85, false),

-- 2x surprise box strapped (55_950)
('55_950', 'NL', 'DPD', 5.32, false),
('55_950', 'BE', 'DPD', 6.31, false),
('55_950', 'DE', 'DPD', 6.04, true),
('55_950', 'FR', 'DPD', 10.36, false),
('55_950', 'AT', 'DPD', 8.33, false),
('55_950', 'LU', 'DPD', 8.09, true),
('55_950', 'SE', 'DPD', 24.22, true),
('55_950', 'IT', 'DPD', 13.78, false),
('55_950', 'ES', 'DPD', 19.31, false),

-- Eurobox 60 (55_937)
('55_937', 'NL', 'DPD', 5.32, false),
('55_937', 'BE', 'DPD', 6.31, false),
('55_937', 'DE', 'DPD', 6.04, true),
('55_937', 'FR', 'DPD', 10.36, false),
('55_937', 'AT', 'DPD', 8.33, false),
('55_937', 'LU', 'DPD', 8.09, true),
('55_937', 'SE', 'DPD', 24.22, true),
('55_937', 'IT', 'DPD', 13.78, false),
('55_937', 'ES', 'DPD', 19.31, false),

-- Tupe box 60 (55_926)
('55_926', 'NL', 'DPD', 5.32, false),
('55_926', 'BE', 'DPD', 6.31, false),
('55_926', 'DE', 'DPD', 6.04, true),
('55_926', 'FR', 'DPD', 10.36, false),
('55_926', 'AT', 'DPD', 8.33, false),
('55_926', 'LU', 'DPD', 8.09, true),
('55_926', 'SE', 'DPD', 24.22, true),
('55_926', 'IT', 'DPD', 13.78, false),
('55_926', 'ES', 'DPD', 19.31, false),

-- Eurobox 40 (55_936)
('55_936', 'NL', 'DPD', 5.32, false),
('55_936', 'BE', 'DPD', 6.31, false),
('55_936', 'DE', 'DPD', 6.04, true),
('55_936', 'FR', 'DPD', 10.36, false),
('55_936', 'AT', 'DPD', 8.33, false),
('55_936', 'LU', 'DPD', 8.09, true),
('55_936', 'SE', 'DPD', 24.22, true),
('55_936', 'IT', 'DPD', 13.78, false),
('55_936', 'ES', 'DPD', 19.31, false),

-- Eurobox 40 with 3 layers (55_926-1)
('55_926-1', 'NL', 'DPD', 5.32, false),
('55_926-1', 'BE', 'DPD', 6.31, false),
('55_926-1', 'DE', 'DPD', 6.04, true),
('55_926-1', 'FR', 'DPD', 10.36, false),
('55_926-1', 'AT', 'DPD', 8.33, false),
('55_926-1', 'LU', 'DPD', 8.09, true),
('55_926-1', 'SE', 'DPD', 24.22, true),
('55_926-1', 'IT', 'DPD', 13.78, false),
('55_926-1', 'ES', 'DPD', 19.31, false),

-- Tupe box 100 Breed (55_924)
('55_924', 'NL', 'DPD', 5.32, false),
('55_924', 'BE', 'DPD', 6.31, false),
('55_924', 'DE', 'DPD', 6.04, true),
('55_924', 'FR', 'DPD', 10.36, false),
('55_924', 'AT', 'DPD', 8.33, false),
('55_924', 'LU', 'DPD', 8.09, true),
('55_924', 'SE', 'DPD', 24.22, true),
('55_924', 'IT', 'DPD', 13.78, false),
('55_924', 'ES', 'DPD', 19.31, false),

-- 2x tupe box 100 Strapped breed (55_1070) — DPD preferred EVERYWHERE
('55_1070', 'NL', 'DPD', 5.32, true),
('55_1070', 'BE', 'DPD', 6.31, true),
('55_1070', 'DE', 'DPD', 6.04, true),
('55_1070', 'FR', 'DPD', 10.36, true),
('55_1070', 'AT', 'DPD', 8.33, true),
('55_1070', 'LU', 'DPD', 8.09, true),
('55_1070', 'SE', 'DPD', 24.22, true),
('55_1070', 'IT', 'DPD', 13.78, true),
('55_1070', 'ES', 'DPD', 19.31, true),

-- Tupe box 130 cm small (55_923)
('55_923', 'NL', 'DPD', 8.86, false),
('55_923', 'BE', 'DPD', 9.85, false),
('55_923', 'DE', 'DPD', 9.58, true),
('55_923', 'FR', 'DPD', 13.90, true),
('55_923', 'AT', 'DPD', 11.87, false),
('55_923', 'LU', 'DPD', 11.63, true),
('55_923', 'SE', 'DPD', 27.76, true),
('55_923', 'IT', 'DPD', 17.32, false),
('55_923', 'ES', 'DPD', 22.85, false),

-- Tupe box 130 cm big (55_922)
('55_922', 'NL', 'DPD', 8.86, false),
('55_922', 'BE', 'DPD', 9.85, false),
('55_922', 'DE', 'DPD', 9.58, true),
('55_922', 'FR', 'DPD', 13.90, true),
('55_922', 'AT', 'DPD', 11.87, false),
('55_922', 'LU', 'DPD', 11.63, true),
('55_922', 'SE', 'DPD', 27.76, true),
('55_922', 'IT', 'DPD', 17.32, false),
('55_922', 'ES', 'DPD', 22.85, false),

-- Euro box 50x50 (55_1071) — DPD preferred everywhere
('55_1071', 'NL', 'DPD', 5.32, true),
('55_1071', 'BE', 'DPD', 6.31, true),
('55_1071', 'DE', 'DPD', 6.04, true),
('55_1071', 'FR', 'DPD', 10.36, true),
('55_1071', 'AT', 'DPD', 8.33, true),
('55_1071', 'LU', 'DPD', 8.09, true),
('55_1071', 'SE', 'DPD', 24.22, true),
('55_1071', 'IT', 'DPD', 13.78, true),
('55_1071', 'ES', 'DPD', 19.31, true);
```

### shipping_rates — De Rooy tarieven (pallets/colli)

```sql
INSERT INTO shipping_rates (box_sku, country_code, carrier, shipping_cost, is_preferred) VALUES
-- Colli medium (55_1073)
('55_1073', 'NL', 'DeRooy', 29.87, true),
('55_1073', 'BE', 'DeRooy', 62.13, true),

-- Colli groot (55_915)
('55_915', 'NL', 'DeRooy', 29.87, true),
('55_915', 'BE', 'DeRooy', 62.13, true),

-- HEU Half pallet (55_916)
('55_916', 'NL', 'DeRooy', 53.60, true),
('55_916', 'BE', 'DeRooy', 93.28, true),

-- EWP Euro Pallet (55_917)
('55_917', 'NL', 'DeRooy', 64.32, true),
('55_917', 'BE', 'DeRooy', 106.45, true),

-- BLOK Blok Pallet (55_962)
('55_962', 'NL', 'DeRooy', 79.07, true),
('55_962', 'BE', 'DeRooy', 127.76, true);
```

### carrier_variables — Toeslagen referentie

```sql
INSERT INTO carrier_variables (carrier, variable_name, value, value_type, frequency, description) VALUES
-- PostNL
('PostNL', 'energietoeslag', 0.13, 'fixed', 'maandelijks', 'Per pakket'),
('PostNL', 'toeslag_nl_be', 5.19, 'fixed', 'vast', 'Basisprijs NL/BE'),
('PostNL', 'toeslag_de', 11.00, 'fixed', 'vast', 'Basisprijs DE'),
('PostNL', 'toeslag_fr', 8.00, 'fixed', 'vast', 'Basisprijs FR'),
('PostNL', 'toeslag_se', 5.45, 'fixed', 'vast', 'Basisprijs SE'),
('PostNL', 'toeslag_overig', 5.60, 'fixed', 'vast', 'Basisprijs overige bestemmingen'),
('PostNL', 'toeslag_50_100dm3_nlbe', 0.85, 'fixed', 'vast', 'Volume 50-100dm3 NL/BE'),
('PostNL', 'toeslag_100_200dm3_nlbe', 2.76, 'fixed', 'vast', 'Volume 100-200dm3 NL/BE'),
('PostNL', 'toeslag_200plus_nlbe', 6.55, 'fixed', 'vast', 'Volume 200dm3+ NL/BE'),
('PostNL', 'toeslag_50_100dm3_overig', 0.60, 'fixed', 'vast', 'Volume 50-100dm3 overig'),
('PostNL', 'toeslag_100_200dm3_overig', 1.80, 'fixed', 'vast', 'Volume 100-200dm3 overig'),
('PostNL', 'toeslag_200plus_overig', 3.65, 'fixed', 'vast', 'Volume 200dm3+ overig'),
('PostNL', 'overige_kosten_multiplier', 1.10, 'multiplier', 'maandelijks', 'Overige kosten vermenigvuldiger'),

-- DPD
('DPD', 'dieseltoeslag', 1.12, 'multiplier', 'maandelijks', 'Diesel/energietoeslag'),
('DPD', 'toeslag_vast', 3.54, 'fixed', 'vast', 'Vaste toeslag'),
('DPD', 'tol_be', 0.038, 'fixed', 'vast', 'Tol België'),
('DPD', 'tol_de', 0.044, 'fixed', 'vast', 'Tol Duitsland'),
('DPD', 'tol_fr', 0.019, 'fixed', 'vast', 'Tol Frankrijk'),
('DPD', 'tol_es', 0.019, 'fixed', 'vast', 'Tol Spanje'),
('DPD', 'tol_at', 0.0295, 'fixed', 'vast', 'Tol Oostenrijk'),
('DPD', 'tol_lu', 0.019, 'fixed', 'vast', 'Tol Luxemburg'),
('DPD', 'tol_se', 0.0295, 'fixed', 'vast', 'Tol Zweden'),
('DPD', 'tol_it', 0.019, 'fixed', 'vast', 'Tol Italië'),
('DPD', 'diverse_kosten', 1.00, 'multiplier', 'maandelijks', 'Diverse kosten multiplier'),

-- De Rooy
('DeRooy', 'dieseltoeslag', 1.24, 'multiplier', 'wekelijks', 'Dieseltoeslag'),
('DeRooy', 'overige_kosten', 1.075, 'multiplier', 'wekelijks', 'Overige kosten'),
('DeRooy', 'tol_be', 1.09, 'multiplier', 'vast', 'Tol België'),
('DeRooy', 'retourkosten', 1.50, 'fixed', 'vast', 'Retourkosten per pakket');
```

---

## Hoe de Batchmaker Engine het Leest

De engine doet **1 query** om alle relevante kosten op te halen:

```sql
SELECT
  pc.sku,
  pc.name,
  pc.total_purchase_price as box_cost,
  sr.country_code,
  sr.carrier,
  sr.shipping_cost as transport_cost,
  (pc.total_purchase_price + sr.shipping_cost) as total_cost
FROM packaging_costs pc
JOIN shipping_rates sr ON sr.box_sku = pc.sku
  AND sr.is_preferred = true
  AND sr.is_available = true
WHERE sr.country_code = $1  -- bestemmingsland
ORDER BY total_cost ASC;
```

Dit geeft een gesorteerde lijst van alle dozen met hun totaalkosten voor een specifiek land.

---

## Landcodes Mapping

| Excel | ISO Code | Land |
|-------|----------|------|
| Nederland | NL | Nederland |
| Belgie | BE | België |
| Duitsland | DE | Duitsland |
| Frankrijk | FR | Frankrijk |
| Oostenrijk | AT | Oostenrijk |
| Luxemburg | LU | Luxemburg |
| Zweden | SE | Zweden |
| Italie | IT | Italië |
| Spanje | ES | Spanje |

---

## Opmerkingen

1. **Fold box 180 + Frankrijk** = niet beschikbaar (zowel PostNL als DPD). Geen `shipping_rates` row invoegen, of `is_available = false`.
2. **Tupe box 100 Small** en **2x tupe box 100 (Strapped) small** hebben geen SKU in de Excel — mogelijk nog niet in Picqer?
3. **De Rooy** tarieven zijn inclusief diesel + overige kosten (al doorgerekend in seed data).
4. **TOV** tarieven voor DE/FR zijn nog niet compleet — `carrier_variables` bevat de basisprijzen maar `shipping_rates` moeten nog aangevuld worden.
5. De `carrier_variables` tabel is voor jullie eigen administratie. Als toeslagen wijzigen, herbereken je de `shipping_rates.shipping_cost` waarden.
