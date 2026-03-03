import { supabase } from '@/lib/supabase/client'
import { combinePdfs } from './labelEditor'

const CHUNK_SIZE = 10

/**
 * Download completed label PDFs from Supabase Storage and combine them
 * in chunks to limit peak memory usage and prevent timeouts.
 *
 * Downloads in parallel batches of 10, combines each batch into an
 * intermediate PDF, then merges all intermediates into the final PDF.
 */
export async function combineLabelsFromStorage(
  labels: Array<{ edited_label_path: string | null }>,
  batchId: string,
): Promise<Buffer | null> {
  const validLabels = labels.filter(l => l.edited_label_path)

  if (validLabels.length === 0) {
    console.log(`[${batchId}] No labels with PDF paths to combine`)
    return null
  }

  console.log(`[${batchId}] Combining ${validLabels.length} PDFs in chunks of ${CHUNK_SIZE}...`)

  const intermediateBuffers: Buffer[] = []

  for (let i = 0; i < validLabels.length; i += CHUNK_SIZE) {
    const chunk = validLabels.slice(i, i + CHUNK_SIZE)
    const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1
    const totalChunks = Math.ceil(validLabels.length / CHUNK_SIZE)

    console.log(`[${batchId}] Downloading chunk ${chunkIndex}/${totalChunks} (${chunk.length} PDFs)...`)

    // Download chunk in parallel
    const downloads = await Promise.allSettled(
      chunk.map(async (label) => {
        const url = new URL(label.edited_label_path!)
        const pathParts = url.pathname.split('/storage/v1/object/public/shipment-labels/')
        const filePath = pathParts[1]
        if (!filePath) return null

        const { data, error } = await supabase.storage.from('shipment-labels').download(filePath)
        if (error || !data) {
          console.error(`[${batchId}] Error downloading PDF ${filePath}:`, error)
          return null
        }

        return Buffer.from(await data.arrayBuffer())
      })
    )

    const chunkBuffers: Buffer[] = []
    for (const result of downloads) {
      if (result.status === 'fulfilled' && result.value) {
        chunkBuffers.push(result.value)
      }
    }

    if (chunkBuffers.length > 0) {
      // Combine this chunk into an intermediate PDF
      const chunkPdf = await combinePdfs(chunkBuffers)
      intermediateBuffers.push(chunkPdf)
      console.log(`[${batchId}] Chunk ${chunkIndex}/${totalChunks} combined (${chunkBuffers.length} PDFs)`)
    }
  }

  if (intermediateBuffers.length === 0) {
    console.error(`[${batchId}] No PDFs could be downloaded for combining`)
    return null
  }

  // Single chunk — no need to re-combine
  if (intermediateBuffers.length === 1) {
    return intermediateBuffers[0]
  }

  // Merge all intermediate PDFs into final
  console.log(`[${batchId}] Merging ${intermediateBuffers.length} chunks into final PDF...`)
  return combinePdfs(intermediateBuffers)
}
