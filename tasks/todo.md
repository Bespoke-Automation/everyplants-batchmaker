# Verpakkingsmodule Optimalisatie — Implementatieplan

## Overzicht

4 fases om de verpakkingsmodule optimaal te maken voor warehouse medewerkers.
Fase 5 (Engine Intelligence + nep-orders) wordt later apart opgepakt.

---

## Fase 1: Workflow-automatisering & Bug Fixes

Dagelijkse pijnpunten wegnemen. Grootste impact voor warehouse medewerkers.

### 1.1 Auto-complete picklijst
- [ ] Als alle producten in afgesloten dozen zitten → picklijst automatisch op `completed` zetten
- [ ] Lege dozen (0 producten) automatisch verwijderen bij deze check
- [ ] Werkt ongeacht of dozen al verzonden zijn of niet — check is: alle producten toegewezen + dozen afgesloten
- **Files**: `usePackingSession.ts`, `tryCompleteSession.ts`, box close handler

### 1.2 Auto-popup "Zendingen maken"
- [ ] Zodra alle producten in dozen zitten EN alle dozen afgesloten → automatisch popup openen "Zendingen maken"
- [ ] Popup toont alleen dozen die producten bevatten (skip lege)
- [ ] Na zending aanmaken: direct labels printen via PrintNode (als werkstation geconfigureerd)
- [ ] Zelfde flow als huidige handmatige "Zendingen maken" maar automatisch getriggerd
- **Files**: `VerpakkingsClient.tsx`, `ShipmentProgress.tsx`, `usePackingSession.ts`

### 1.3 Bescherming afgesloten doos
- [ ] X-knop op producten disablen als de doos waarin ze zitten afgesloten is
- [ ] Visuele indicatie (grayed out / tooltip "Heropen doos eerst")
- [ ] Gebruiker moet doos heropenen voordat producten verplaatst/verwijderd kunnen worden
- **Files**: `BoxCard.tsx`, `ProductCard.tsx`

### 1.4 Dozen reset fix
- [ ] Als gebruiker alle dozen verwijdert → NIET opnieuw engine advies/tag toepassen
- [ ] Dozen sectie moet gewoon leeg blijven na verwijderen
- [ ] Alleen bij eerste keer (wanneer sessie start of engine berekening draait) advies toepassen
- [ ] Track een flag `advice_applied` op de sessie om dubbele toepassing te voorkomen
- **Files**: `usePackingSession.ts` (box removal logic), engine advice apply flow

### 1.5 Picklijst sluiten knop
- [ ] Nieuwe knop "Picklijst sluiten" in de UI (zoals Picqer)
- [ ] Roept Picqer API aan: `POST /picklists/{id}/close`
- [ ] Beschikbaar nadat alle producten gepickt zijn
- [ ] Bevestigingsdialoog voordat picklijst gesloten wordt
- **Files**: `VerpakkingsClient.tsx`, bestaande `/api/picqer/picklists/[id]/close` route

### 1.6 Completed picklist view
- [ ] Verzonden picklijst: producten, dozen en sidebar nog steeds tonen (read-only)
- [ ] Duidelijke visuele "Verzonden" staat (banner bovenaan, groene achtergrond, of overlay)
- [ ] Alle actieknoppen verbergen/disablen (geen dozen toevoegen, geen producten verplaatsen)
- [ ] "Volgende picklijst" knop prominent tonen
- **Files**: `VerpakkingsClient.tsx`, `BoxCard.tsx`, `ProductCard.tsx`

---

## Fase 2: Shipping & Labels

Performance verbeteren + bugs fixen.

### 2.1 Parallelliseer shipment creation
- [ ] `ship-all` endpoint: `shipSingleBox()` calls parallel uitvoeren i.p.v. sequentieel
- [ ] `claimBoxForShipping()` mag serieel (atomic lock), maar `createShipment()` + `getLabel()` + upload parallel
- [ ] Verwachte verbetering: 3 dozen van ~60s → ~20s
- [ ] Error handling: als 1 box faalt, andere toch afmaken, fouten rapporteren per box
- **Files**: `/api/verpakking/sessions/[id]/ship-all/route.ts`

### 2.2 Multi-label fix — gecombineerde PDF
- [ ] Server-side alle labels combineren in 1 PDF (via pdf-lib, al in het project)
- [ ] Nieuw endpoint: `GET /api/verpakking/sessions/[id]/labels/combined` → 1 PDF
- [ ] PrintNode: 1 printjob met gecombineerde PDF i.p.v. meerdere losse
- [ ] UI: "Labels printen" knop opent/downloadt 1 gecombineerd PDF
- [ ] Fallback: individuele label downloads behouden als backup
- **Files**: `ShipmentProgress.tsx`, nieuw endpoint, `src/lib/pdf/`

### 2.3 Gewicht aanpassen voor verzending
- [ ] Vóór "Zendingen maken": gewicht per doos selecteerbaar/aanpasbaar
- [ ] Default gewicht uit packaging config (max_weight of standaard)
- [ ] Dropdown of number input per doos in de zending-popup
- [ ] Gewicht meesturen naar Picqer shipment API
- **Files**: `ShipmentProgress.tsx` of nieuwe `ShipmentConfigModal.tsx`, ship endpoint

