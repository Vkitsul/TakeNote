// Copia cmaps e font standard di pdf.js in public/ così funzionano offline.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const dst = join(root, 'public', 'pdfjs')
if (!existsSync(src)) process.exit(0)
mkdirSync(dst, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts']) {
  cpSync(join(src, dir), join(dst, dir), { recursive: true })
}
console.log('pdf.js assets copiati in public/pdfjs')
