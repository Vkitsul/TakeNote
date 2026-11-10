// Strumenti: penna, evidenziatore, gomma, lazo, snip.
// Ogni strumento riceve campioni { cx, cy, p, t, sp } (coordinate client, pressione, tempo, pressione simulata).
import { settings } from '../settings.js'
import { PEN_TYPES, makeStroke, strokeOutline, outlineToPath, polylinePath, drawStroke, strokeHitsSegment, itemBB } from '../ink.js'
import { bbIntersects, bbUnion, distSqToSegment, pointInPolygon } from '../util.js'
import { recognizeShape, shapeToPoints } from './shapes.js'
import { isDark } from '../theme.js'

const HOLD_MS = 550

export class PenTool {
  constructor(ed, kind) {
    this.ed = ed
    this.kind = kind // 'pen' | 'highlighter'
    this.entry = null
    this.raf = 0
    this.lastDraw = 0
  }
  get cfg() {
    return this.kind === 'highlighter' ? settings.highlighter : settings.pen
  }

  down(s) {
    const v = this.ed.view
    const w = v.toWorld(s.cx, s.cy)
    const e = v.entryAt(w.x, w.y)
    if (!e) {
      this.entry = null
      return
    }
    this.entry = e
    const cfg = this.cfg
    this.type = this.kind === 'highlighter' ? 'highlighter' : cfg.type
    this.line = !!PEN_TYPES[this.type]?.line
    this.color = cfg.color
    this.width = cfg.width
    this.sp = this.line ? false : s.sp
    const x = w.x - e.x, y = w.y - e.y
    this.pts = [x, y, this.line ? 0.5 : s.p]
    this.path = this.line ? polylinePath(this.pts) : null
    this.lastCx = s.cx
    this.lastCy = s.cy
    this.shape = null
    this.drawPts = null
    this.straight = this.kind === 'highlighter' && settings.highlighter.straight
    this.anchor = { x: s.cx, y: s.cy }
    this.armHold()
    this.draw()
  }

  armHold() {
    clearTimeout(this.holdTimer)
    if (!settings.shapeHold || this.shape || this.straight) return
    this.holdTimer = setTimeout(() => this.onHold(), HOLD_MS)
  }

  onHold() {
    if (!this.entry || this.pts.length < 12) return
    const r = recognizeShape(this.pts)
    if (!r) return
    this.shape = r
    this.sp = false
    this.pts = shapeToPoints(r.poly, r.closed)
    if (this.line) this.path = polylinePath(this.pts)
    navigator.vibrate?.(12)
    this.draw()
  }

  move(samples) {
    if (!this.entry) return
    const v = this.ed.view
    const e = this.entry
    let changed = false
    for (const s of samples) {
      if (this.shape) {
        if (this.shape.kind === 'line') {
          const w = v.toWorld(s.cx, s.cy)
          this.shape.poly[1] = [w.x - e.x, w.y - e.y]
          this.pts = shapeToPoints(this.shape.poly, false)
          if (this.line) this.path = polylinePath(this.pts)
          changed = true
        }
        continue
      }
      const dx = s.cx - this.lastCx, dy = s.cy - this.lastCy
      if (dx * dx + dy * dy < 0.2) {
        // stesso punto: aggiorna solo la pressione
        if (!this.line) {
          const n = this.pts.length
          this.pts[n - 1] = Math.max(this.pts[n - 1], s.p)
        }
        continue
      }
      this.lastCx = s.cx
      this.lastCy = s.cy
      const w = v.toWorld(s.cx, s.cy)
      const x = w.x - e.x, y = w.y - e.y
      this.pts.push(x, y, this.line ? 0.5 : s.p)
      if (this.line) this.path.lineTo(x, y)
      changed = true
      if (Math.hypot(s.cx - this.anchor.x, s.cy - this.anchor.y) > 5) {
        this.anchor = { x: s.cx, y: s.cy }
        this.armHold()
      }
    }
    if (!changed) return
    if (this.straight && this.pts.length > 3) {
      const p = this.pts
      this.drawPts = [p[0], p[1], 0.5, p[p.length - 3], p[p.length - 2], 0.5]
    } else this.drawPts = null
    this.schedule()
  }