### 2.4 Adres bewerken modal
- [ ] Modal om afleveradres te bekijken en aan te passen vóór verzending
- [ ] Adres ophalen uit Picqer order (delivery address)
- [ ] Velden: naam, straat, huisnummer, postcode, stad, land
- [ ] Gewijzigd adres meesturen naar shipment creation
- [ ] Knop "Adres bewerken" naast adres weergave
- **Files**: nieuwe `AddressEditModal.tsx`, ship endpoint aanpassen

---

## Fase 3: Opmerkingen Systeem

Communicatie tussen warehouse medewerkers en kantoor.

### 3.1 Opmerkingen pagina
- [ ] Nieuwe route: `/verpakkingsmodule/opmerkingen`
- [ ] 3 tabs (zoals Picqer screenshot):
  - "Alle opmerkingen" — `GET /comments` (alle comments, globaal)
  - "Mijn opmerkingen" — `GET /comments?idauthor={myUserId}` (door mij geschreven)
  - "@{Mijn naam}" — `GET /comments?idmentioned={myUserId}` (waar ik gementioned ben)
- [ ] Per comment tonen: auteur (avatar + naam), entity link (picklijst/order/batch), @mention highlight, tijdstip
- [ ] Paginatie (Picqer standaard 100 per pagina)
- [ ] Koppeling met Picqer user ID via de worker selector (al beschikbaar)
- **Files**: nieuwe `src/components/verpakking/CommentsPage.tsx`, nieuwe hook `useComments.ts`

### 3.2 Opmerkingen aanmaken/beantwoorden
- [ ] Inline reply box onder elk comment of bij entity
- [ ] @mention autocomplete: typ `@` → dropdown met Picqer users (via `/api/picqer/users`)
- [ ] POST naar juiste entity endpoint: `/picklists/{id}/comments`, `/orders/{id}/comments`, etc.
- [ ] Na aanmaken: comment lijst verversen
- **Files**: nieuwe `CommentInput.tsx` component, `CommentsPage.tsx`

### 3.3 Tekstwolkje in header
- [ ] Icoon rechtsboven in de verpakkingsmodule header (MessageSquare icoon uit lucide-react)
- [ ] Badge met aantal recente mentions voor huidige user
- [ ] Klik → navigeer naar opmerkingen pagina, tab "@{naam}"
- [ ] Polling elke 60 seconden voor nieuwe mentions
- **Files**: header component in verpakkingsmodule layout

### 3.4 Deep links naar picklijsten
- [ ] Vanuit opmerking op picklijst: klikbare link direct naar picklijst in verpakkingsmodule
- [ ] Ook picklijsten buiten een batch bereikbaar maken (directe URL)
- [ ] Route: `/verpakkingsmodule/picklist/[sessionId]` of `/verpakkingsmodule/picklist/[picklistId]`
- [ ] Als picklijst geen sessie heeft: sessie on-demand aanmaken
- **Files**: `CommentsPage.tsx`, routing in verpakkingsmodule layout

---

## Fase 4: Internationalisering (NL/EN)

Taalswitch voor warehouse medewerkers die geen Nederlands spreken.

### 4.1 i18n framework opzetten
- [ ] `src/i18n/nl.ts` — Nederlandse dictionary (source of truth)
- [ ] `src/i18n/en.ts` — Engelse dictionary (getypt als `typeof nl` voor compile-time checks)
- [ ] `src/i18n/types.ts` — TypeScript types voor geneste keys
- [ ] `src/i18n/LanguageContext.tsx` — React Context + `useTranslation()` hook
- [ ] Taal opslaan in `localStorage`, default `nl`

### 4.2 Language switcher in header
- [ ] NL/EN toggle rechtsboven in header (alle modules)
- [ ] Visueel: vlag-iconen of "NL | EN" tekst toggle
- [ ] Wijziging direct toepassen (geen page reload)

### 4.3 Verpakkingsmodule vertalen
- [ ] Alle hardcoded Nederlandse strings → `t('key')` calls
- [ ] ~100 strings: knoppen, labels, titels, foutmeldingen, tooltips, placeholders
- [ ] Engelse vertalingen toevoegen
- [ ] Module-voor-module aanpak: VerpakkingsClient → BoxCard → ProductCard → ShipmentProgress → etc.

---

## Fase 5: Engine Intelligence (LATER — apart project)

> Wordt niet in deze ronde geïmplementeerd. Bewaard voor later.

- Combinatie-order learning: als order met dezelfde productset 3x dezelfde dozen-set krijgt → standaard adviseren
- 1000 nep-orders systeem: UI waar Kristoff echte orders kan klonen (nep klant/adres, echte producten) en juiste dozen kan configureren → engine leert direct
- Bestaande infra: `capacity_feedback` + `packaging_advice` + `box_capacities` tabellen zijn al actief en lerend
- Eurobox 40 fix + engine bug (te veel dozen bij 1 tag)
- Zie ook: `tasks/prompt-verpakking-engine-improvements.md` voor kokerdoos strapped + multi-product advies
