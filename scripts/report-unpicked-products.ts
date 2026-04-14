/* eslint-disable no-console */
// Rapport: welke producten op de 8 openstaande picklists zijn nog niet volledig gepickt in Picqer.
// Laat SKU, productnaam en aantallen zien.

import { fetchPicklist } from '@/lib/picqer/client'

const PICKLIST_IDS: { picklistid: string; id: number; order: number; reference: string }[] = [
  { picklistid: 'P2026-27669', id: 176831083, order: 252117613, reference: 'EVP/OUT/10159' },
  { picklistid: 'P2026-27750', id: 176846150, order: 252141195, reference: 'EVP/OUT/10276' },
  { picklistid: 'P2026-28589', id: 177079763, order: 252157684, reference: '' },
  { picklistid: 'P2026-28592', id: 177079770, order: 252171148, reference: '' },
  { picklistid: 'P2026-28657', id: 177094543, order: 252178396, reference: '' },
  { picklistid: 'P2026-28660', id: 177094548, order: 252182811, reference: '' },
  { picklistid: 'P2026-28728', id: 177114347, order: 252286860, reference: '' },
  { picklistid: 'P2026-30136', id: 177497375, order: 253139387, reference: '' },
]

async function main() {
  for (const entry of PICKLIST_IDS) {
    const p = await fetchPicklist(entry.id)
    const ref = p.reference || entry.reference
    console.log('\n' + '═'.repeat(100))
    console.log(`${entry.picklistid}   order=${entry.order}   ref=${ref}   picked=${p.totalpicked}/${p.totalproducts}`)
    console.log('─'.repeat(100))

    // Separate fully-picked, partially-picked, not-picked
    type Prod = typeof p.products[number]
    const unpicked: Prod[] = []
    const partial: Prod[] = []

    for (const prod of p.products) {
      const picked = prod.amountpicked ?? 0
      if (picked === 0 && prod.amount > 0) unpicked.push(prod)
      else if (picked < prod.amount) partial.push(prod)
    }

    if (unpicked.length === 0 && partial.length === 0) {
      console.log('Alle producten volledig gepickt — alleen close nodig')
      continue
    }

    console.log('SKU'.padEnd(14) + 'Naam'.padEnd(50) + 'Gevraagd'.padEnd(10) + 'Gepickt'.padEnd(9) + 'Mist  Comp?')
    for (const prod of [...unpicked, ...partial]) {
      const picked = prod.amountpicked ?? 0
      const mist = prod.amount - picked
      const comp = prod.has_parts ? '(composition parent)' : prod.partof_idpicklist_product ? '(comp part)' : ''
      const name = (prod.name || '').slice(0, 48)
      console.log(
        String(prod.productcode || '').padEnd(14) +
        name.padEnd(50) +
        String(prod.amount).padEnd(10) +
        String(picked).padEnd(9) +
        String(mist).padEnd(6) +
        comp,
      )
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
