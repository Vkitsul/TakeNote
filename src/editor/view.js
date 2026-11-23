// Continuous page view: camera (pan/zoom), virtual mounting, layered rendering.
// Every page has a "base" layer (whole page, capped resolution) and, when zoomed in a lot,
// a full-resolution "detail" layer that covers only the visible part.
import { h, clamp } from '../util.js'
import { drawItems } from '../ink.js'
import { drawTemplate } from '../templates.js'
import { renderPdfRegion, isCancel, setPdfRenderSlow } from '../pdfdoc.js'
import { settings } from '../settings.js'
import { onImageLoad } from '../images.js'
import { displayPaper, isDark, DARK_FILTER } from '../theme.js'

const GAP = 22
const PAD = 22
const ADD_H = 64
const BASE_MAX_PX = 6e6
const DETAIL_PAD = 0.12
const PAN_SLOP = 8 // px: below this threshold a still finger (or a resting hand) does not move the page
const ZOOM_DEADZONE = 0.06 // two scrolling fingers do not change the zoom for small variations
const REVERT_MAX_PX = 140

const tierRes = (r) => Math.pow(2, Math.ceil(Math.log2(Math.max(r, 0.05)) * 2 - 1e-6) / 2)

function releaseCanvas(c) {
  if (!c) return
  c.width = 0
  c.height = 0
}

// A layer is a single opaque canvas with paper, PDF, background and ink already composited, so the screen
// has fewer layers to blend each frame. The PDF is kept apart in an off-DOM canvas, to
// redraw an area quickly after erasing.
class Layer {
  constructor(pv, region, res, isDetail) {
    this.pv = pv
    this.region = region
    this.res = res
    this.canvas = h('canvas', { class: isDetail ? 'layer detail' : 'layer' })
    this.ctx = this.canvas.getContext('2d', { alpha: false })
    this.pdfBitmap = null
    this.pdfJob = null
    this.dead = false
    const r = region
    Object.assign(this.canvas.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' })
  }

  size() {
    return [Math.max(1, Math.ceil(this.region.w * this.res)), Math.max(1, Math.ceil(this.region.h * this.res))]
  }

  setTransform(ctx, canvas) {
    const sx = canvas.width / this.region.w
    const sy = canvas.height / this.region.h
    ctx.setTransform(sx, 0, 0, sy, -this.region.x * sx, -this.region.y * sy)
    return sx
  }

  // sub = [x0,y0,x1,y1] in page coordinates: redraws only that area
  render(sub) {
    const page = this.pv.page
    const c = this.canvas
    const [W, H] = this.size()
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
      sub = null
    }
    const ctx = this.ctx
    const r = this.region
    let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h
    ctx.save()
    const sx = this.setTransform(ctx, c)
    if (sub) {
      const pad = 2 / sx
      const sy = c.height / r.h
      // pixel-aligned edges: a soft clip would leave halos after erasing
      x0 = Math.max(r.x + Math.floor((sub[0] - pad - r.x) * sx) / sx, x0)
      y0 = Math.max(r.y + Math.floor((sub[1] - pad - r.y) * sy) / sy, y0)
      x1 = Math.min(r.x + Math.ceil((sub[2] + pad - r.x) * sx) / sx, x1)
      y1 = Math.min(r.y + Math.ceil((sub[3] + pad - r.y) * sy) / sy, y1)
      if (x1 <= x0 || y1 <= y0) {
        ctx.restore()
        return
      }
      ctx.beginPath()
      ctx.rect(x0, y0, x1 - x0, y1 - y0)
      ctx.clip()
    }
    ctx.fillStyle = displayPaper(page.pdf ? '#ffffff' : page.paper || '#ffffff')
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    if (this.pdfBitmap) ctx.drawImage(this.pdfBitmap, r.x, r.y, r.w, r.h)
    drawTemplate(ctx, page.tpl, page.w, page.h, this.res, isDark())
    drawItems(ctx, page.items, [x0, y0, x1, y1])
    ctx.restore()
  }

  appendItem(item) {
    const ctx = this.ctx
    ctx.save()
    this.setTransform(ctx, this.canvas)
    drawItems(ctx, [item], null)
    ctx.restore()
  }

