// Shape recognition: "hold" at the end of a stroke to turn it into a line, circle/ellipse, rectangle or triangle.

function rdp(P, eps, a = 0, b = P.length - 1, out = []) {
  let maxD = -1
  let idx = -1
  const [ax, ay] = P[a]
  const [bx, by] = P[b]
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  for (let i = a + 1; i < b; i++) {
    const d = Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / len
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > eps && idx > 0) {
    rdp(P, eps, a, idx, out)
    out.pop()
    rdp(P, eps, idx, b, out)
  } else {
    out.push(P[a], P[b])
  }
  return out
}

function removeCollinear(poly, minAngleDeg) {
  let changed = true
  const pts = poly.slice()
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length]
      const c = pts[i]
      const n = pts[(i + 1) % pts.length]
      const a1 = Math.atan2(c[1] - p[1], c[0] - p[0])
      const a2 = Math.atan2(n[1] - c[1], n[0] - c[0])
      let d = Math.abs(a2 - a1)
      if (d > Math.PI) d = 2 * Math.PI - d
      if ((d * 180) / Math.PI < minAngleDeg) {
        pts.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return pts
}

// pts: flat array [x,y,p,...]. Returns { kind, poly: [[x,y]...], closed } or null.
export function recognizeShape(flat) {
  const P = []
  for (let i = 0; i < flat.length; i += 3) P.push([flat[i], flat[i + 1]])
  if (P.length < 3) return null
  let len = 0
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < P.length; i++) {
    if (i) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])
    x0 = Math.min(x0, P[i][0]); x1 = Math.max(x1, P[i][0])
    y0 = Math.min(y0, P[i][1]); y1 = Math.max(y1, P[i][1])
  }
  const diag = Math.hypot(x1 - x0, y1 - y0)
  if (diag < 4) return null
  const start = P[0]
  const end = P[P.length - 1]
  const gap = Math.hypot(end[0] - start[0], end[1] - start[1])
  const closed = gap < Math.max(diag * 0.22, 6) && len > diag * 1.8

  if (!closed) return { kind: 'line', poly: [start, end], closed: false }

  let simp = rdp(P, diag * 0.07)
  if (simp.length > 1 && Math.hypot(simp[0][0] - simp[simp.length - 1][0], simp[0][1] - simp[simp.length - 1][1]) < diag * 0.2) simp.pop()
  simp = removeCollinear(simp, 28)

  if (simp.length === 3) return { kind: 'triangle', poly: simp, closed: true }
  if (simp.length === 4) {
    // a rectangle almost aligned with the axes?
    let aligned = true
    for (let i = 0; i < 4; i++) {
      const a = simp[i], b = simp[(i + 1) % 4]
      const ang = (Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0])) * 180) / Math.PI
      const off = Math.min(ang % 90, 90 - (ang % 90))
      if (off > 14) aligned = false
    }
    if (aligned) return { kind: 'rect', poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true }
    return { kind: 'quad', poly: simp, closed: true }
  }
  // ellipse inscribed in the box
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  let rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
  if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) rx = ry = (rx + ry) / 2
  const poly = []
  const N = 72
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2 - Math.PI / 2
    poly.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
  }
  return { kind: 'ellipse', poly, closed: true }
}

// Converts a polygon into stroke points with constant pressure.
export function shapeToPoints(poly, closed, step = 3) {
  const out = []
  const pts = closed ? [...poly, poly[0]] : poly
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 0; k < n; k++) out.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, 0.5)
  }
  const last = pts[pts.length - 1]
  out.push(last[0], last[1], 0.5)
  return out
}
