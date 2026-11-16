// Esporta un quaderno in PDF: pagine PDF originali (testo selezionabile) + inchiostro vettoriale + snip.
import { PDFDocument, rgb, BlendMode, LineCapStyle, LineJoinStyle, setLineJoin, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib'
import { strokeOutline, outlineToSvg, polylineSvg, PEN_TYPES } from './ink.js'
import { templateGeometry } from './templates.js'
import { getFileBlob } from './images.js'
import { renderPdfRegion } from './pdfdoc.js'
import { hexToRgb } from './util.js'

const color = (hex) => {
  const [r, g, b] = hexToRgb(hex)
  return rgb(r / 255, g / 255, b / 255)
}

function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

// Avvolge il contenuto originale della pagina in q/Q così il nostro disegno parte da uno stato pulito.
function isolateContent(out, page) {
  const { Contents } = page.node.normalizedEntries()
  if (!Contents || !Contents.size()) return
  const q = out.context.register(out.context.stream('q\n'))
  const Q = out.context.register(out.context.stream('\nQ\n'))
  Contents.insert(0, q)
  Contents.push(Q)
}

export async function exportPdf(doc, onProgress) {
  const out = await PDFDocument.create()
  out.setTitle(doc.nb.title || 'Quaderno')
  out.setCreator('TakeNote')
  const sources = new Map() // fileId -> PDFDocument | null
  const images = new Map() // fileId -> PDFImage

  async function source(fileId) {
    if (sources.has(fileId)) return sources.get(fileId)
    let src = null
    try {
      const blob = await getFileBlob(fileId)
      src = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false })
    } catch (e) {
      console.warn('PDF sorgente non copiabile, uso immagine', e)
    }
    sources.set(fileId, src)
    return src
  }

  async function image(fileId) {
    if (images.has(fileId)) return images.get(fileId)
    let img = null
    try {
      const blob = await getFileBlob(fileId)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      img = blob.type === 'image/jpeg' ? await out.embedJpg(bytes) : await out.embedPng(bytes)
    } catch (e) {
      console.warn('Immagine non incorporata', e)
    }
    images.set(fileId, img)
    return img
  }

  const total = doc.pages.length
  for (let n = 0; n < total; n++) {
    const p = doc.pages[n]
    let page
    // C: matrice da "coordinate SVG" (y verso il basso, unità pagina) allo spazio PDF della pagina
    let C
    if (p.pdf) {
      const src = await source(p.pdf.f)
      if (src) {
        const [copied] = await out.copyPages(src, [p.pdf.i])
        page = out.addPage(copied)
        isolateContent(out, page)
        const M = invert(p.pdf.t)
        C = [M[0], M[1], -M[2], -M[3], M[4], M[5]]
      } else {
        // ripiego: rasterizza la pagina
        page = out.addPage([p.w, p.h])
        const job = renderPdfRegion(p.pdf, 2.5, { x: 0, y: 0, w: p.w, h: p.h }, 0)
        const canvas = await job.promise
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
        const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()))
        canvas.width = canvas.height = 0
        page.drawImage(img, { x: 0, y: 0, width: p.w, height: p.h })
        C = [1, 0, 0, 1, 0, p.h]
      }
    } else {
      page = out.addPage([p.w, p.h])
      C = [1, 0, 0, 1, 0, p.h]
      if (p.paper && p.paper.toLowerCase() !== '#ffffff') {
        page.drawRectangle({ x: 0, y: 0, width: p.w, height: p.h, color: color(p.paper) })
      }
    }

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...C), setLineJoin(LineJoinStyle.Round))

    // sfondo a righe/quadretti/puntini
    if (p.tpl && p.tpl !== 'blank') {
      const g = templateGeometry(p.tpl, p.w, p.h)
      const [r, gg, b] = g.rgb
      if (g.lines.length) {
        let d = ''
        const L = g.lines
        for (let i = 0; i < L.length; i += 4) d += `M${L[i].toFixed(2)} ${L[i + 1].toFixed(2)}L${L[i + 2].toFixed(2)} ${L[i + 3].toFixed(2)}`
        page.drawSvgPath(d, { x: 0, y: 0, borderColor: rgb(r / 255, gg / 255, b / 255), borderWidth: 0.5, borderOpacity: g.alpha })
      }
      for (const x of g.extra) {
        if (!x.lines.length) continue
        let d = ''
        const L = x.lines
        for (let i = 0; i < L.length; i += 4) d += `M${L[i].toFixed(2)} ${L[i + 1].toFixed(2)}L${L[i + 2].toFixed(2)} ${L[i + 3].toFixed(2)}`
        page.drawSvgPath(d, { x: 0, y: 0, borderColor: rgb(r / 255, gg / 255, b / 255), borderWidth: x.lw, borderOpacity: x.alpha })
      }
      if (g.dots.length) {
        let d = ''
        const D = g.dots
        const s = g.dotR
        for (let i = 0; i < D.length; i += 2) d += `M${(D[i] - s).toFixed(2)} ${(D[i + 1] - s).toFixed(2)}h${2 * s}v${2 * s}h${-2 * s}Z`
        page.drawSvgPath(d, { x: 0, y: 0, color: rgb(r / 255, gg / 255, b / 255), opacity: g.alpha })
      }
    }

    for (const it of p.items) {
      if (it.t === 's') {
        const T = PEN_TYPES[it.k] || PEN_TYPES.ballpoint
        const d = T.line ? polylineSvg(it.pts) : outlineToSvg(strokeOutline(it, true))
        if (!d) continue
        const opts = T.line
          ? { x: 0, y: 0, borderColor: color(it.c), borderWidth: it.w, borderLineCap: LineCapStyle.Round }
          : { x: 0, y: 0, color: color(it.c), borderWidth: 0 }
        if (T.alpha < 1) {
          if (T.line) opts.borderOpacity = T.alpha
          else opts.opacity = T.alpha
        }
        if (T.blend === 'multiply') opts.blendMode = BlendMode.Multiply
        page.drawSvgPath(d, opts)
      } else if (it.t === 'i') {
        const img = await image(it.f)
        if (img) page.drawImage(img, { x: it.x, y: -(it.y + it.h), width: it.w, height: it.h })
      }
    }
    page.pushOperators(popGraphicsState())
    onProgress?.((n + 1) / total)
    if (n % 4 === 3) await new Promise((r) => setTimeout(r, 0))
  }

  const bytes = await out.save()
  return new Blob([bytes], { type: 'application/pdf' })
}
