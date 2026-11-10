// Selezione "sollevata": elementi tolti dalle pagine, mostrati su un canvas flottante,
// spostabili (anche tra pagine), ridimensionabili, ricolorabili, copiabili, eliminabili.
import { h, clamp, bbUnion } from '../util.js'
import { icon } from '../icons.js'
import { drawItems, itemBB, transformItem } from '../ink.js'
import { popover, colorPicker, closePopover } from '../ui.js'
import { settings, pushRecentColor } from '../settings.js'

const MAX_PX = 8e6
const EDGE = 56

export class Selection {
  constructor(ed) {
    this.ed = ed
    this.view = ed.view
    this.items = null
    this.canvas = h('canvas', { class: 'sel-canvas' })
    this.box = h('div', { class: 'sel-box' })
    for (const c of ['nw', 'ne', 'sw', 'se']) this.box.append(h('div', { class: 'sel-handle ' + c, dataset: { h: c } }))
    this.menu = h('div', { class: 'sel-menu' })
    this.buildMenu()
    this.box.addEventListener('pointerdown', (e) => this.onDown(e))
    this.box.addEventListener('pointermove', (e) => this.onMove(e))
    this.box.addEventListener('pointerup', (e) => this.onUp(e))
    this.box.addEventListener('pointercancel', (e) => this.onUp(e))
    this.menu.addEventListener('pointerdown', (e) => e.stopPropagation())
    this.unsub = this.view.onCamera(() => {
      if (this.drag) this.updateDrag()
      this.updateOverlay()
    })
    this.drag = null
  }

  get active() {
    return !!this.items
  }

  buildMenu() {
    const btn = (ic, label, fn, cls = '') =>
      h('button', { class: 'sel-btn ' + cls, title: label, onclick: (e) => { e.stopPropagation(); fn(e.currentTarget) } }, icon(ic, 20), h('span', null, label))
    this.colorBtn = btn('palette', 'Colore', (el) => this.pickColor(el))
    this.menu.append(
      this.colorBtn,
      btn('copy', 'Copia', () => this.copy()),
      btn('cut', 'Taglia', () => this.cut()),
      btn('duplicate', 'Duplica', () => this.duplicate()),
      btn('tray', 'Salva snip', () => this.saveSnip()),
      btn('trash', 'Elimina', () => this.remove(), 'danger')
    )
  }

  // groups: [{ entry, items }] con elementi in coordinate pagina
  liftFromPages(groups) {
    this.drop()
    const before = new Map()
    const items = []
    for (const { entry, items: its } of groups) {
      const page = entry.page
      const ids = new Set(its.map((i) => i.id))
      before.set(page.id, page.items)
      let region = null
      for (const it of its) region = bbUnion(region, itemBB(it))
      this.ed.doc.setItems(page.id, page.items.filter((i) => !ids.has(i.id)), { type: 'replace', region })
      for (const it of its) items.push(transformItem(it, 1, entry.x, entry.y))
    }
    this.origin = { kind: 'pages', before }
    // se l'app si chiude con la selezione attiva, salva le pagine com'erano prima
    this.ed.doc.saveOverride = before
    this.start(items)
  }

  // Elementi nuovi (incolla, duplica, snip, trascina dal vassoio) in coordinate mondo
  liftNew(items, { discardIfUntouched = false } = {}) {
    this.drop()
    this.origin = { kind: 'new', discardIfUntouched }
    this.start(items)
  }

  start(items) {
    this.items = items
    this.changed = false
    this.tf = { k: 1, dx: 0, dy: 0, ox: 0, oy: 0 }
    this.render()
    this.view.world.append(this.canvas)
    this.view.overlay.append(this.box, this.menu)
    this.canvas.classList.toggle('floating', this.origin.kind === 'new')
    this.colorBtn.style.display = items.some((i) => i.t === 's') ? '' : 'none'
    this.updateOverlay()
    this.ed.onSelectionChange?.()
  }

  computeBB() {
    let bb = null
    for (const it of this.items) bb = bbUnion(bb, itemBB(it))
    this.bb = bb || [0, 0, 1, 1]
  }

