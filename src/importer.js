// PDF import: stores the file and creates one page per PDF page.
import * as db from './db.js'
import { uid } from './util.js'
import { newPage } from './doc.js'
import { openPdfData, readPdfPages } from './pdfdoc.js'

export async function storePdfFile(file) {
  const id = uid()
  const blob = file instanceof Blob ? file : new Blob([file], { type: 'application/pdf' })
  await db.put('files', { id, blob, type: 'application/pdf', name: file.name || 'documento.pdf', createdAt: Date.now() })
  return id
}

export async function importPdfPages(file, notebookId, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await openPdfData(data.slice())
  try {
    const infos = await readPdfPages(pdf, onProgress)
    const fileId = await storePdfFile(file)
    return infos.map((info, i) => newPage(notebookId, { w: info.w, h: info.h, tpl: 'blank', paper: '#ffffff', pdf: { f: fileId, i, t: info.t } }))
  } finally {
    pdf.destroy()
  }
}