  // Disegna al massimo ogni 4 ms: i campioni della penna arrivano più veloci dello schermo.
  schedule() {
    const now = performance.now()
    if (now - this.lastDraw >= 4) this.draw()
    else if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0
        if (this.entry) this.draw()
      })
    }
  }

  draw() {
    this.lastDraw = performance.now()
    const v = this.ed.view
    const ctx = v.liveCtx
    v.clearLive()
    v.livePageTransform(this.entry)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, this.entry.w, this.entry.h)
    ctx.clip()
    const stroke = { k: this.type, c: this.color, w: this.width, sp: this.sp, pts: this.drawPts || this.pts }
    if (this.line) drawStroke(ctx, stroke, this.drawPts ? polylinePath(this.drawPts) : this.path)
    else drawStroke(ctx, stroke, outlineToPath(strokeOutline(stroke, false)))
    ctx.restore()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  up(s) {
    if (!this.entry) return
    if (s && !this.shape) this.move([s])
    clearTimeout(this.holdTimer)
    const pts = this.drawPts || this.pts
    this.commit(this.entry.page, this.type, this.color, this.width, pts, this.sp && !this.drawPts)
    this.end()
  }

  commit(page, type, color, width, pts, sp) {
    const stroke = makeStroke(type, color, width, pts, sp)
    const before = page.items
    this.ed.history.commitItems(page.id, before, [...before, stroke], { type: 'append', item: stroke })
  }

  // Tratto disegnato dal livello nativo Android: arriva finito, in coordinate client [x,y,x,y,...].
  commitNative(flat) {
    const v = this.ed.view
    const first = v.toWorld(flat[0], flat[1])
    const e = v.entryAt(first.x, first.y) || v.nearestEntry(first.x, first.y)
    if (!e) return
    const pts = new Float32Array((flat.length / 2) * 3)
    for (let i = 0, j = 0; i < flat.length; i += 2, j += 3) {
      const w = v.toWorld(flat[i], flat[i + 1])
      pts[j] = w.x - e.x
      pts[j + 1] = w.y - e.y
      pts[j + 2] = 0.5
    }
    const cfg = this.cfg
    this.commit(e.page, this.kind === 'highlighter' ? 'highlighter' : cfg.type, cfg.color, cfg.width, pts, false)
  }

  cancel() {
    if (this.entry && this.pts?.length > 3) return this.up(null)
    this.end()
  }

  discard() {
    this.end()
  }

  end() {
    clearTimeout(this.holdTimer)
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.entry = null
    this.drawPts = null
    this.path = null
    this.ed.view.clearLive()
  }
}

// --- Gomma ---
function densify(pts, maxStep) {
  const out = [pts[0], pts[1], pts[2]]
  for (let i = 3; i < pts.length; i += 3) {
    const ax = pts[i - 3], ay = pts[i - 2], ap = pts[i - 1]
    const bx = pts[i], by = pts[i + 1], bp = pts[i + 2]
    const d = Math.hypot(bx - ax, by - ay)
    const n = Math.ceil(d / maxStep)
    for (let k = 1; k < n; k++) {
      const t = k / n
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t)
    }
    out.push(bx, by, bp)
  }
  return out
}

function splitStroke(s, ax, ay, bx, by, r) {
  const pts = densify(s.pts, Math.max(0.5, r * 0.4))
  const rr = (r + s.w * 0.35) ** 2
  const pieces = []
  let run = []
  let hit = false
  for (let i = 0; i < pts.length; i += 3) {
    if (distSqToSegment(pts[i], pts[i + 1], ax, ay, bx, by) <= rr) {
      hit = true
      if (run.length >= 6) pieces.push(run)
      run = []
    } else run.push(pts[i], pts[i + 1], pts[i + 2])
  }
  if (!hit) return null
  if (run.length >= 6) pieces.push(run)
  return pieces.map((p) => makeStroke(s.k, s.c, s.w, p, s.sp))
}

export class EraserTool {
  constructor(ed) {
    this.ed = ed
    this.befores = null
  }

  down(s) {
    this.befores = new Map()
    this.last = this.ed.view.toWorld(s.cx, s.cy)
    this.eraseTo(this.last)
    this.drawCursor(s.cx, s.cy)
  }

  move(samples) {
    if (!this.befores) return
    for (const s of samples) {
      const w = this.ed.view.toWorld(s.cx, s.cy)
      this.eraseTo(w)
    }
    const s = samples[samples.length - 1]
    if (s) this.drawCursor(s.cx, s.cy)
  }