  // (Re)loads the PDF at the current resolution. Without a PDF the layer is already complete.
  loadBackground(prio = 0) {
    const page = this.pv.page
    this.pdfJob?.cancel()
    this.pdfJob = null
    if (!page.pdf) {
      this.onBgReady?.()
      return
    }
    const job = renderPdfRegion(page.pdf, this.res, this.region, prio)
    this.pdfJob = job
    job.promise.then(
      (canvas) => {
        if (this.pdfJob !== job || this.dead) {
          releaseCanvas(canvas)
          return
        }
        this.pdfJob = null
        releaseCanvas(this.pdfBitmap)
        this.pdfBitmap = isDark() ? invertedCopy(canvas) : canvas
        this.render()
        this.onBgReady?.()
      },
      (e) => {
        if (!isCancel(e)) console.warn('PDF render failed', e)
      }
    )
  }

  // Theme change: the PDF must be regenerated, because the inversion is baked into its pixels.
  resetBackground() {
    releaseCanvas(this.pdfBitmap)
    this.pdfBitmap = null
    this.render()
    this.loadBackground(0)
  }

  destroy() {
    this.dead = true
    this.pdfJob?.cancel()
    releaseCanvas(this.pdfBitmap)
    releaseCanvas(this.canvas)
    this.canvas.remove()
  }
}

// PDF inverted once, instead of a CSS filter recomputed every frame.
function invertedCopy(src) {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d', { alpha: false })
  ctx.filter = DARK_FILTER
  ctx.drawImage(src, 0, 0)
  ctx.filter = 'none'
  releaseCanvas(src)
  return c
}

class PageView {
  constructor(view, page) {
    this.view = view
    this.page = page
    this.el = h('div', { class: 'page' })
    this.base = null
    this.detail = null
    this.pending = null
  }

  position(e) {
    Object.assign(this.el.style, {
      left: e.x + 'px',
      top: e.y + 'px',
      width: e.w + 'px',
      height: e.h + 'px',
      background: displayPaper(this.page.pdf ? '#ffffff' : this.page.paper || '#ffffff'),
    })
  }

  baseResFor(target) {
    const cap = Math.sqrt(BASE_MAX_PX / (this.page.w * this.page.h))
    return Math.min(tierRes(target), cap)
  }

  // draft: page mounted while scrolling, at half resolution; refined once the page stops
  ensureBase(target, prio, draft = false) {
    const res = this.baseResFor(target) * (draft && !this.page.pdf ? 0.5 : 1)
    if (!this.base) {
      this.base = new Layer(this, { x: 0, y: 0, w: this.page.w, h: this.page.h }, res, false)
      this.el.prepend(this.base.canvas)
      this.base.render()
      this.base.loadBackground(prio)
    } else if (Math.abs(this.base.res - res) > res * 0.01) {
      this.base.res = res
      this.base.render()
      this.base.loadBackground(prio)
    }
  }

  updateDetail(target, vis) {
    const baseRes = this.base ? this.base.res : 0
    if (!vis || target <= baseRes * 1.12) {
      this.dropDetail()
      return
    }
    const cur = this.pending || this.detail
    if (cur && Math.abs(cur.res - target) < target * 0.02) {
      const r = cur.region
      if (vis.x >= r.x - 0.5 && vis.y >= r.y - 0.5 && vis.x + vis.w <= r.x + r.w + 0.5 && vis.y + vis.h <= r.y + r.h + 0.5) return
    }
    const px = vis.w * DETAIL_PAD
    const py = vis.h * DETAIL_PAD
    const x0 = Math.max(0, vis.x - px), y0 = Math.max(0, vis.y - py)
    const x1 = Math.min(this.page.w, vis.x + vis.w + px), y1 = Math.min(this.page.h, vis.y + vis.h + py)
    const L = new Layer(this, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, target, true)
    L.render()
    this.pending?.destroy()
    this.pending = L
    L.canvas.style.visibility = 'hidden'
    this.el.append(L.canvas)
    L.onBgReady = () => {
      if (this.pending !== L) return
      L.canvas.style.visibility = ''
      this.detail?.destroy()
      this.detail = L
      this.pending = null
    }
    L.loadBackground(0)
  }

  dropDetail() {
    this.pending?.destroy()
    this.pending = null
    this.detail?.destroy()
    this.detail = null
  }

  layers() {
    return [this.base, this.detail, this.pending].filter(Boolean)
  }

  redrawInk(sub) {
    for (const l of this.layers()) l.render(sub)
  }