  render() {
    this.computeBB()
    const [x0, y0, x1, y1] = this.bb
    const pad = 2
    const w = x1 - x0 + pad * 2, hh = y1 - y0 + pad * 2
    const res = Math.min(this.view.s * this.view.dpr, Math.sqrt(MAX_PX / (w * hh)))
    const c = this.canvas
    c.width = Math.max(1, Math.ceil(w * res))
    c.height = Math.max(1, Math.ceil(hh * res))
    Object.assign(c.style, { left: x0 - pad + 'px', top: y0 - pad + 'px', width: w + 'px', height: hh + 'px', transform: '' })
    this.cpos = { x: x0 - pad, y: y0 - pad }
    const ctx = c.getContext('2d')
    ctx.setTransform(c.width / w, 0, 0, c.height / hh, -(x0 - pad) * (c.width / w), -(y0 - pad) * (c.height / hh))
    drawItems(ctx, this.items, null)
  }

  // bounding box con la trasformazione in corso
  liveBB() {
    const { k, dx, dy, ox, oy } = this.tf
    const [x0, y0, x1, y1] = this.bb
    const f = (x, o, d) => (x - o) * k + o + d
    return [f(x0, ox, dx), f(y0, oy, dy), f(x1, ox, dx), f(y1, oy, dy)]
  }

