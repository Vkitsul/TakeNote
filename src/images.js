// Cache of images (snips) loaded from the "files" store.
import * as db from './db.js'
import { uid } from './util.js'

const cache = new Map() // fileId -> ImageBitmap | Promise | 'missing'
const listeners = new Set()

export function onImageLoad(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

async function load(id) {
  try {
    const rec = await db.get('files', id)
    if (!rec?.blob) {
      cache.set(id, 'missing')
      return null
    }
    const bmp = await createImageBitmap(rec.blob)
    cache.set(id, bmp)
    for (const fn of listeners) fn(id)
    return bmp
  } catch (e) {
    console.warn('Image not loaded', id, e)
    cache.set(id, 'missing')
    return null
  }
}

// Returns the bitmap right away if ready, otherwise starts loading it and returns null.
export function getImage(id) {
  const v = cache.get(id)
  if (v === undefined) {
    cache.set(id, load(id))
    return null
  }
  return v instanceof ImageBitmap ? v : null
}

export async function ensureImage(id) {
  const v = cache.get(id)
  if (v instanceof ImageBitmap) return v
  if (v === 'missing') return null
  if (v) return v
  const p = load(id)
  cache.set(id, p)
  return p
}

// Saves an image blob as a file and caches it.
export async function storeImageBlob(blob) {
  const id = uid()
  await db.put('files', { id, blob, type: blob.type, createdAt: Date.now() })
  try {
    cache.set(id, await createImageBitmap(blob))
  } catch {
    /* loaded on first request */
  }
  return id
}

export async function getFileBlob(id) {
  const rec = await db.get('files', id)
  return rec?.blob || null
}
