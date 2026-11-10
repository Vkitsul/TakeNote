// Miniature delle pagine (pannello pagine e copertine della libreria).
import { drawItems } from './ink.js'
import { drawTemplate } from './templates.js'
import { renderPdfRegion, isCancel } from './pdfdoc.js'
import { ensureImage } from './images.js'

const cache = new Map() // pageId -> { version, canvas }

export async function renderPageThumb(page, widthPx, prio = 2) {
  const c = cache.get(page.id)
  if (c && c.version === page.version && c.canvas.width === Math.round(widthPx)) return c.canvas
  const res = widthPx / page.w
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(widthPx)
  canvas.height = Math.round(page.h * res)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = page.pdf ? '#ffffff' : page.paper || '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (page.pdf) {
    try {
      const job = renderPdfRegion(page.pdf, res, { x: 0, y: 0, w: page.w, h: page.h }, prio)
      const pc = await job.promise
      ctx.drawImage(pc, 0, 0, canvas.width, canvas.height)
      pc.width = pc.height = 0
    } catch (e) {
      if (!isCancel(e)) console.warn(e)
    }
  }
  const imgs = page.items.filter((i) => i.t === 'i').map((i) => ensureImage(i.f))
  if (imgs.length) await Promise.all(imgs)
  ctx.setTransform(res, 0, 0, res, 0, 0)
  drawTemplate(ctx, page.tpl, page.w, page.h, res)
  drawItems(ctx, page.items, null, true)
  cache.set(page.id, { version: page.version, canvas })
  return canvas
}

export async function notebookCover(page) {
  if (!page) return null
  const canvas = await renderPageThumb(page, 360, 0)
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
}

export function forgetThumb(pageId) {
  cache.delete(pageId)
}
