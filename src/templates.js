// Sfondi carta (righe, quadretti, puntini). Coordinate in punti PDF (1/72 di pollice).
export const MM = 72 / 25.4

export const PAGE_SIZES = {
  a4p: { label: 'A4 verticale', w: 595.28, h: 841.89 },
  a4l: { label: 'A4 orizzontale', w: 841.89, h: 595.28 },
}

export const TEMPLATES = [
  { id: 'blank', label: 'Bianco' },
  { id: 'lined', label: 'Righe' },
  { id: 'narrow', label: 'Righe strette' },
  { id: 'grid', label: 'Quadretti' },
  { id: 'dotted', label: 'Puntini' },
]

export const PAPERS = [
  { c: '#ffffff', label: 'Bianca' },
  { c: '#fbf7ec', label: 'Avorio' },
  { c: '#fffbe6', label: 'Gialla' },
  { c: '#f1f5f9', label: 'Grigia' },
]

const geomCache = new Map()

// Restituisce linee e punti del modello: { lines: [x0,y0,x1,y1,...], dots: [x,y,...], rgb, alpha, dotR }
export function templateGeometry(tpl, w, h) {
  const key = `${tpl}:${w}:${h}`
  let g = geomCache.get(key)
  if (g) return g
  const lines = []
  const dots = []
  let rgb = [70, 110, 170]
  let alpha = 0.3
  if (tpl === 'lined' || tpl === 'narrow') {
    const sp = (tpl === 'lined' ? 8 : 6) * MM
    const top = (tpl === 'lined' ? 26 : 20) * MM
    for (let y = top; y < h - 8 * MM; y += sp) lines.push(0, y, w, y)
  } else if (tpl === 'grid') {
    const sp = 5 * MM
    rgb = [80, 110, 150]
    alpha = 0.2
    const ox = (w % sp) / 2
    const oy = (h % sp) / 2
    for (let x = ox; x <= w; x += sp) lines.push(x, 0, x, h)
    for (let y = oy; y <= h; y += sp) lines.push(0, y, w, y)
  } else if (tpl === 'dotted') {
    const sp = 5 * MM
    rgb = [60, 80, 110]
    alpha = 0.42
    const ox = (w % sp) / 2 || sp / 2
    const oy = (h % sp) / 2 || sp / 2
    for (let y = oy; y < h; y += sp) for (let x = ox; x < w; x += sp) dots.push(x, y)
  }
  g = { lines, dots, rgb, alpha, dotR: 0.6 }
  geomCache.set(key, g)
  return g
}

export function drawTemplate(ctx, tpl, w, h, res, dark = false) {
  if (!tpl || tpl === 'blank') return
  const g = templateGeometry(tpl, w, h)
  const [r, gg, b] = dark ? [150, 175, 215] : g.rgb
  if (g.lines.length) {
    ctx.strokeStyle = `rgba(${r},${gg},${b},${g.alpha})`
    ctx.lineWidth = Math.max(0.45, 1 / res)
    ctx.beginPath()
    const L = g.lines
    for (let i = 0; i < L.length; i += 4) {
      ctx.moveTo(L[i], L[i + 1])
      ctx.lineTo(L[i + 2], L[i + 3])
    }
    ctx.stroke()
  }
  if (g.dots.length) {
    ctx.fillStyle = `rgba(${r},${gg},${b},${g.alpha})`
    const d = Math.max(g.dotR, 1.1 / res)
    const D = g.dots
    ctx.beginPath()
    for (let i = 0; i < D.length; i += 2) {
      ctx.moveTo(D[i] + d, D[i + 1])
      ctx.arc(D[i], D[i + 1], d, 0, Math.PI * 2)
    }
    ctx.fill()
  }
}
