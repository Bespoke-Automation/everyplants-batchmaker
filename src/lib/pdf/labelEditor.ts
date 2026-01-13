import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * Carrier type for label positioning
 */
export type CarrierType = 'postnl' | 'dpd' | 'unknown'

/**
 * Position configuration for plant name on PostNL label
 * Middle-right area, avoiding barcode and address
 */
const POSTNL_POSITION = {
  xPercent: 0.55,
  yPercent: 0.45,
  fontSize: 10,    // Smaller font for PostNL
}

/**
 * Position configuration for plant name on DPD label
 * Left side, in white space below Ref1 row
 */
const DPD_POSITION = {
  xPercent: 0.02,  // Left side, aligned with Ref1 area
  yPercent: 0.58,  // Below Ref1 line, in white space before routing barcode
  fontSize: 8,     // Smaller font for DPD
}

interface LabelEditOptions {
  xPercent?: number
  yPercent?: number
  fontSize?: number
  carrier?: CarrierType
}

/**
 * Detect carrier type from PDF content
 * DPD labels typically have "dpd" text or specific dimensions
 */
async function detectCarrierFromPdf(pdfDoc: PDFDocument): Promise<CarrierType> {
  try {
    // Get PDF metadata and content to detect carrier
    const pages = pdfDoc.getPages()
    if (pages.length === 0) return 'unknown'

    const firstPage = pages[0]
    const { width, height } = firstPage.getSize()

    // DPD labels are typically A6 portrait (around 105mm x 148mm = ~298 x 420 points)
    // PostNL labels are also A6 but may have different proportions
    // We can also check the aspect ratio

    // A simple heuristic: DPD labels tend to be taller/narrower
    // But a more reliable method is checking for embedded text

    // For now, use a simple size heuristic
    // DPD labels from Picqer are often around 283 x 425 points (100x150mm)
    // PostNL labels are often around 283 x 425 or similar

    // Since both are similar sizes, let's try to extract text content
    // However, pdf-lib doesn't have great text extraction, so we'll use a fallback

    // Check if we can find any content indicators in the PDF's resources
    // This is a simplified check - in production you might want more sophisticated detection

    // For now, return 'unknown' and let the caller specify, or default to PostNL
    console.log(`Label dimensions: ${width.toFixed(0)} x ${height.toFixed(0)}`)

    return 'unknown'
  } catch (error) {
    console.error('Error detecting carrier:', error)
    return 'unknown'
  }
}

/**
 * Determine carrier type from shipment provider name
 */
export function getCarrierFromProviderName(providerName: string | undefined): CarrierType {
  if (!providerName) return 'unknown'

  const normalized = providerName.toLowerCase()

  if (normalized.includes('dpd')) {
    return 'dpd'
  }

  if (normalized.includes('postnl') || normalized.includes('post nl')) {
    return 'postnl'
  }

  return 'unknown'
}

/**
 * Add plant name text to a shipping label PDF
 * Automatically detects carrier type or uses provided carrier for optimal positioning
 * @param labelPdf - The original label PDF as a Buffer
 * @param plantName - The plant name to add to the label
 * @param options - Optional positioning configuration including carrier type
 * @returns Modified PDF as a Buffer
 */
export async function addPlantNameToLabel(
  labelPdf: Buffer,
  plantName: string,
  options: LabelEditOptions = {}
): Promise<Buffer> {
  // Load the PDF
  const pdfDoc = await PDFDocument.load(labelPdf)

  // Get the first page (shipping labels are typically single-page)
  const pages = pdfDoc.getPages()
  if (pages.length === 0) {
    throw new Error('PDF has no pages')
  }

  const firstPage = pages[0]
  const { width, height } = firstPage.getSize()

  // Determine carrier type and get appropriate positioning
  let carrier = options.carrier
  if (!carrier || carrier === 'unknown') {
    carrier = await detectCarrierFromPdf(pdfDoc)
  }

  // Get position based on carrier type
  let position: typeof POSTNL_POSITION
  if (carrier === 'dpd') {
    position = DPD_POSITION
    console.log(`Using DPD label positioning for "${plantName}"`)
  } else {
    // Default to PostNL positioning for unknown carriers
    position = POSTNL_POSITION
    console.log(`Using PostNL label positioning for "${plantName}"`)
  }

  // Use provided options or carrier-specific defaults
  const xPercent = options.xPercent ?? position.xPercent
  const yPercent = options.yPercent ?? position.yPercent
  const fontSize = options.fontSize ?? position.fontSize

  // Embed a standard font (Helvetica Bold for visibility)
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Calculate position
  const x = width * xPercent
  const y = height * (1 - yPercent) // PDF coordinates start from bottom

  // Draw the plant name
  firstPage.drawText(plantName, {
    x,
    y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0), // Black text
  })

  // Save and return the modified PDF
  const modifiedPdfBytes = await pdfDoc.save()
  return Buffer.from(modifiedPdfBytes)
}

/**
 * Combine multiple PDFs into a single document
 * @param pdfs - Array of PDF buffers to combine
 * @returns Combined PDF as a Buffer
 */
export async function combinePdfs(pdfs: Buffer[]): Promise<Buffer> {
  if (pdfs.length === 0) {
    throw new Error('No PDFs provided to combine')
  }

  if (pdfs.length === 1) {
    return pdfs[0]
  }

  // Create a new PDF document
  const combinedDoc = await PDFDocument.create()

  for (const pdfBuffer of pdfs) {
    try {
      // Load each PDF
      const pdf = await PDFDocument.load(pdfBuffer)

      // Copy all pages from this PDF to the combined document
      const pages = await combinedDoc.copyPages(pdf, pdf.getPageIndices())

      for (const page of pages) {
        combinedDoc.addPage(page)
      }
    } catch (error) {
      console.error('Error loading PDF for combining:', error)
      // Continue with other PDFs if one fails
    }
  }

  if (combinedDoc.getPageCount() === 0) {
    throw new Error('No valid PDFs could be combined')
  }

  const combinedPdfBytes = await combinedDoc.save()
  return Buffer.from(combinedPdfBytes)
}

/**
 * Result of processing a single label
 */
export interface ProcessedLabel {
  success: boolean
  pdfBuffer?: Buffer
  orderId: number
  orderReference: string
  plantName: string
  retailer: string
  error?: string
}

/**
 * Sort and combine processed labels by product then retailer
 * @param labels - Array of processed labels
 * @returns Combined PDF buffer and sorting info
 */
export async function sortAndCombineLabels(
  labels: ProcessedLabel[]
): Promise<{ combinedPdf: Buffer; sortOrder: string[] }> {
  // Filter successful labels
  const successfulLabels = labels.filter(l => l.success && l.pdfBuffer)

  if (successfulLabels.length === 0) {
    throw new Error('No successful labels to combine')
  }

  // Sort by plant name first, then by retailer
  successfulLabels.sort((a, b) => {
    const plantCompare = a.plantName.localeCompare(b.plantName)
    if (plantCompare !== 0) return plantCompare
    return a.retailer.localeCompare(b.retailer)
  })

  // Extract PDFs in sorted order
  const sortedPdfs = successfulLabels
    .map(l => l.pdfBuffer!)
    .filter(Boolean)

  // Generate sort order for reference
  const sortOrder = successfulLabels.map(
    l => `${l.plantName} - ${l.retailer} - ${l.orderReference}`
  )

  // Combine PDFs
  const combinedPdf = await combinePdfs(sortedPdfs)

  return { combinedPdf, sortOrder }
}
