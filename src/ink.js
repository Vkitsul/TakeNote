// Geometria e disegno dei tratti di penna e delle immagini.
// Un tratto: { id, t:'s', k: tipo, c: colore, w: spessore, sp: pressione simulata, pts: Float32Array [x,y,p,...], bb }
// Un'immagine: { id, t:'i', f: fileId, x, y, w, h }
import { getStroke } from 'perfect-freehand'
import { uid, bbIntersects, distSqToSegment } from './util.js'
import { getImage } from './images.js'
import { isDark, displayColor, DARK_FILTER } from './theme.js'

// line: true = polilinea a spessore costante (come Paint): nessuna pressione né smussatura
export const PEN_TYPES = {
  plain: { label: 'Tratto uniforme', line: true, alpha: 1 },
  fountain: { label: 'Stilografica', thinning: 0.6, smoothing: 0.55, streamline: 0.32, alpha: 1 },
  ballpoint: { label: 'Sfera', thinning: 0.18, smoothing: 0.5, streamline: 0.32, alpha: 1 },
  brush: { label: 'Pennello', thinning: 0.82, smoothing: 0.6, streamline: 0.38, alpha: 1, taper: true },
  pencil: { label: 'Matita', thinning: 0.4, smoothing: 0.5, streamline: 0.3, alpha: 0.88, texture: true },
  highlighter: { label: 'Evidenziatore', line: true, alpha: 0.38, blend: 'multiply' },
}

export function strokeBB(pts, w) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const pad = w + 1
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
}

export function makeStroke(k, c, w, pts, sp) {
  const arr = pts instanceof Float32Array ? pts : Float32Array.from(pts)
  return { id: uid(), t: 's', k, c, w, sp: !!sp, pts: arr, bb: strokeBB(arr, w) }
}

export function itemBB(it) {
  return it.t === 's' ? it.bb : [it.x, it.y, it.x + it.w, it.y + it.h]
}

function toInput(pts) {
  const out = new Array(pts.length / 3)
  for (let i = 0, j = 0; i < pts.length; i += 3, j++) out[j] = [pts[i], pts[i + 1], pts[i + 2]]
  return out
}

export function strokeOutline(s, last = true) {
  const T = PEN_TYPES[s.k] || PEN_TYPES.ballpoint
  const opts = {
    size: s.w,
    thinning: T.thinning,
    smoothing: T.smoothing,
    streamline: T.streamline,
    simulatePressure: !!s.sp && T.thinning > 0.3,
    last,
  }
  if (T.taper) {
    opts.start = { taper: s.w * 5, cap: true }
    opts.end = { taper: s.w * 5, cap: true }
  }
  return getStroke(toInput(s.pts), opts)
}

const f2 = (v) => Math.round(v * 100) / 100

export function polylinePath(pts) {
  const p = new Path2D()
  if (pts.length < 3) return p
  p.moveTo(pts[0], pts[1])
  // un punto solo: segmento minuscolo, così il tappo tondo disegna il puntino
  if (pts.length === 3) p.lineTo(pts[0] + 0.01, pts[1])
  else for (let i = 3; i < pts.length; i += 3) p.lineTo(pts[i], pts[i + 1])
  return p
}

// Tracciato SVG della polilinea (per l'export PDF)
export function polylineSvg(pts) {
  if (pts.length < 3) return ''
  let d = `M${f2(pts[0])} ${f2(pts[1])}`
  if (pts.length === 3) d += `L${f2(pts[0] + 0.01)} ${f2(pts[1])}`
  else for (let i = 3; i < pts.length; i += 3) d += `L${f2(pts[i])} ${f2(pts[i + 1])}`
  return d
}

export function outlineToPath(o) {
  const p = new Path2D()
  const n = o.length
  if (n < 2) return p
  p.moveTo((o[0][0] + o[1][0]) / 2, (o[0][1] + o[1][1]) / 2)
  for (let i = 1; i <= n; i++) {
    const a = o[i % n]
    const b = o[(i + 1) % n]
    p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  }
  p.closePath()
  return p
}

// Stesso contorno in formato SVG (per l'export PDF)
export function outlineToSvg(o) {
  const n = o.length
  if (n < 2) return ''
  let d = `M${f2((o[0][0] + o[1][0]) / 2)} ${f2((o[0][1] + o[1][1]) / 2)}`
  for (let i = 1; i <= n; i++) {
    const a = o[i % n]
    const b = o[(i + 1) % n]
    d += `Q${f2(a[0])} ${f2(a[1])} ${f2((a[0] + b[0]) / 2)} ${f2((a[1] + b[1]) / 2)}`
  }
  return d + 'Z'
}

const pathCache = new WeakMap()
export function strokePath(s) {
  let p = pathCache.get(s)
  if (!p) {
    p = PEN_TYPES[s.k]?.line ? polylinePath(s.pts) : outlineToPath(strokeOutline(s, true))
    pathCache.set(s, p)
  }
  return p
}