  // Paper or background changed
  redrawBg() {
    for (const l of this.layers()) {
      l.render()
      l.loadBackground(0)
    }
  }

  resetBackgrounds() {
    for (const l of this.layers()) l.resetBackground()
  }

  append(item) {
    for (const l of this.layers()) l.appendItem(item)
  }

  destroy() {
    for (const l of this.layers()) l.destroy()
    this.base = this.detail = this.pending = null
    this.el.remove()
  }
}

export class View {
  constructor(container, doc, { onAddPage } = {}) {
    this.doc = doc
    this.el = h('div', { class: 'viewport' })
    this.world = h('div', { class: 'world' })
    this.addBtn = h('button', { class: 'add-page', onclick: () => onAddPage?.() }, '+ New page')
    this.world.append(this.addBtn)
    this.live = h('canvas', { class: 'live' })
    this.overlay = h('div', { class: 'overlay' })
    this.zoomPill = h('div', { class: 'zoom-pill' })
    this.el.append(this.world, this.live, this.overlay, this.zoomPill)
    container.append(this.el)
    this.liveCtx = this.live.getContext('2d', { desynchronized: true })
    this.dpr = window.devicePixelRatio || 1
    this.s = 1
    this.tx = 0
    this.ty = 0
    this.vw = 0
    this.vh = 0
    this.left = 0
    this.top = 0
    this.entries = []
    this.entryById = new Map()
    this.views = new Map()
    this.camListeners = new Set()
    this.idleTimer = 0
    this.mountRaf = 0
    this.ready = false
    this.touches = new Map()
    this.gesture = null
    this.fling = 0
    this.lastTap = null
    this.handlers = {}
    this.isBusy = () => false // true while writing: heavy work waits
    this.moving = false
    this.qualityRaf = 0
    this.unsub = [
      doc.on('items', (pageId, change) => this.onItems(pageId, change)),
      doc.on('pages', (ev) => this.onPages(ev)),
      onImageLoad((fid) => this.onImageLoaded(fid)),
    ]
    this.layout()
    this.ro = new ResizeObserver(() => this.onResize())
    this.ro.observe(this.el)
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })
  }

  destroy() {
    this.ro.disconnect()
    this.unsub.forEach((f) => f())
    cancelAnimationFrame(this.fling)
    cancelAnimationFrame(this.qualityRaf)
    clearTimeout(this.idleTimer)
    setPdfRenderSlow(false)
    for (const pv of this.views.values()) pv.destroy()
    this.views.clear()
    releaseCanvas(this.live)
    this.el.remove()
  }

  onCamera(fn) {
    this.camListeners.add(fn)
    return () => this.camListeners.delete(fn)
  }

  // --- Layout ---
  layout() {
    let y = PAD
    let maxW = 0
    this.entries = this.doc.pages.map((p) => {
      const e = { page: p, x: -p.w / 2, y, w: p.w, h: p.h }
      y += p.h + GAP
      if (p.w > maxW) maxW = p.w
      return e
    })
    this.entryById = new Map(this.entries.map((e) => [e.page.id, e]))
    this.maxW = maxW || 595
    const last = this.entries[this.entries.length - 1]
    const bw = last ? last.w : 595
    Object.assign(this.addBtn.style, { left: -bw / 2 + 'px', top: y + 'px', width: bw + 'px', height: ADD_H + 'px' })
    this.contentH = y + ADD_H + PAD
    for (const [id, pv] of this.views) {
      const e = this.entryById.get(id)
      if (e) {
        pv.page = e.page
        pv.position(e)
      } else {
        pv.destroy()
        this.views.delete(id)
      }
    }
  }

  onResize() {
    const r = this.el.getBoundingClientRect()
    const first = !this.ready
    const oldCenter = this.ready ? this.toWorld(this.left + this.vw / 2, this.top + this.vh / 2) : null
    const oldFit = this.ready ? this.fitScale() : 1
    this.left = r.left
    this.top = r.top
    this.vw = r.width
    this.vh = r.height
    this.dpr = window.devicePixelRatio || 1
    this.live.width = Math.round(this.vw * this.dpr)
    this.live.height = Math.round(this.vh * this.dpr)
    if (!this.vw || !this.vh) return
    this.ready = true
    if (first) {
      const idx = clamp(this.doc.nb.lastPage || 0, 0, this.entries.length - 1)
      this.s = this.fitScale()
      this.tx = this.vw / 2
      this.ty = 0
      this.scrollToPage(idx, false)
      this.applyTransform()
      this.cameraChanged()
    } else {
      const s = this.s * (this.fitScale() / oldFit)
      this.setCamera(s, this.vw / 2 - oldCenter.x * s, this.vh / 2 - oldCenter.y * s)
    }
  }

  fitScale() {
    const margin = this.vw < 700 ? 6 : 20
    return Math.max(0.05, (this.vw - margin * 2) / this.maxW)
  }

  get minScale() {
    return this.fitScale() * 0.3
  }
  get maxScale() {
    return this.fitScale() * 8
  }

  clampCamera(s, tx, ty) {
    s = clamp(s, this.minScale, this.maxScale)
    const half = (this.maxW / 2) * s
    const margin = 16
    if (half * 2 + margin * 2 <= this.vw) tx = this.vw / 2
    else tx = clamp(tx, this.vw - margin - half, margin + half)
    const ch = this.contentH * s
    if (ch <= this.vh) ty = (this.vh - ch) / 2
    else ty = clamp(ty, this.vh - ch, 0)
    return [s, tx, ty]
  }

  setCamera(s, tx, ty) {
    ;[s, tx, ty] = this.clampCamera(s, tx, ty)
    if (s === this.s && tx === this.tx && ty === this.ty) return false
    const zoomed = s !== this.s
    this.s = s
    this.tx = tx
    this.ty = ty
    this.applyTransform()
    this.cameraChanged()
    if (zoomed) this.showZoom()
    return true
  }

  applyTransform() {
    this.world.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`
  }

  cameraChanged() {
    if (!this.moving) {
      this.moving = true
      setPdfRenderSlow(true) // the PDF draws in small steps while the page moves
    }
    for (const fn of this.camListeners) fn()
    if (!this.mountRaf) {
      this.mountRaf = requestAnimationFrame(() => {
        this.mountRaf = 0
        this.updateMount()
      })
    }
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.onIdle(), 160)
  }

  onIdle() {
    if (this.isBusy()) this.idleTimer = setTimeout(() => this.onIdle(), 250)
    else this.updateQuality()
  }

  showZoom() {
    const pct = Math.round((this.s / this.fitScale()) * 100)
    this.zoomPill.textContent = pct + '%'
    this.zoomPill.classList.add('show')
    clearTimeout(this.zoomTimer)
    this.zoomTimer = setTimeout(() => this.zoomPill.classList.remove('show'), 700)
  }

  zoomAt(clientX, clientY, ns) {
    const x = clientX - this.left
    const y = clientY - this.top
    const wx = (x - this.tx) / this.s
    const wy = (y - this.ty) / this.s
    ns = clamp(ns, this.minScale, this.maxScale)
    this.setCamera(ns, x - wx * ns, y - wy * ns)
  }

  scrollBy(dx, dy) {
    return this.setCamera(this.s, this.tx - dx, this.ty - dy)
  }

  scrollToPage(i, animate = true) {
    const e = this.entries[clamp(i, 0, this.entries.length - 1)]
    if (!e) return
    const ty = -(e.y - 10) * this.s
    if (!animate) {
      ;[this.s, this.tx, this.ty] = this.clampCamera(this.s, this.tx, ty)
      this.applyTransform()
      this.cameraChanged()
      return
    }
    this.animateTo(this.s, this.tx, ty)
  }

  animateTo(s, tx, ty, ms = 260) {
    this.stopFling()
    const [s1, tx1, ty1] = this.clampCamera(s, tx, ty)
    const s0 = this.s, tx0 = this.tx, ty0 = this.ty
    const t0 = performance.now()
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      this.setCamera(s0 + (s1 - s0) * e, tx0 + (tx1 - tx0) * e, ty0 + (ty1 - ty0) * e)
      if (k < 1) this.fling = requestAnimationFrame(step)
    }
    this.fling = requestAnimationFrame(step)
  }

  // --- Coordinates ---
  toWorld(clientX, clientY) {
    return { x: (clientX - this.left - this.tx) / this.s, y: (clientY - this.top - this.ty) / this.s }
  }
  toClient(wx, wy) {
    return { x: wx * this.s + this.tx + this.left, y: wy * this.s + this.ty + this.top }
  }
  visibleWorld() {
    return { x: -this.tx / this.s, y: -this.ty / this.s, w: this.vw / this.s, h: this.vh / this.s }
  }

  entryAt(wx, wy) {
    const E = this.entries
    let lo = 0, hi = E.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const e = E[mid]
      if (wy < e.y) hi = mid - 1
      else if (wy > e.y + e.h) lo = mid + 1
      else return wx >= e.x && wx <= e.x + e.w ? e : null
    }
    return null
  }

  nearestEntry(wx, wy) {
    let best = null
    let bd = Infinity
    for (const e of this.entries) {
      const dy = wy < e.y ? e.y - wy : wy > e.y + e.h ? wy - e.y - e.h : 0
      const dx = wx < e.x ? e.x - wx : wx > e.x + e.w ? wx - e.x - e.w : 0
      const d = dx + dy
      if (d < bd) {
        bd = d
        best = e
      }
    }
    return best
  }

  currentIndex() {
    const v = this.visibleWorld()
    const y = v.y + v.h * 0.4
    let best = 0
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].y <= y) best = i
      else break
    }
    return best
  }

  // --- Mounting and quality ---
  updateMount() {
    if (!this.ready) return
    const v = this.visibleWorld()
    const m = v.h * 0.5
    const lo = v.y - m, hi = v.y + v.h + m
    const keepLo = v.y - v.h * 2, keepHi = v.y + v.h * 3
    const target = this.s * this.dpr
    let budget = 3
    let more = false
    for (const e of this.entries) {
      let pv = this.views.get(e.page.id)
      const near = e.y < hi && e.y + e.h > lo
      if (near && !pv) {
        if (budget-- <= 0) {
          more = true
          continue
        }
        pv = new PageView(this, e.page)
        pv.position(e)
        this.world.append(pv.el)
        this.views.set(e.page.id, pv)
        const visible = e.y < v.y + v.h && e.y + e.h > v.y
        pv.ensureBase(target, visible ? 0 : 1, this.moving)
      } else if (pv && (e.y > keepHi || e.y + e.h < keepLo)) {
        pv.destroy()
        this.views.delete(e.page.id)
      }
    }
    if (more) {
      this.mountRaf = requestAnimationFrame(() => {
        this.mountRaf = 0
        this.updateMount()
      })
    }
  }

  // Page at rest: visible pages are refined right away, the others one per frame.
  updateQuality() {
    if (!this.ready) return
    this.moving = false
    setPdfRenderSlow(false)
    this.updateMount()
    const v = this.visibleWorld()
    const target = this.s * this.dpr
    const later = []
    for (const pv of this.views.values()) {
      const e = this.entryById.get(pv.page.id)
      if (!e) continue
      const visible = e.y < v.y + v.h && e.y + e.h > v.y && e.x < v.x + v.w && e.x + e.w > v.x
      if (!visible) {
        later.push(pv)
        continue
      }
      pv.ensureBase(target, 0)
      const x0 = Math.max(v.x, e.x) - e.x
      const y0 = Math.max(v.y, e.y) - e.y
      const x1 = Math.min(v.x + v.w, e.x + e.w) - e.x
      const y1 = Math.min(v.y + v.h, e.y + e.h) - e.y
      pv.updateDetail(target, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    }
    cancelAnimationFrame(this.qualityRaf)
    const step = () => {
      this.qualityRaf = 0
      if (this.moving) return // resumes at the next stop
      if (this.isBusy()) {
        this.qualityRaf = requestAnimationFrame(step)
        return
      }
      const pv = later.shift()
      if (!pv) return
      if (this.views.get(pv.page.id) === pv) {
        pv.ensureBase(target, 1)
        pv.dropDetail()
      }
      if (later.length) this.qualityRaf = requestAnimationFrame(step)
    }
    if (later.length) this.qualityRaf = requestAnimationFrame(step)
  }

  // --- Model events ---
  onItems(pageId, change) {
    const pv = this.views.get(pageId)
    if (!pv) return
    if (change?.type === 'append') pv.append(change.item)
    else pv.redrawInk(change?.region)
  }

  onPages(ev) {
    if (ev.type === 'order') {
      this.layout()
      ;[this.s, this.tx, this.ty] = this.clampCamera(this.s, this.tx, this.ty)
      this.applyTransform()
      this.cameraChanged()
    } else if (ev.type === 'bg') {
      const pv = this.views.get(ev.pageId)
      const e = this.entryById.get(ev.pageId)
      if (pv && e) {
        pv.position(e)
        pv.redrawBg()
      }
    }
  }

  // Theme change: paper and ink must be redrawn (the CSS inverts the PDF background)
  refreshTheme() {
    for (const [id, pv] of this.views) {
      const e = this.entryById.get(id)
      if (e) pv.position(e)
      pv.resetBackgrounds()
    }
  }

  onImageLoaded(fid) {
    for (const pv of this.views.values()) {
      if (pv.page.items.some((it) => it.t === 'i' && it.f === fid)) pv.redrawInk()
    }
  }

  // --- "Live" canvas (stroke in progress, lasso, clipping) ---
  clearLive() {
    const c = this.liveCtx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.live.width, this.live.height)
  }

  livePageTransform(e) {
    const k = this.s * this.dpr
    this.liveCtx.setTransform(k, 0, 0, k, (this.tx + e.x * this.s) * this.dpr, (this.ty + e.y * this.s) * this.dpr)
  }

  liveWorldTransform() {
    const k = this.s * this.dpr
    this.liveCtx.setTransform(k, 0, 0, k, this.tx * this.dpr, this.ty * this.dpr)
  }

  // --- Finger gestures: 1 finger scrolls, 2 fingers zoom, 2/3-finger tap = undo/redo ---
  stopFling() {
    cancelAnimationFrame(this.fling)
    this.fling = 0
  }

  // revert: the gesture was the hand resting before the pen, so the page goes back where it was
  cancelTouches(revert = false) {
    const g = this.gesture
    this.touches.clear()
    this.gesture = null
    this.stopFling()
    if (revert && g) this.revertGesture(g)
  }

  // Only for small movements: a long scroll is intentional and stays.
  revertGesture(g) {
    const c = g.cam0
    if (!c) return
    if (Math.abs(this.tx - c.tx) < REVERT_MAX_PX && Math.abs(this.ty - c.ty) < REVERT_MAX_PX && Math.abs(this.s / c.s - 1) < 0.08) {
      this.setCamera(c.s, c.tx, c.ty)
    }
  }

  twoFingerScroll() {
    return settings.palm === 'two'
  }

  touchDown(e) {
    this.stopFling()
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const n = this.touches.size
    if (n === 1) {
      this.gesture = { maxTouches: 1, t0: e.timeStamp, moved: false, sx: e.clientX, sy: e.clientY, samples: [], cam0: { s: this.s, tx: this.tx, ty: this.ty } }
    } else if (this.gesture) {
      this.gesture.maxTouches = Math.max(this.gesture.maxTouches, n)
    }
    this.beginGesturePhase()
  }

  beginGesturePhase() {
    const g = this.gesture
    if (!g) return
    const pts = [...this.touches.values()]
    if (pts.length === 1) {
      g.mode = 'pan'
      g.lx = pts[0].x
      g.ly = pts[0].y
      g.samples = []
    } else if (pts.length >= 2) {
      g.mode = 'pinch'
      g.slopDone = true
      g.zooming = false
      g.samples = []
      const [a, b] = pts
      g.d0 = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))
      g.s0 = this.s
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      g.wm = this.toWorld(mx, my)
    }
  }

  touchMove(e) {
    const t = this.touches.get(e.pointerId)
    const g = this.gesture
    if (!t || !g) return
    t.x = e.clientX
    t.y = e.clientY
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 10) g.moved = true
    if (g.mode === 'pan' && this.touches.size === 1) {
      if (this.twoFingerScroll()) return
      if (!g.slopDone) {
        if (Math.hypot(t.x - g.sx, t.y - g.sy) < PAN_SLOP) return
        g.slopDone = true
        g.lx = t.x
        g.ly = t.y
        return
      }
      const dx = t.x - g.lx, dy = t.y - g.ly
      g.lx = t.x
      g.ly = t.y
      this.setCamera(this.s, this.tx + dx, this.ty + dy)
      g.samples.push({ t: e.timeStamp, x: t.x, y: t.y })
      if (g.samples.length > 8) g.samples.shift()
    } else if (g.mode === 'pinch' && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (Math.abs(d - g.d0) > 12) g.moved = true
      if (!g.zooming && Math.abs(d / g.d0 - 1) > ZOOM_DEADZONE) {
        g.zooming = true
        g.d0 = d // zoom starts from here, without a jump
        g.s0 = this.s
      }
      const mx = (a.x + b.x) / 2 - this.left, my = (a.y + b.y) / 2 - this.top
      const ns = g.zooming ? clamp((g.s0 * d) / g.d0, this.minScale, this.maxScale) : this.s
      this.setCamera(ns, mx - g.wm.x * ns, my - g.wm.y * ns)
      g.samples.push({ t: e.timeStamp, x: mx, y: my })
      if (g.samples.length > 8) g.samples.shift()
    }
  }

  touchUp(e, cancelled = false) {
    if (!this.touches.has(e.pointerId)) return
    this.touches.delete(e.pointerId)
    const g = this.gesture
    if (!g) return
    if (this.touches.size > 0) {
      // two fingers were scrolling: momentum starts when the first one lifts
      if (!cancelled && g.mode === 'pinch' && !g.zooming) g.pendingFling = { v: this.flingVelocity(g, e.timeStamp), t: e.timeStamp }
      this.beginGesturePhase()
      return
    }
    this.gesture = null
    if (cancelled) {
      this.revertGesture(g)
      return
    }
    const dur = e.timeStamp - g.t0
    if (!g.moved && dur < 320) {
      if (g.maxTouches === 2) this.handlers.twoFingerTap?.()
      else if (g.maxTouches === 3) this.handlers.threeFingerTap?.()
      else if (g.maxTouches === 1) {
        const now = e.timeStamp
        if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30) {
          this.lastTap = null
          this.handlers.doubleTap?.(e.clientX, e.clientY)
        } else {
          this.lastTap = { t: now, x: e.clientX, y: e.clientY }
          this.handlers.tap?.(e.clientX, e.clientY)
        }
      }
      return
    }
    let v = g.mode === 'pan' ? this.flingVelocity(g, e.timeStamp) : null
    if (!v && g.pendingFling && e.timeStamp - g.pendingFling.t < 200) v = g.pendingFling.v
    if (v) this.startFling(v.x, v.y)
  }

  flingVelocity(g, now) {
    if (g.samples.length < 2) return null
    const last = g.samples[g.samples.length - 1]
    let first = g.samples[0]
    for (const s of g.samples) if (last.t - s.t < 90) { first = s; break }
    const dt = last.t - first.t
    if (dt <= 0 || now - last.t > 60) return null
    const x = (last.x - first.x) / dt, y = (last.y - first.y) / dt
    return Math.hypot(x, y) > 0.25 ? { x, y } : null
  }

  startFling(vx, vy) {
    let prev = performance.now()
    const step = (now) => {
      const dt = Math.min(32, now - prev)
      prev = now
      const moved = this.setCamera(this.s, this.tx + vx * dt, this.ty + vy * dt)
      const decay = Math.pow(0.9955, dt)
      vx *= decay
      vy *= decay
      if (moved && Math.hypot(vx, vy) > 0.02) this.fling = requestAnimationFrame(step)
      else this.fling = 0
    }
    this.fling = requestAnimationFrame(step)
  }

  onWheel(e) {
    e.preventDefault()
    this.stopFling()
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(e.clientX, e.clientY, this.s * Math.exp(-e.deltaY * 0.01))
    } else {
      const k = e.deltaMode === 1 ? 32 : 1
      this.scrollBy(e.shiftKey ? e.deltaY * k : e.deltaX * k, e.shiftKey ? 0 : e.deltaY * k)
    }
  }

  fitWidth() {
    const fit = this.fitScale()
    const wy = -this.ty / this.s
    this.animateTo(fit, this.vw / 2, -wy * fit)
  }

  toggleFit(clientX, clientY) {
    const fit = this.fitScale()
    if (Math.abs(this.s - fit) / fit < 0.05) {
      const ns = fit * 2
      const x = clientX - this.left, y = clientY - this.top
      const wx = (x - this.tx) / this.s, wy = (y - this.ty) / this.s
      this.animateTo(ns, x - wx * ns, y - wy * ns)
    } else {
      const y = clientY - this.top
      const wy = (y - this.ty) / this.s
      this.animateTo(fit, this.vw / 2, y - wy * fit)
    }
  }
}