  hover(s) {
    this.drawCursor(s.cx, s.cy)
  }

  leave() {
    this.ed.view.clearLive()
  }

  drawCursor(cx, cy) {
    const v = this.ed.view
    const ctx = v.liveCtx
    v.clearLive()
    const d = v.dpr
    ctx.setTransform(d, 0, 0, d, 0, 0)
    ctx.beginPath()
    ctx.arc(cx - v.left, cy - v.top, settings.eraser.size, 0, Math.PI * 2)
    const dark = isDark()
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.35)'
    ctx.fill()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = dark ? 'rgba(230,235,245,0.7)' : 'rgba(30,40,60,0.55)'
    ctx.stroke()
  }

  eraseTo(w) {
    const v = this.ed.view
    const a = this.last
    this.last = w
    const r = settings.eraser.size / v.s
    const segBB = [Math.min(a.x, w.x) - r, Math.min(a.y, w.y) - r, Math.max(a.x, w.x) + r, Math.max(a.y, w.y) + r]
    const area = settings.eraser.mode === 'area'
    const hlOnly = settings.eraser.highlighterOnly
    for (const e of v.entries) {
      if (e.y > segBB[3] || e.y + e.h < segBB[1]) continue
      const page = e.page
      const ax = a.x - e.x, ay = a.y - e.y, bx = w.x - e.x, by = w.y - e.y
      const lbb = [segBB[0] - e.x, segBB[1] - e.y, segBB[2] - e.x, segBB[3] - e.y]
      let changed = false
      let dirty = null
      const out = []
      for (const it of page.items) {
        if (it.t !== 's' || (hlOnly && it.k !== 'highlighter') || !bbIntersects(it.bb, lbb)) {
          out.push(it)
          continue
        }
        if (area) {
          const pieces = splitStroke(it, ax, ay, bx, by, r)
          if (!pieces) {
            out.push(it)
            continue
          }
          out.push(...pieces)
        } else if (!strokeHitsSegment(it, ax, ay, bx, by, r)) {
          out.push(it)
          continue
        }
        changed = true
        dirty = bbUnion(dirty, it.bb)
      }
      if (!changed) continue
      if (!this.befores.has(page.id)) this.befores.set(page.id, page.items)
      this.ed.doc.setItems(page.id, out, { type: 'replace', region: dirty })
    }
  }

  up() {
    if (!this.befores) return
    const changes = []
    for (const [pageId, before] of this.befores) {
      const p = this.ed.doc.page(pageId)
      if (p) changes.push({ pageId, before, after: p.items })
    }
    if (changes.length) this.ed.history.push({ kind: 'items', changes })
    this.befores = null
    this.ed.view.clearLive()
  }

  cancel() {
    this.up()
  }
}

// --- Lazo ---
function drawDashedPath(v, poly, closed, fill) {
  const ctx = v.liveCtx
  v.clearLive()
  if (poly.length < 4) return
  v.liveWorldTransform()
  ctx.beginPath()
  ctx.moveTo(poly[0], poly[1])
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1])
  if (closed) ctx.closePath()
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.lineWidth = 1.6 * v.dpr
  ctx.setLineDash([6 * v.dpr, 5 * v.dpr])
  ctx.strokeStyle = '#3157d6'
  ctx.stroke()
  ctx.setLineDash([])
}

export class LassoTool {
  constructor(ed) {
    this.ed = ed
    this.poly = null
  }

  down(s) {
    this.ed.selection.drop()
    const w = this.ed.view.toWorld(s.cx, s.cy)
    this.poly = [w.x, w.y]
    this.screenLen = 0
    this.lastC = { x: s.cx, y: s.cy }
  }

  move(samples) {
    if (!this.poly) return
    const v = this.ed.view
    for (const s of samples) {
      const d = Math.hypot(s.cx - this.lastC.x, s.cy - this.lastC.y)
      if (d < 3) continue
      this.screenLen += d
      this.lastC = { x: s.cx, y: s.cy }
      const w = v.toWorld(s.cx, s.cy)
      this.poly.push(w.x, w.y)
    }
    drawDashedPath(v, this.poly, false, 'rgba(49,87,214,0.06)')
  }

