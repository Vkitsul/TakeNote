// Backup/ripristino in un file .takenote (zip): quaderni, pagine, PDF, snip, cartelle.
import { Zip, ZipDeflate, ZipPassThrough, unzipSync, strToU8, strFromU8 } from 'fflate'
import * as db from './db.js'

function f32ToB64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}

function b64ToF32(b64) {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return new Float32Array(u8.buffer)
}

function encodePage(p) {
  return { ...p, items: p.items.map((it) => (it.t === 's' ? { ...it, pts: f32ToB64(it.pts) } : it)) }
}

function decodePage(p) {
  return { ...p, items: p.items.map((it) => (it.t === 's' ? { ...it, pts: b64ToF32(it.pts) } : it)) }
}

// Scrive il backup a pezzi: write(chunk: Uint8Array) viene chiamata in ordine (anche async).
// Così anche una libreria con molti PDF non deve stare tutta in memoria. notebookIds: null = tutto.
export async function writeBackup(write, notebookIds = null, onProgress) {
  let notebooks = await db.all('notebooks')
  if (notebookIds) notebooks = notebooks.filter((n) => notebookIds.includes(n.id))
  const folders = await db.all('folders')
  const snips = notebookIds ? [] : await db.all('snips')
  const fileIds = new Set(snips.map((s) => s.fileId))

  const queue = []
  let zipError = null
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err
    else if (chunk && chunk.length) queue.push(chunk)
  })
  const flush = async () => {
    if (zipError) throw zipError
    while (queue.length) await write(queue.shift())
  }
  const add = async (name, data, store = false) => {
    const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 })
    zip.add(f)
    f.push(data, true)
    await flush()
  }

  let done = 0
  for (const nb of notebooks) {
    const pages = await db.byIndex('pages', 'notebookId', nb.id)
    for (const p of pages) {
      if (p.pdf) fileIds.add(p.pdf.f)
      for (const it of p.items) if (it.t === 'i') fileIds.add(it.f)
      await add(`pages/${p.id}.json`, strToU8(JSON.stringify(encodePage(p))))
    }
    done++
    onProgress?.((done / Math.max(1, notebooks.length)) * 0.4)
  }
  const filesMeta = []
  let k = 0
  for (const id of fileIds) {
    const rec = await db.get('files', id)
    k++
    if (!rec?.blob) continue
    filesMeta.push({ id, type: rec.type || rec.blob.type, name: rec.name || '', createdAt: rec.createdAt || 0 })
    await add(`files/${id}`, new Uint8Array(await rec.blob.arrayBuffer()), true)
    onProgress?.(0.4 + (k / fileIds.size) * 0.55)
  }
  const manifest = {
    app: 'TakeNote',
    version: 1,
    exportedAt: Date.now(),
    notebooks: notebooks.map(({ thumb, ...n }) => n),
    folders,
    snips,
    files: filesMeta,
  }
  await add('manifest.json', strToU8(JSON.stringify(manifest)))
  zip.end()
  await flush()
  onProgress?.(1)
  return { notebooks: notebooks.length, files: filesMeta.length }
}

// Backup in memoria (browser e backup di un singolo quaderno).
export async function createBackup(notebookIds = null, onProgress) {
  const parts = []
  await writeBackup(async (c) => parts.push(c), notebookIds, onProgress)
  return new Blob(parts, { type: 'application/zip' })
}

// "Impronta" dei dati: cambia quando si modifica qualcosa, per non rifare backup identici.
export async function dataSignature() {
  const [notebooks, snips, folders] = await Promise.all([db.all('notebooks'), db.all('snips'), db.all('folders')])
  const maxNb = notebooks.reduce((m, n) => Math.max(m, n.updatedAt || 0), 0)
  const maxSnip = snips.reduce((m, s) => Math.max(m, s.createdAt || 0), 0)
  return [notebooks.length, maxNb, snips.length, maxSnip, folders.map((f) => f.id + f.name).join('|')].join(';')
}

export async function restoreBackup(file, onProgress) {
  const data = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const mf = data['manifest.json']
  if (!mf) throw new Error('File di backup non valido')
  const manifest = JSON.parse(strFromU8(mf))
  if (manifest.app !== 'TakeNote') throw new Error('File di backup non valido')
  const files = manifest.files || []
  let i = 0
  for (const f of files) {
    const bytes = data[`files/${f.id}`]
    if (bytes) await db.put('files', { id: f.id, blob: new Blob([bytes], { type: f.type }), type: f.type, name: f.name, createdAt: f.createdAt })
    onProgress?.((++i / Math.max(1, files.length)) * 0.5)
  }
  const pages = []
  for (const name in data) {
    if (name.startsWith('pages/')) pages.push(decodePage(JSON.parse(strFromU8(data[name]))))
  }
  await db.putMany('pages', pages)
  onProgress?.(0.8)
  await db.putMany('folders', manifest.folders || [])
  await db.putMany('snips', manifest.snips || [])
  await db.putMany('notebooks', (manifest.notebooks || []).map((n) => ({ ...n, thumb: null })))
  onProgress?.(1)
  return { notebooks: (manifest.notebooks || []).length }
}

// Elimina i file non più usati da nessuna pagina o snip.
export async function collectGarbage() {
  const used = new Set()
  for (const s of await db.all('snips')) used.add(s.fileId)
  for (const p of await db.all('pages')) {
    if (p.pdf) used.add(p.pdf.f)
    for (const it of p.items) if (it.t === 'i') used.add(it.f)
  }
  const keys = await db.allKeys('files')
  const orphans = keys.filter((k) => !used.has(k))
  await db.delMany('files', orphans)
  return orphans.length
}
