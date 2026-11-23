// PDF loading and rendering with pdf.js, through a priority queue.
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as db from './db.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
const ASSETS = new URL('./pdfjs/', document.baseURI).href

export function openPdfData(data) {
  return pdfjsLib.getDocument({
    data,
    cMapUrl: ASSETS + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: ASSETS + 'standard_fonts/',
    isEvalSupported: false,
  }).promise
}

const docs = new Map()
export function getDoc(fileId) {
  let p = docs.get(fileId)
  if (!p) {
    p = (async () => {
      const rec = await db.get('files', fileId)
      if (!rec?.blob) throw new Error('PDF mancante')
      return openPdfData(new Uint8Array(await rec.blob.arrayBuffer()))
    })()
    docs.set(fileId, p)
    p.catch(() => docs.delete(fileId))
  }
  return p
}

const pages = new Map()
export function getPdfPage(fileId, index) {
  const key = fileId + ':' + index
  let p = pages.get(key)
  if (!p) {
    p = getDoc(fileId).then((d) => d.getPage(index + 1))
    pages.set(key, p)
    p.catch(() => pages.delete(key))
  }
  return p
}

// Reads the size and transform of every page (viewport coordinates at scale 1).
export async function readPdfPages(doc, onProgress) {
  const out = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    out.push({ w: vp.width, h: vp.height, t: Array.from(vp.transform) })
    onProgress?.(i / doc.numPages)
  }
  return out
}

// pdf.js draws on the main thread in chunks: while the user writes, the chunks wait,
// so they never take time from pen input.
let paused = false
const waiting = []
export function setPdfRenderPaused(v) {
  paused = v
  if (!v) for (const go of waiting.splice(0)) go()
}

// While the page scrolls the chunks are spaced out: the PDF still arrives, without stutter.
let slow = false
export function setPdfRenderSlow(v) {
  slow = v
}

// --- Render queue: lower priority = more urgent ---
const queue = []
let running = 0
const MAX_CONCURRENT = 2

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    queue.sort((a, b) => a.prio - b.prio)
    const job = queue.shift()
    if (job.cancelled) continue
    running++
    job.run().finally(() => {
      running--
      pump()
    })
  }
}

/**
 * Draws `region` (page units) of the PDF page `ref` = {f, i} onto a new canvas at `res` px/unit.
 * Returns { canvas, promise, cancel, setPriority }.
 */
export function renderPdfRegion(ref, res, region, prio = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(region.w * res))
  canvas.height = Math.max(1, Math.ceil(region.h * res))
  let task = null
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  const job = {
    prio,
    cancelled: false,
    run: async () => {
      try {
        if (job.cancelled) throw new Error('cancelled')
        const page = await getPdfPage(ref.f, ref.i)
        if (job.cancelled) throw new Error('cancelled')
        const sx = canvas.width / region.w
        const sy = canvas.height / region.h
        const vp = page.getViewport({ scale: 1 })
        task = page.render({
          canvasContext: canvas.getContext('2d'),
          viewport: vp,
          transform: [sx, 0, 0, sy, -region.x * sx, -region.y * sy],
          annotationMode: pdfjsLib.AnnotationMode.ENABLE,
        })
        task.onContinue = (go) => {
          if (paused) waiting.push(go)
          else if (slow) setTimeout(go, 24)
          else go()
        }
        await task.promise
        resolve(canvas)
      } catch (e) {
        reject(e)
      }
    },
  }
  queue.push(job)
  pump()
  return {
    canvas,
    promise,
    cancel() {
      job.cancelled = true
      task?.cancel()
    },
    setPriority(p) {
      job.prio = p
    },
  }
}

export function isCancel(e) {
  return e?.name === 'RenderingCancelledException' || e?.message === 'cancelled'
}

export function forgetPdf(fileId) {
  const p = docs.get(fileId)
  docs.delete(fileId)
  for (const k of [...pages.keys()]) if (k.startsWith(fileId + ':')) pages.delete(k)
  p?.then((d) => d.destroy()).catch(() => {})
}
