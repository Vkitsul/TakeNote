// Piccole utility condivise.

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12)
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export function debounce(fn, ms) {
  let t = 0
  const d = (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
  d.flush = (...args) => {
    clearTimeout(t)
    return fn(...args)
  }
  d.cancel = () => clearTimeout(t)
  return d
}

// Crea elementi DOM: h('div', { class: 'x', onclick }, 'testo', figlio)
export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  if (props) {
    for (const k in props) {
      const v = props[k]
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'style' && typeof v === 'object') {
        for (const sk in v) {
          if (sk.startsWith('--')) el.style.setProperty(sk, v[sk])
          else el.style[sk] = v[sk]
        }
      }
      else if (k === 'html') el.innerHTML = v
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
      else if (k === 'dataset') Object.assign(el.dataset, v)
      else el.setAttribute(k, v === true ? '' : v)
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue
    el.append(c.nodeType ? c : document.createTextNode(String(c)))
  }
  return el
}

// --- Geometria ---

export function distSqToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

// poly: array piatto [x0,y0,x1,y1,...]
export function pointInPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const bbIntersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

export function bbUnion(a, b) {
  if (!a) return b && [...b]
  if (!b) return [...a]
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

export function hexToRgb(hex) {
  let s = hex.replace('#', '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
}

export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5) * 255, f(3) * 255, f(1) * 255]
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let hh = 0
  if (d) {
    if (max === r) hh = ((g - b) / d) % 6
    else if (max === g) hh = (b - r) / d + 2
    else hh = (r - g) / d + 4
    hh *= 60
    if (hh < 0) hh += 360
  }
  return [hh, max ? d / max : 0, max]
}

export function formatDate(ts) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return 'Oggi, ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))
