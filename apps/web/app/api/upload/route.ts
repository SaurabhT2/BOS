// app/api/upload/route.ts — fixed: validation, size limits, type guards, VLM analysis trigger
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase-server'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50 MB
const MAX_FILES = 20

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

export async function POST(req: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser()
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]

    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Maximum ${MAX_FILES} files per upload` }, { status: 400 })
    }

    const savedFiles: Array<{ name: string; path: string; size: number; type: string }> = []
    const errors: string[] = []
    const imageFilesForVLM: string[] = []

    for (const file of files) {
      // Validate type
      if (!ALLOWED_TYPES.has(file.type) && !file.type.startsWith('image/')) {
        errors.push(`${file.name}: unsupported type ${file.type || 'unknown'}`)
        continue
      }

      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: exceeds 50 MB limit`)
        continue
      }

      // Validate not empty
      if (file.size === 0) {
        errors.push(`${file.name}: file is empty`)
        continue
      }

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const filePath = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .upload(filePath, buffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })

      if (uploadError) {
        errors.push(`${file.name}: ${uploadError.message}`)
      } else {
        savedFiles.push({ name: file.name, path: filePath, size: file.size, type: file.type })

        // Track images for VLM analysis
        if (file.type.startsWith('image/') && file.size < 10 * 1024 * 1024) {
          imageFilesForVLM.push(filePath)
        }
      }
    }

    if (errors.length > 0 && savedFiles.length === 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      files: savedFiles.map(f => f.name),
      filePaths: savedFiles.map(f => f.path),
      errors: errors.length > 0 ? errors : undefined,
      imageCount: imageFilesForVLM.length,
      // Signal frontend to optionally trigger VLM analysis on images
      vlmSuggested: imageFilesForVLM.length > 0,
      vlmPaths: imageFilesForVLM,
    })
  } catch (error: any) {
    console.error('[upload/route]', error)
    return NextResponse.json({ error: error?.message || 'Upload failed' }, { status: 500 })
  }
}


