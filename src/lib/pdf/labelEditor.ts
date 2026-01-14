import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib'

/**
 * Carrier type for label positioning
 */
export type CarrierType = 'postnl' | 'dpd' | 'unknown'

/**
 * Position configuration for plant name on PostNL NL label
 * Middle-right area, avoiding barcode and address
 */
const POSTNL_NL_POSITION = {
  xPercent: 0.55,
  yPercent: 0.45,
  fontSize: 10,
  maxWidthPercent: 0.40,  // Avoid barcode on left
  maxLines: 2,
  lineHeight: 1.2,
}

/**
 * Position configuration for plant name on PostNL DE (Germany) label
 * To the right of the "EU" letters, ABOVE the barcode
 */
const POSTNL_DE_POSITION = {
  xPercent: 0.15,  // Right of the "EU" text
  yPercent: 0.70,  // Same row as "EU" text, above barcode
  fontSize: 10,
  maxWidthPercent: 0.45,  // Stop before barcode area
  maxLines: 2,
  lineHeight: 1.2,
}

/**
 * Position configuration for plant name on DPD label
 * Left side, in white space below Ref1 row
 */
const DPD_POSITION = {
  xPercent: 0.02,  // Left side, aligned with Ref1 area
  yPercent: 0.58,  // Below Ref1 line, in white space before routing barcode
  fontSize: 8,
  maxWidthPercent: 0.45,  // Stop before QR code area on right
  maxLines: 2,
  lineHeight: 1.2,
}

interface LabelEditOptions {
  xPercent?: number
  yPercent?: number
  fontSize?: number
  carrier?: CarrierType
  country?: string
}

/**
 * Wrap text to fit within a maximum width
 * @param text - The text to wrap
 * @param font - The PDF font to use for width calculation
 * @param fontSize - The font size
 * @param maxWidth - Maximum width in points
 * @returns Array of lines
 */
function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const width = font.widthOfTextAtSize(testLine, fontSize)

    if (width <= maxWidth) {
      currentLine = testLine
    } else {
      if (currentLine) lines.push(currentLine)
      // If a single word is too long, we still need to add it
      currentLine = word
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines
}

/**
 * Truncate lines to fit within max lines, adding ellipsis if needed
 * @param lines - Array of text lines
 * @param maxLines - Maximum number of lines allowed
 * @param font - The PDF font to use for width calculation
 * @param fontSize - The font size
 * @param maxWidth - Maximum width in points
 * @returns Truncated array of lines
 */
function truncateLines(
  lines: string[],
  maxLines: number,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  if (lines.length <= maxLines) return lines

  const result = lines.slice(0, maxLines)
  const lastLineIndex = maxLines - 1
  let lastLine = result[lastLineIndex]
  const ellipsis = '...'

  // Truncate last line to fit with ellipsis
  while (
    font.widthOfTextAtSize(lastLine + ellipsis, fontSize) > maxWidth &&
    lastLine.length > 0
  ) {
    lastLine = lastLine.slice(0, -1).trim()
  }

  result[lastLineIndex] = lastLine + ellipsis
  return result
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
 * Determine carrier type from shipment provider name or carrier key
 */
export function getCarrierFromProviderName(providerName: string | undefined): CarrierType {
  if (!providerName) return 'unknown'

  const normalized = providerName.toLowerCase()

  // Check for DPD variants
  if (normalized.includes('dpd')) {
    return 'dpd'
  }

  // Check for PostNL variants
  if (normalized.includes('postnl') || normalized.includes('post nl') || normalized.includes('post-nl')) {
    return 'postnl'
  }

  return 'unknown'
}

/**
 * Determine carrier type from multiple shipment fields
 * Checks all available fields for carrier identification
 */
export function detectCarrierFromShipment(shipment: {
  provider?: string
  providername?: string
  profile_name?: string
  carrier_key?: string
}): CarrierType {
  // Try each field in order of reliability
  const fieldsToCheck = [
    shipment.carrier_key,
    shipment.profile_name,
    shipment.providername,
    shipment.provider,
  ]

  for (const field of fieldsToCheck) {
    if (field) {
      const carrier = getCarrierFromProviderName(field)
      if (carrier !== 'unknown') {
        return carrier
      }
    }
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

  // Get position based on carrier type and country
  const country = options.country?.toUpperCase() || 'NL'
  let position: typeof POSTNL_NL_POSITION
  if (carrier === 'dpd') {
    position = DPD_POSITION
    console.log(`Using DPD label positioning for "${plantName}"`)
  } else if (carrier === 'postnl' && country === 'DE') {
    // PostNL Germany labels have different layout with "EU" text
    position = POSTNL_DE_POSITION
    console.log(`Using PostNL DE label positioning for "${plantName}"`)
  } else {
    // Default to PostNL NL positioning for unknown carriers or NL
    position = POSTNL_NL_POSITION
    console.log(`Using PostNL NL label positioning for "${plantName}"`)
  }

  // Use provided options or carrier-specific defaults
  const xPercent = options.xPercent ?? position.xPercent
  const yPercent = options.yPercent ?? position.yPercent
  const fontSize = options.fontSize ?? position.fontSize
  const maxWidthPercent = position.maxWidthPercent
  const maxLines = position.maxLines
  const lineHeight = position.lineHeight

  // Embed a standard font (Helvetica Bold for visibility)
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Calculate position and max width
  const x = width * xPercent
  const y = height * (1 - yPercent) // PDF coordinates start from bottom
  const maxWidth = width * maxWidthPercent

  // Wrap text to fit within max width
  let lines = wrapText(plantName, font, fontSize, maxWidth)

  // Truncate if too many lines
  lines = truncateLines(lines, maxLines, font, fontSize, maxWidth)

  // Draw each line with appropriate y-offset
  const lineSpacing = fontSize * lineHeight
  lines.forEach((line, index) => {
    firstPage.drawText(line, {
      x,
      y: y - index * lineSpacing,
      size: fontSize,
      font,
      color: rgb(0, 0, 0), // Black text
    })
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
