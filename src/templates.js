// Paper backgrounds (lines, grids, dots). Coordinates in PDF points (1/72 inch).
export const MM = 72 / 25.4

export const PAGE_SIZES = {
  a4p: { label: 'A4 portrait', w: 595.28, h: 841.89 },
  a4l: { label: 'A4 landscape', w: 841.89, h: 595.28 },
}

export const TEMPLATES = [
  { id: 'blank', label: 'Blank' },
  { id: 'lined', label: 'Lined' },
  { id: 'narrow', label: 'Narrow lines' },
  { id: 'grid', label: 'Grid 5 mm' },
  { id: 'grid4', label: 'Grid 4 mm' },
  { id: 'mm', label: 'Graph paper (mm)' },
  { id: 'dotted', label: 'Dotted' },
]

export const PAPERS = [
  { c: '#ffffff', label: 'White' },
  { c: '#fbf7ec', label: 'Ivory' },
  { c: '#fffbe6', label: 'Yellow' },
  { c: '#f1f5f9', label: 'Gray' },
]

const geomCache = new Map()

// Returns the template's lines and dots: { lines: [x0,y0,x1,y1,...], dots: [x,y,...], rgb, alpha, dotR, extra }
// extra = other line groups with a different weight: [{ lines, alpha, lw, minRes }]
export function templateGeometry(tpl, w, h) {
  const key = `${tpl}:${w}:${h}`
  let g = geomCache.get(key)
  if (g) return g
  const lines = []
  const dots = []
  const extra = []
  let rgb = [70, 110, 170]
  let alpha = 0.3
  if (tpl === 'lined' || tpl === 'narrow') {
    const sp = (tpl === 'lined' ? 8 : 6) * MM
    const top = (tpl === 'lined' ? 26 : 20) * MM
    for (let y = top; y < h - 8 * MM; y += sp) lines.push(0, y, w, y)
  } else if (tpl === 'grid' || tpl === 'grid4') {
    const sp = (tpl === 'grid' ? 5 : 4) * MM
    rgb = [80, 110, 150]
    alpha = 0.2
    const ox = (w % sp) / 2
    const oy = (h % sp) / 2
    for (let x = ox; x <= w; x += sp) lines.push(x, 0, x, h)
    for (let y = oy; y <= h; y += sp) lines.push(0, y, w, y)
  } else if (tpl === 'mm') {
    // graph paper: 1 mm light, 5 mm medium, 1 cm bold
    rgb = [205, 110, 50]
    alpha = 0.3
    const minor = [], major = []
    const nx = Math.floor(w / MM), ny = Math.floor(h / MM)
    const ox = (w - Math.floor(nx / 10) * 10 * MM) / 2
    const oy = (h - Math.floor(ny / 10) * 10 * MM) / 2
    const kx0 = -Math.floor(ox / MM), ky0 = -Math.floor(oy / MM)
    const pick = (k) => (k % 10 === 0 ? major : k % 5 === 0 ? lines : minor)
    for (let k = kx0; ox + k * MM <= w; k++) pick(Math.abs(k)).push(ox + k * MM, 0, ox + k * MM, h)
    for (let k = ky0; oy + k * MM <= h; k++) pick(Math.abs(k)).push(0, oy + k * MM, w, oy + k * MM)
    extra.push({ lines: minor, alpha: 0.16, lw: 0.3, minRes: 1.4 }, { lines: major, alpha: 0.5, lw: 0.6, minRes: 0 })
  } else if (tpl === 'dotted') {
    const sp = 5 * MM
    rgb = [60, 80, 110]
    alpha = 0.42
    const ox = (w % sp) / 2 || sp / 2
    const oy = (h % sp) / 2 || sp / 2
    for (let y = oy; y < h; y += sp) for (let x = ox; x < w; x += sp) dots.push(x, y)
  }
  g = { lines, dots, rgb, alpha, dotR: 0.6, extra }
  geomCache.set(key, g)
  return g
}

export function drawTemplate(ctx, tpl, w, h, res, dark = false) {
  if (!tpl || tpl === 'blank') return
  const g = templateGeometry(tpl, w, h)
  const [r, gg, b] = dark ? [150, 175, 215] : g.rgb
  const strokeLines = (L, alpha, lw) => {
    if (!L.length) return
    ctx.strokeStyle = `rgba(${r},${gg},${b},${alpha})`
    ctx.lineWidth = Math.max(lw, 1 / res)
    ctx.beginPath()
    for (let i = 0; i < L.length; i += 4) {
      ctx.moveTo(L[i], L[i + 1])
      ctx.lineTo(L[i + 2], L[i + 3])
    }
    ctx.stroke()
  }
  // the densest lines are skipped when they would be only a few pixels apart (thumbnails)
  for (const x of g.extra) if (res >= x.minRes) strokeLines(x.lines, x.alpha, x.lw)
  strokeLines(g.lines, g.alpha, 0.45)
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