  updateOverlay() {
    if (!this.items) return
    const v = this.view
    const [x0, y0, x1, y1] = this.liveBB()
    const left = x0 * v.s + v.tx - 6
    const top = y0 * v.s + v.ty - 6
    const w = (x1 - x0) * v.s + 12
    const hh = (y1 - y0) * v.s + 12
    Object.assign(this.box.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: hh + 'px' })
    const mw = this.menu.offsetWidth || 360
    const mh = this.menu.offsetHeight || 48
    let my = top - mh - 10
    if (my < 8) my = top + hh + 10
    if (my + mh > v.vh - 8) my = clamp(top + 10, 8, v.vh - mh - 8)
    const mx = clamp(left + w / 2 - mw / 2, 8, v.vw - mw - 8)
    Object.assign(this.menu.style, { left: mx + 'px', top: my + 'px' })
    this.menu.style.visibility = this.drag ? 'hidden' : ''
  }

  // --- Trascinamento ---
  onDown(e) {
    e.stopPropagation()
    e.preventDefault()
    if (this.drag) return
    if (e.pointerType === 'touch' && this.ed.isPalm(e)) return
    closePopover()
    try {
      this.box.setPointerCapture(e.pointerId)
    } catch {
      /* puntatore non catturabile */
    }
    const v = this.view
    const handle = e.target.dataset?.h
    const start = v.toWorld(e.clientX, e.clientY)
    const [x0, y0, x1, y1] = this.bb
    const d = { id: e.pointerId, start, cx: e.clientX, cy: e.clientY, moved: false, type: e.pointerType }
    if (handle) {
      d.mode = 'scale'
      d.ox = handle.includes('w') ? x1 : x0
      d.oy = handle.includes('n') ? y1 : y0
      d.d0 = Math.max(1, Math.hypot(start.x - d.ox, start.y - d.oy))
    } else d.mode = 'move'
    this.drag = d
    this.autoScroll()
  }

  onMove(e) {
    const d = this.drag
    if (!d || e.pointerId !== d.id) return
    e.stopPropagation()
    d.cx = e.clientX
    d.cy = e.clientY
    this.updateDrag()
  }

  updateDrag() {
    const d = this.drag
    const v = this.view
    const cur = v.toWorld(d.cx, d.cy)
    if (!d.moved && Math.hypot(cur.x - d.start.x, cur.y - d.start.y) * v.s < 3) return
    d.moved = true
    if (d.mode === 'move') this.tf = { k: 1, dx: cur.x - d.start.x, dy: cur.y - d.start.y, ox: 0, oy: 0 }
    else {
      const k = clamp(Math.hypot(cur.x - d.ox, cur.y - d.oy) / d.d0, 0.1, 12)
      this.tf = { k, dx: 0, dy: 0, ox: d.ox, oy: d.oy }
    }
    const { k, dx, dy, ox, oy } = this.tf
    this.canvas.style.transformOrigin = `${ox - this.cpos.x}px ${oy - this.cpos.y}px`
    this.canvas.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`
    this.updateOverlay()
  }

  autoScroll() {
    const d = this.drag
    if (!d) return
    const v = this.view
    if (d.moved && d.mode === 'move') {
      const y = d.cy - v.top
      let vy = 0
      if (y < EDGE) vy = -((EDGE - y) / EDGE) * 14
      else if (y > v.vh - EDGE) vy = ((y - (v.vh - EDGE)) / EDGE) * 14
      if (vy) v.scrollBy(0, vy)
    }
    this.scrollRaf = requestAnimationFrame(() => this.autoScroll())
  }

  onUp(e) {
    const d = this.drag
    if (!d || e.pointerId !== d.id) return
    e.stopPropagation()
    cancelAnimationFrame(this.scrollRaf)
    this.drag = null
    if (d.moved) this.applyTransform()
    this.updateOverlay()
  }

  applyTransform() {
    const { k, dx, dy, ox, oy } = this.tf
    if (k === 1 && dx === 0 && dy === 0) return
    this.items = this.items.map((it) => transformItem(it, k, ox * (1 - k) + dx, oy * (1 - k) + dy))
    this.tf = { k: 1, dx: 0, dy: 0, ox: 0, oy: 0 }
    this.changed = true
    this.render()
  }

  hide() {
    const doc = this.ed.doc
    if (doc.saveOverride) {
      for (const pid of doc.saveOverride.keys()) doc.dirty.add(pid)
      doc.saveOverride = null
      doc.save()
    }
    cancelAnimationFrame(this.scrollRaf)
    this.drag = null
    this.items = null
    this.canvas.remove()
    this.box.remove()
    this.menu.remove()
    this.canvas.width = this.canvas.height = 0
    closePopover()
    this.ed.onSelectionChange?.()
  }

  // Rilascia la selezione sulla pagina sotto il suo centro.
  drop() {
    if (!this.items) return
    if (this.drag?.moved) this.applyTransform()
    const items = this.items
    const origin = this.origin
    const doc = this.ed.doc
    const v = this.view
    this.hide()

    if (!this.changed && origin.kind === 'pages') {
      let region = null
      for (const [pid, before] of origin.before) {
        if (doc.page(pid)) doc.setItems(pid, before)
      }
      return region
    }
    if (!this.changed && origin.kind === 'new' && origin.discardIfUntouched) return

    let bb = null
    for (const it of items) bb = bbUnion(bb, itemBB(it))
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2
    const target = v.entryAt(cx, cy) || v.nearestEntry(cx, cy)
    if (!target) return
    const local = items.map((it) => transformItem(it, 1, -target.x, -target.y))
    const lbb = [bb[0] - target.x, bb[1] - target.y, bb[2] - target.x, bb[3] - target.y]
    const changes = []
    let handledTarget = false
    if (origin.kind === 'pages') {
      for (const [pid, before] of origin.before) {
        const p = doc.page(pid)
        if (!p) continue
        if (pid === target.page.id) {
          const after = [...p.items, ...local]
          doc.setItems(pid, after, { type: 'replace', region: lbb })
          changes.push({ pageId: pid, before, after })
          handledTarget = true
        } else changes.push({ pageId: pid, before, after: p.items })
      }
    }
    if (!handledTarget) {
      const p = target.page
      const before = p.items
      const after = [...before, ...local]
      doc.setItems(p.id, after, { type: 'replace', region: lbb })
      changes.push({ pageId: p.id, before, after })
    }
    this.ed.history.push({ kind: 'items', changes })
  }

  remove() {
    if (!this.items) return
    const origin = this.origin
    const doc = this.ed.doc
    this.hide()
    if (origin.kind === 'pages') {
      const changes = []
      for (const [pid, before] of origin.before) {
        const p = doc.page(pid)
        if (p) changes.push({ pageId: pid, before, after: p.items })
      }
      this.ed.history.push({ kind: 'items', changes })
    }
  }

  copy() {
    if (!this.items) return
    this.ed.setClipboard(this.items.map((it) => transformItem(it, 1, 0, 0)))
  }

  cut() {
    this.copy()
    this.remove()
  }

  duplicate() {
    if (!this.items) return
    const copies = this.items.map((it) => transformItem(it, 1, 24, 24, true))
    this.drop()
    this.liftNew(copies)
  }

  async saveSnip() {
    if (!this.items) return
    await this.ed.saveItemsAsSnip(this.items)
  }

  pickColor(anchor) {
    const first = this.items.find((i) => i.t === 's')
    const pick = colorPicker(first?.c || '#000000', (c, final) => {
      this.items = this.items.map((it) => (it.t === 's' ? { ...it, c } : it))
      this.changed = true
      this.render()
      if (final) pushRecentColor(c)
    }, { recent: settings.recentColors })
    popover(anchor, pick)
  }

  destroy() {
    this.unsub()
    this.hide()
  }
}
