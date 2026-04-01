/**
 * Dutch dictionary — source of truth for all translations.
 * English dictionary (en.ts) must match this structure exactly.
 */
const nl = {
  common: {
    loading: 'Laden...',
    save: 'Opslaan',
    cancel: 'Annuleren',
    close: 'Sluiten',
    delete: 'Verwijderen',
    confirm: 'Bevestigen',
    search: 'Zoeken',
    retry: 'Opnieuw',
    back: 'Terug',
    next: 'Volgende',
    done: 'Klaar',
    error: 'Fout',
    yes: 'Ja',
    no: 'Nee',
    of: 'van',
    products: 'producten',
    product: 'product',
    gram: 'gram',
    kg: 'kg',
    noResults: 'Geen resultaten',
  },
  layout: {
    queue: 'Wachtrij',
    history: 'Geschiedenis',
    engineLog: 'Engine Log',
    dashboard: 'Dashboard',
    settings: 'Instellingen',
    comments: 'Opmerkingen',
    logout: 'Uitloggen',
    portal: 'Portal',
  },
  worker: {
    title: 'Medewerker selecteren',
    selectWorker: 'Selecteer medewerker',
    noWorkers: 'Geen medewerkers gevonden',
  },
  queue: {
    title: 'Wachtrij',
    openBatches: 'Open batches',
    noBatches: 'Geen open batches',
    claim: 'Claimen',
    picklists: 'picklijsten',
    orders: 'orders',
  },
  batch: {
    overview: 'Batch overzicht',
    picklists: 'Picklijsten',
    startPicklist: 'Start picklijst',
    allCompleted: 'Alle picklijsten afgerond',
    backToBatch: 'Terug naar batch',
  },
  packing: {
    // Header
    productsAssigned: 'producten toegewezen',
    sessionInfo: 'Sessie info',
    shipAll: 'Alles verzenden',
    closePicklist: 'Picklijst sluiten',
    closePicklistConfirm: 'Weet je zeker dat je deze picklijst wilt sluiten? Dit kan niet ongedaan gemaakt worden.',

    // Tabs
    productsTab: 'Producten',
    boxesTab: 'Dozen',

    // Product card
    assignToBox: 'Toewijzen aan doos',
    removeFromBox: 'Verwijder uit doos',
    remaining: 'resterend',
    assigned: 'toegewezen',
    distributed: 'verdeeld',
    howMany: 'Hoeveel stuks?',
    assignAll: 'Alle producten toewijzen',
    assignRemaining: 'Alle resterende producten hierin',

    // Box card
    closeBox: 'Doos afsluiten',
    reopenBox: 'Heropenen',
    removeBox: 'Verwijder doos',
    createShipment: 'Maak zending',
    shipped: 'Verzonden',
    closed: 'Afgesloten',
    open: 'Open',
    weight: 'Gewicht',
    dragProducts: 'Sleep producten hierheen',
    dropToAdd: 'Laat los om toe te voegen',
    dragMore: '+ Sleep meer producten',
    noPicqerId: 'Geen Picqer ID — zending niet mogelijk',
    cancelShipment: 'Annuleer',

    // Add box modal
    addBox: 'Doos toevoegen',
    searchPackaging: 'Zoek verpakking...',
    suggested: 'Aanbevolen',
    allPackagings: 'Alle verpakkingen',
    showAll: 'Toon alle verpakkingen',
    noPackagings: 'Geen verpakkingen gevonden',

    // Completed state
    completedBanner: 'Verzonden — deze picklijst is al ingepakt en verzonden',
    nextOrder: 'Volgende order',
    goToNext: 'Ga naar volgende openstaande',

    // Sidebar
    delivery: 'Bezorging',
    details: 'Details',
    shipments: 'Zendingen',
    editAddress: 'Adres wijzigen',
    editAddressTitle: 'Afleveradres bewerken',
    noDeliveryInfo: 'Geen bezorggegevens beschikbaar',
    name: 'Naam',
    contactPerson: 'Contactpersoon',
    address: 'Adres',
    zipCode: 'Postcode',
    city: 'Stad',
    country: 'Land',
    shippingProfile: 'Verzendprofiel',

    // Barcode
    scanFeedback: 'Scan feedback',

    // Engine
    engineAdvice: 'Engine advies',
    fullMatch: 'Advies',
    partialMatch: 'Gedeeltelijk advies',
    noMatch: 'Geen advies',
  },
  shipment: {
    title: 'Zendingen maken',
    shippingProfile: 'Verzendprofiel',
    change: 'Wijzig',
    packages: 'Aantal pakketten',
    box: 'Doos',
    noStationWarning: 'Geen werkstation geselecteerd. Labels worden niet automatisch geprint.',
    createSingle: 'Zending maken',
    createMultiple: 'Zendingen maken',
    allShipped: 'Alle zendingen aangemaakt',
    picklistClosed: 'Picklist is afgesloten in Picqer',
    printLabels: 'Labels printen',
    changeSettings: 'Instellingen wijzigen',
    nextOrder: 'Volgende order',
    shipped: 'Verzonden',
    labelCreated: 'Label aangemaakt',
    creating: 'Zending aanmaken...',
    fetchingLabel: 'Label ophalen...',
    waiting: 'Wachten...',
    failed: 'Fout',
    shippedCount: 'dozen verzonden',
    allBoxesShipped: 'Alle dozen verzonden!',
    noBoxes: 'Geen afgesloten dozen om te verzenden',
    noMethods: 'Geen verzendmethoden beschikbaar voor deze picklist. Controleer de instellingen in Picqer.',
    fetchingMethods: 'Verzendmethoden ophalen...',
    selectMethod: 'Kies een verzendmethode',
    recommended: 'Aanbevolen',
    default: 'Standaard',
    noMethodsFound: 'Geen methoden gevonden',
    searchMethod: 'Zoek verzendmethode...',
    shipmentCancelled: 'Zending geannuleerd',
  },
  comments: {
    title: 'Opmerkingen',
    allComments: 'Alle opmerkingen',
    myComments: 'Mijn opmerkingen',
    noComments: 'Geen opmerkingen',
    noMyComments: 'Je hebt nog geen opmerkingen geplaatst',
    noMentions: 'Niemand heeft je gementioned',
    reply: 'Reageren',
    replyPlaceholder: 'Schrijf een reactie...',
    markDone: 'Afvinken',
    markOpen: 'Heropenen',
    resolved: 'Afgerond',
    noResolved: 'Geen afgeronde opmerkingen',
    noWorker: 'Geen medewerker geselecteerd',
    noWorkerHint: 'Selecteer eerst een medewerker in de wachtrij om opmerkingen te bekijken.',
    at: 'bij',
    picklist: 'Picklijst',
    order: 'Order',
    batch: 'batch',
    justNow: 'zojuist',
    minutesAgo: 'min geleden',
    hoursAgo: 'uur geleden',
    yesterday: 'gisteren',
    daysAgo: 'dagen geleden',
  },
} as const

export default nl

// Recursive type that converts all literal string values to `string`
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>
}

export type Dictionary = DeepStringify<typeof nl>