  up() {
    if (!this.poly) return
    const v = this.ed.view
    const poly = this.poly
    this.poly = null
    v.clearLive()
    const groups = this.screenLen < 10 ? this.pickAt(poly[0], poly[1]) : this.pickInside(poly)
    if (groups.length) this.ed.selection.liftFromPages(groups)
  }

  cancel() {
    this.poly = null
    this.ed.view.clearLive()
  }

  pickAt(wx, wy) {
    const v = this.ed.view
    const e = v.entryAt(wx, wy)
    if (!e) return []
    const x = wx - e.x, y = wy - e.y
    const tol = 10 / v.s
    const items = e.page.items
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.t === 'i' && x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return [{ entry: e, items: [it] }]
      if (it.t === 's' && bbIntersects(it.bb, [x - tol, y - tol, x + tol, y + tol]) && strokeHitsSegment(it, x, y, x, y, tol)) {
        return [{ entry: e, items: [it] }]
      }
    }
    return []
  }

  pickInside(poly) {
    const v = this.ed.view
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < poly.length; i += 2) {
      x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i])
      y0 = Math.min(y0, poly[i + 1]); y1 = Math.max(y1, poly[i + 1])
    }
    const groups = []
    for (const e of v.entries) {
      if (e.y > y1 || e.y + e.h < y0) continue
      const local = poly.map((c, i) => (i % 2 ? c - e.y : c - e.x))
      const lbb = [x0 - e.x, y0 - e.y, x1 - e.x, y1 - e.y]
      const sel = []
      for (const it of e.page.items) {
        if (!bbIntersects(itemBB(it), lbb)) continue
        if (it.t === 's') {
          const n = it.pts.length / 3
          const step = Math.max(1, Math.floor(n / 40))
          let inside = 0, total = 0
          for (let k = 0; k < n; k += step) {
            total++
            if (pointInPolygon(it.pts[k * 3], it.pts[k * 3 + 1], local)) inside++
          }
          if (inside / total >= 0.5) sel.push(it)
        } else {
          const cx = it.x + it.w / 2, cy = it.y + it.h / 2
          const corners = [[it.x, it.y], [it.x + it.w, it.y], [it.x, it.y + it.h], [it.x + it.w, it.y + it.h]]
          const inC = corners.filter(([px, py]) => pointInPolygon(px, py, local)).length
          if (pointInPolygon(cx, cy, local) || inC >= 2) sel.push(it)
        }
      }
      if (sel.length) groups.push({ entry: e, items: sel })
    }
    return groups
  }
}

// --- Snip (ritaglio) ---
export class SnipTool {
  constructor(ed) {
    this.ed = ed
    this.start = null
  }

  down(s) {
    this.ed.selection.drop()
    const w = this.ed.view.toWorld(s.cx, s.cy)
    this.start = w
    this.cur = w
    this.poly = [w.x, w.y]
    this.lastC = { x: s.cx, y: s.cy }
    this.free = settings.snip.mode === 'free'
  }

  move(samples) {
    if (!this.start) return
    const v = this.ed.view
    for (const s of samples) {
      this.cur = v.toWorld(s.cx, s.cy)
      if (this.free && Math.hypot(s.cx - this.lastC.x, s.cy - this.lastC.y) >= 3) {
        this.lastC = { x: s.cx, y: s.cy }
        this.poly.push(this.cur.x, this.cur.y)
      }
    }
    if (this.free) drawDashedPath(v, this.poly, true, 'rgba(49,87,214,0.08)')
    else {
      const a = this.start, b = this.cur
      drawDashedPath(v, [a.x, a.y, b.x, a.y, b.x, b.y, a.x, b.y], true, 'rgba(49,87,214,0.08)')
    }
  }

  up() {
    if (!this.start) return
    const v = this.ed.view
    v.clearLive()
    let rect, poly = null
    if (this.free) {
      const P = this.poly
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < P.length; i += 2) {
        x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i])
        y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1])
      }
      rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      poly = P
    } else {
      const a = this.start, b = this.cur
      rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
    }
    this.start = null
    if (rect.w * v.s < 12 || rect.h * v.s < 12) return
    this.ed.snipRegion(rect, poly)
  }

  cancel() {
    this.start = null
    this.ed.view.clearLive()
  }
}