// --- Texture matita ---
let noiseTile = null
const pencilPatterns = new Map()
function pencilPattern(ctx, color) {
  let pat = pencilPatterns.get(color)
  if (pat) return pat
  const N = 64
  if (!noiseTile) {
    noiseTile = new Uint8ClampedArray(N * N)
    for (let i = 0; i < N * N; i++) {
      const r = Math.random()
      noiseTile[i] = r < 0.18 ? 60 + r * 300 : 170 + Math.random() * 85
    }
  }
  const c = document.createElement('canvas')
  c.width = c.height = N
  const cx = c.getContext('2d')
  const img = cx.createImageData(N, N)
  const n = parseInt(color.slice(1), 16)
  const R = (n >> 16) & 255, G = (n >> 8) & 255, B = n & 255
  for (let i = 0; i < N * N; i++) {
    img.data[i * 4] = R
    img.data[i * 4 + 1] = G
    img.data[i * 4 + 2] = B
    img.data[i * 4 + 3] = noiseTile[i]
  }
  cx.putImageData(img, 0, 0)
  pat = ctx.createPattern(c, 'repeat')
  pat.setTransform(new DOMMatrix([0.28, 0, 0, 0.28, 0, 0]))
  pencilPatterns.set(color, pat)
  return pat
}

// original = true: colori reali (snip, miniature); altrimenti colori di visualizzazione (modalità scura)
export function applyStrokeStyle(ctx, s, original = false) {
  const T = PEN_TYPES[s.k] || PEN_TYPES.ballpoint
  const dark = !original && isDark()
  const color = original ? s.c : displayColor(s.c)
  ctx.globalAlpha = dark && T.blend ? Math.min(1, T.alpha + 0.08) : T.alpha
  // su fondo scuro l'evidenziatore "schiarisce" invece di moltiplicare
  ctx.globalCompositeOperation = T.blend ? (dark ? 'screen' : T.blend) : 'source-over'
  if (T.line) ctx.strokeStyle = color
  else ctx.fillStyle = T.texture ? pencilPattern(ctx, color) : color
}

export function drawStroke(ctx, s, path = strokePath(s), original = false) {
  applyStrokeStyle(ctx, s, original)
  if (PEN_TYPES[s.k]?.line) {
    ctx.lineWidth = s.w
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(path)
  } else ctx.fill(path)
}

export function drawImageItem(ctx, it, original = false) {
  const bmp = getImage(it.f)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (bmp) {
    if (!original && isDark()) {
      ctx.filter = DARK_FILTER
      ctx.drawImage(bmp, it.x, it.y, it.w, it.h)
      ctx.filter = 'none'
    } else ctx.drawImage(bmp, it.x, it.y, it.w, it.h)
  } else {
    ctx.fillStyle = 'rgba(120,130,150,0.12)'
    ctx.fillRect(it.x, it.y, it.w, it.h)
  }
}

// Disegna gli elementi (ctx già trasformato in coordinate pagina). cull = [x0,y0,x1,y1] opzionale.
export function drawItems(ctx, items, cull, original = false) {
  for (const it of items) {
    if (cull && !bbIntersects(itemBB(it), cull)) continue
    if (it.t === 's') drawStroke(ctx, it, strokePath(it), original)
    else if (it.t === 'i') drawImageItem(ctx, it, original)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

// Scala k attorno all'origine e poi trasla (dx, dy).
export function transformItem(it, k, dx, dy, newId = false) {
  const id = newId ? uid() : it.id
  if (it.t === 's') {
    const src = it.pts
    const out = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      out[i] = src[i] * k + dx
      out[i + 1] = src[i + 1] * k + dy
      out[i + 2] = src[i + 2]
    }
    const w = it.w * k
    return { ...it, id, w, pts: out, bb: strokeBB(out, w) }
  }
  return { ...it, id, x: it.x * k + dx, y: it.y * k + dy, w: it.w * k, h: it.h * k }
}

// Il tratto passa entro r dal segmento (ax,ay)-(bx,by)?
export function strokeHitsSegment(s, ax, ay, bx, by, r) {
  const rr = r + s.w * 0.5
  const pts = s.pts
  const n = pts.length
  if (n === 3) return distSqToSegment(pts[0], pts[1], ax, ay, bx, by) <= rr * rr
  // campiona il segmento della gomma
  const len = Math.hypot(bx - ax, by - ay)
  const steps = Math.max(1, Math.ceil(len / Math.max(1, r * 0.5)))
  for (let k = 0; k <= steps; k++) {
    const px = ax + ((bx - ax) * k) / steps
    const py = ay + ((by - ay) * k) / steps
    for (let i = 0; i < n - 3; i += 3) {
      if (distSqToSegment(px, py, pts[i], pts[i + 1], pts[i + 3], pts[i + 4]) <= rr * rr) return true
    }
  }
  return false
}
