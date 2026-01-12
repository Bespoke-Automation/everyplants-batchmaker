import { Preset } from '@/types/preset'

export const RETAILERS = [
  'Green Bubble',
  'Everspring',
  'Ogreen',
  'Florafy',
  'Trendyplants',
  'Plantura',
]

export const TAGS = [
  '10. Fold box 100',
  '7. Tupe box 100 cm',
  'Box Plantura Save me 12pcs',
  '15. Open box (colli)',
  '12. Fold box 160',
  'Box Plantura Single big',
  '2. Eurobox 60',
  '13. Fold box 180',
  '14. Sale box 170',
]

// Country code to display name mapping
export const COUNTRY_NAMES: Record<string, string> = {
  'NL': 'Nederland',
  'DE': 'Duitsland',
  'FR': 'Frankrijk',
  'BE': 'België',
  'LU': 'Luxemburg',
  'ES': 'Spanje',
  'IT': 'Italië',
  'SE': 'Zweden',
  'AT': 'Oostenrijk',
  'Overig': 'Overig',
}

export const COUNTRIES = ['NL', 'DE', 'FR', 'BE', 'LU', 'ES', 'IT', 'SE', 'AT', 'Overig']

export const DAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag', 'Geen leverdag']

export const PRESETS: Preset[] = [
  {
    id: '1',
    naam: 'De Rooy Dinsdag Leveren',
    retailer: ['Green Bubble', 'Everspring', 'Ogreen'],
    tags: ['15. Open box (colli)', '16. HEU (Half pallet)', '17. EWP (Euro Disposable Pallet)', '18. BLOK (Blok pallet)'],
    bezorgland: ['NL', 'BE'],
    leverdag: ['dinsdag'],
    pps: false,
  },
  {
    id: '2',
    naam: 'De Rooy Dinsdag Leveren PPS',
    retailer: ['Green Bubble', 'Everspring', 'Ogreen'],
    tags: ['15. Open box (colli)', '16. HEU (Half pallet)', '17. EWP (Euro Disposable Pallet)', '18. BLOK (Blok pallet)'],
    bezorgland: ['NL', 'BE'],
    leverdag: ['dinsdag'],
    pps: true,
  },
  {
    id: '3',
    naam: 'NL Vrijdag Leveren',
    retailer: ['Green Bubble'],
    tags: [
      '1. Surprise box',
      '10. Fold box 100',
      '11. Fold box 130',
      '12. Fold box 160',
      '14. Sale box 170',
      '13. Fold box 180',
      '19. 2x Surprise box (strapped)',
      '2. Eurobox 60',
      '28. Tupe box 60',
      '3. Eurobox 40',
      '5. Tupe box potsize 12',
      '6. Tupe box potsize 15',
      '7. Tupe box 100 cm',
      '9. Tupe box 130 cm big',
      '8. Tupe box 130 cm small',
    ],
    bezorgland: ['NL'],
    leverdag: ['vrijdag'],
    pps: false,
  },
  {
    id: '4',
    naam: 'PostNL Woensdag leveren',
    retailer: ['Green Bubble', 'Everspring'],
    tags: [
      '1. Surprise box',
      '10. Fold box 100',
      '11. Fold box 130',
      '12. Fold box 160',
      '13. Fold box 180',
      '14. Sale box 170',
      '19. 2x Surprise box (strapped)',
      '2. Eurobox 60',
      '28. Tupe box 60',
      '3. Eurobox 40',
      '5. Tupe box potsize 12',
      '6. Tupe box potsize 15',
      '7. Tupe box 100 cm',
      '8. Tupe box 130 cm small',
      '9. Tupe box 130 cm big',
    ],
    bezorgland: ['NL'],
    leverdag: ['woensdag'],
    pps: false,
  },
  {
    id: '5',
    naam: 'Sale Box DE + FR',
    retailer: ['Green Bubble', 'Everspring'],
    tags: ['14. Sale box 170'],
    bezorgland: ['DE', 'FR'],
    leverdag: ['Geen leverdag'],
    pps: false,
  },
]
