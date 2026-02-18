import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packagings/upload-image
 * Upload a packaging image to Supabase Storage and save the URL
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const idpackaging = formData.get('idpackaging') as string | null

    if (!file || !idpackaging) {
      return NextResponse.json(
        { error: 'Missing required fields: file, idpackaging' },
        { status: 400 }
      )
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      )
    }

    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File is too large (max 5MB)' },
        { status: 400 }
      )
    }

    // Generate a clean filename
    const ext = file.name.split('.').pop() || 'jpg'
    const filePath = `${idpackaging}/image.${ext}`

    // Convert to buffer for upload
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage (upsert to overwrite existing)
    const { error: uploadError } = await supabase.storage
      .from('packaging-images')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('[verpakking] Error uploading packaging image:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload image', details: uploadError.message },
        { status: 500 }
      )
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('packaging-images')
      .getPublicUrl(filePath)

    const imageUrl = urlData.publicUrl

    // Update the packaging record with the image URL
    const { error: updateError } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .update({ image_url: imageUrl })
      .eq('idpackaging', parseInt(idpackaging, 10))

    if (updateError) {
      console.error('[verpakking] Error updating packaging image_url:', updateError)
      return NextResponse.json(
        { error: 'Image uploaded but failed to update record', details: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ imageUrl })
  } catch (error) {
    console.error('[verpakking] Error in upload-image:', error)
    return NextResponse.json(
      { error: 'Failed to upload image', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/packagings/upload-image
 * Remove a packaging image
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { idpackaging } = body

    if (!idpackaging) {
      return NextResponse.json(
        { error: 'Missing required field: idpackaging' },
        { status: 400 }
      )
    }

    // List files in the packaging folder to find and delete them
    const { data: files } = await supabase.storage
      .from('packaging-images')
      .list(String(idpackaging))

    if (files && files.length > 0) {
      const filePaths = files.map((f) => `${idpackaging}/${f.name}`)
      await supabase.storage
        .from('packaging-images')
        .remove(filePaths)
    }

    // Clear the image_url in the database
    const { error: updateError } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .update({ image_url: null })
      .eq('idpackaging', idpackaging)

    if (updateError) {
      console.error('[verpakking] Error clearing packaging image_url:', updateError)
      return NextResponse.json(
        { error: 'Failed to clear image URL', details: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking] Error in delete-image:', error)
    return NextResponse.json(
      { error: 'Failed to delete image', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
