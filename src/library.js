// Libreria: cartelle (materie) e quaderni.
import { h, uid, formatDate } from './util.js'
import { icon } from './icons.js'
import * as db from './db.js'
import { newNotebook, newPage } from './doc.js'
import { TEMPLATES, PAPERS, PAGE_SIZES } from './templates.js'
import { importPdfPages } from './importer.js'
import { createBackup, restoreBackup, collectGarbage } from './backup.js'
import { exportPdf } from './export.js'
import { NotebookDoc } from './doc.js'
import { shareFile, shareUri, saveFile, pickFile, safeFileName, onBack } from './platform.js'
import { forgetPdf } from './pdfdoc.js'
import { openDialog, promptDialog, confirmDialog, menu, toast, progressDialog } from './ui.js'
import { openSettingsDialog } from './editor/editor.js'
import { isDark, setDark, onTheme } from './theme.js'
import { openAutoBackupDialog, backupStatusChip } from './backupdialog.js'
import { autoBackupSupported, writeBackupFile } from './autobackup.js'
import { settings, saveSettings } from './settings.js'

const COVERS = ['#3157d6', '#0c8599', '#2b8a3e', '#e8590c', '#c92a2a', '#9c36b5', '#495057', '#a17044']
const FOLDER_KEY = 'library.folder'

export class Library {
  constructor(root, { onOpen }) {
    this.root = root
    this.onOpen = onOpen
    this.folder = localStorageGet(FOLDER_KEY) || 'all'
    this.urls = []
    this.el = h('div', { class: 'library' })
    this.nav = h('nav', { class: 'folders' })
    this.grid = h('main', { class: 'nb-grid' })
    this.heading = h('h1', { class: 'lib-heading' })
    const bar = h(
      'header',
      { class: 'lib-bar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('fountain', 22)), h('span', null, 'TakeNote'), (this.chip = backupStatusChip())),
      h(
        'div',
        { class: 'lib-actions' },
        h('button', { class: 'btn', onclick: () => this.importPdf() }, icon('file', 18), h('span', { class: 'hide-sm' }, 'Importa PDF')),
        h('button', { class: 'btn primary', onclick: () => this.newNotebookDialog() }, icon('plus', 18), h('span', null, 'Nuovo quaderno')),
        (this.themeBtn = h('button', { class: 'icon-btn', title: 'Modalità scura', onclick: () => setDark(!isDark()) }, icon(isDark() ? 'sun' : 'moon'))),
        h('button', { class: 'icon-btn', title: 'Altro', onclick: (e) => this.mainMenu(e.currentTarget) }, icon('more'))
      )
    )
    this.offTheme = onTheme(() => this.themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon')))
    this.banner = h('div')
    this.el.append(bar, h('div', { class: 'lib-body' }, this.nav, h('section', { class: 'lib-content' }, this.banner, this.heading, this.grid)))
    root.append(this.el)
    this.offBack = onBack(() => {
      if (document.querySelector('.dialog-backdrop')) {
        document.querySelector('.dialog-backdrop').remove()
        return true
      }
      return false
    })
    this.render()
  }

  destroy() {
    this.offBack()
    this.offTheme()
    this.chip.destroy()
    this.revoke()
    this.el.remove()
  }

  revoke() {
    for (const u of this.urls) URL.revokeObjectURL(u)
    this.urls = []
  }

  async render() {
    const [notebooks, folders] = await Promise.all([db.all('notebooks'), db.all('folders')])
    folders.sort((a, b) => a.name.localeCompare(b.name, 'it'))
    this.folders = folders
    if (this.folder !== 'all' && !folders.some((f) => f.id === this.folder)) this.folder = 'all'
    this.renderNav(folders, notebooks)
    this.renderBanner(notebooks.length)
    const list = notebooks.filter((n) => this.folder === 'all' || n.folderId === this.folder).sort((a, b) => b.updatedAt - a.updatedAt)
    const folder = folders.find((f) => f.id === this.folder)
    this.heading.replaceChildren(folder ? folder.name : 'Tutti i quaderni')
    if (folder) {
      this.heading.append(h('button', { class: 'icon-btn small', title: 'Opzioni cartella', onclick: (e) => this.folderMenu(folder, e.currentTarget) }, icon('more', 18)))
    }
    this.revoke()
    if (!list.length) {
      this.grid.replaceChildren(
        h(
          'div',
          { class: 'lib-empty' },
          icon('book', 44),
          h('h2', null, folder ? 'Cartella vuota' : 'Nessun quaderno'),
          h('p', null, 'Crea un quaderno per scrivere con la penna, oppure importa un PDF da annotare.'),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => this.newNotebookDialog() }, 'Nuovo quaderno'), h('button', { class: 'btn', onclick: () => this.importPdf() }, 'Importa PDF'))
        )
      )
      return
    }
    this.grid.replaceChildren(...list.map((nb) => this.card(nb)))
  }

  // Suggerisce di attivare il backup su Google Drive finché non è configurato.
  renderBanner(count) {
    const cfg = settings.autoBackup
    const show = autoBackupSupported && count > 0 && !cfg.bannerDismissed && !(cfg.enabled && cfg.target === 'drive' && cfg.uri)
    if (!show) {
      this.banner.replaceChildren()
      return
    }
    const close = h('button', { class: 'icon-btn small', title: 'Non mostrare più' }, icon('close', 18))
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      cfg.bannerDismissed = true
      saveSettings()
      this.banner.replaceChildren()
    })
    this.banner.replaceChildren(
      h(
        'div',
        { class: 'lib-banner', onclick: () => openAutoBackupDialog() },
        h('span', { class: 'dest-ic' }, icon('backup', 22)),
        h('div', null, h('b', null, 'Proteggi i tuoi quaderni con Google Drive'), h('span', { class: 'muted small' }, 'Ora sono salvati solo su questo tablet. Tocca per attivare il backup automatico su Drive.')),
        close
      )
    )
  }

  renderNav(folders, notebooks) {
    const count = (id) => notebooks.filter((n) => (id === 'all' ? true : n.folderId === id)).length
    const item = (id, name, ic, color) =>
      h(
        'button',
        { class: 'folder-item' + (this.folder === id ? ' active' : ''), onclick: () => this.setFolder(id) },
        h('span', { class: 'folder-ic', style: color ? { color } : null }, icon(ic, 20)),
        h('span', { class: 'folder-name' }, name),
        h('span', { class: 'folder-count' }, count(id))
      )
    this.nav.replaceChildren(
      item('all', 'Tutti i quaderni', 'book'),
      ...folders.map((f) => item(f.id, f.name, 'folder', f.color)),
      h('button', { class: 'folder-item add', onclick: () => this.newFolder() }, h('span', { class: 'folder-ic' }, icon('plus', 20)), h('span', { class: 'folder-name' }, 'Nuova cartella'))
    )
  }

  setFolder(id) {
    this.folder = id
    localStorageSet(FOLDER_KEY, id)
    this.render()
  }

  card(nb) {
    const cover = h('div', { class: 'nb-cover', style: { '--cover': nb.cover || COVERS[0] } })
    if (nb.thumb instanceof Blob) {
      const u = URL.createObjectURL(nb.thumb)
      this.urls.push(u)
      cover.append(h('img', { src: u, alt: '' }))
    } else cover.append(h('span', { class: 'nb-initial' }, (nb.title || '?').trim().charAt(0).toUpperCase()))
    cover.append(h('span', { class: 'nb-spine' }))
    const more = h('button', { class: 'icon-btn small nb-more', title: 'Opzioni' }, icon('more', 18))
    more.addEventListener('click', (e) => {
      e.stopPropagation()
      this.notebookMenu(nb, more)
    })
    const el = h(
      'div',
      { class: 'nb-card', tabindex: 0 },
      cover,
      h('div', { class: 'nb-info' }, h('div', { class: 'nb-title' }, nb.title), h('div', { class: 'nb-meta' }, `${formatDate(nb.updatedAt)} · ${nb.pageIds.length} pag.`)),
      more
    )
    el.addEventListener('click', () => this.onOpen(nb.id))
    return el
  }

  // --- Quaderni ---
  newNotebookDialog() {
    let tpl = 'grid'
    let paper = '#ffffff'
    let size = 'a4p'
    let cover = COVERS[Math.floor(Math.random() * COVERS.length)]
    let folderId = this.folder === 'all' ? null : this.folder
    const title = h('input', { class: 'input', type: 'text', placeholder: 'Es. Analisi 1 — Lezione 3', value: '' })
    const tplGrid = h('div', { class: 'tpl-grid' })
    for (const t of TEMPLATES) {
      const b = h('button', { class: 'tpl-opt' + (t.id === tpl ? ' active' : '') }, h('span', { class: 'tpl-prev pv-' + t.id }), h('span', null, t.label))
      b.onclick = () => {
        tpl = t.id
        tplGrid.querySelectorAll('.tpl-opt').forEach((x) => x.classList.remove('active'))
        b.classList.add('active')
      }
      tplGrid.append(b)
    }
    const choice = (items, cur, render, set) => {
      const row = h('div', { class: 'choice-row' })
      for (const it of items) {
        const b = render(it)
        if (it.value === cur) b.classList.add('active')
        b.onclick = () => {
          set(it.value)
          row.querySelectorAll('.active').forEach((x) => x.classList.remove('active'))
          b.classList.add('active')
        }
        row.append(b)
      }
      return row
    }
    const sizeRow = choice(
      Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label })),
      size,
      (it) => h('button', { class: 'chip' }, it.label),
      (v) => { size = v }
    )
    const paperRow = choice(
      PAPERS.map((p) => ({ value: p.c, label: p.label })),
      paper,
      (it) => h('button', { class: 'paper-opt', style: { background: it.value }, title: it.label }),
      (v) => { paper = v }
    )
    const coverRow = choice(
      COVERS.map((c) => ({ value: c })),
      cover,
      (it) => h('button', { class: 'cover-opt', style: { background: it.value } }),
      (v) => { cover = v }
    )
    const folderSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Nessuna cartella'), ...this.folders.map((f) => h('option', { value: f.id }, f.name)))
    folderSel.value = folderId || ''
    folderSel.onchange = () => { folderId = folderSel.value || null }
    openDialog({
      title: 'Nuovo quaderno',
      className: 'wide',
      body: h(
        'div',
        { class: 'form' },
        h('label', { class: 'field' }, h('span', null, 'Nome'), title),
        h('div', { class: 'field' }, h('span', null, 'Sfondo'), tplGrid),
        h('div', { class: 'field' }, h('span', null, 'Formato'), sizeRow),
        h('div', { class: 'field two' }, h('div', null, h('span', null, 'Carta'), paperRow), h('div', null, h('span', null, 'Copertina'), coverRow)),
        h('label', { class: 'field' }, h('span', null, 'Cartella'), folderSel)
      ),
      actions: [
        { label: 'Annulla' },
        {
          label: 'Crea',
          primary: true,
          onClick: async () => {
            const name = title.value.trim() || 'Quaderno ' + new Date().toLocaleDateString('it-IT')
            const nb = newNotebook({ title: name, folderId, tpl, paper, size, cover })
            const sz = PAGE_SIZES[size]
            const p = newPage(nb.id, { w: sz.w, h: sz.h, tpl, paper })
            nb.pageIds = [p.id]
            await db.batch([{ store: 'pages', put: p }, { store: 'notebooks', put: nb }])
            this.onOpen(nb.id)
          },
        },
      ],
    })
    setTimeout(() => title.focus(), 60)
  }

  async importPdf() {
    const file = await pickFile('application/pdf')
    if (!file) return
    const prog = progressDialog('Importazione PDF')
    try {
      const nb = newNotebook({
        title: (file.name || 'Documento').replace(/\.pdf$/i, ''),
        folderId: this.folder === 'all' ? null : this.folder,
        tpl: 'blank',
        cover: COVERS[Math.floor(Math.random() * COVERS.length)],
      })
      const pages = await importPdfPages(file, nb.id, (f) => prog.set(f, 'Lettura pagine…'))
      nb.pageIds = pages.map((p) => p.id)
      await db.putMany('pages', pages)
      await db.put('notebooks', nb)
      prog.close()
      this.onOpen(nb.id)
    } catch (e) {
      prog.close()
      console.error(e)
      toast('Impossibile aprire il PDF (file danneggiato o protetto da password)')
    }
  }

  notebookMenu(nb, anchor) {
    menu(anchor, [
      { label: 'Apri', icon: 'book', onClick: () => this.onOpen(nb.id) },
      { label: 'Rinomina', icon: 'settings', onClick: () => this.renameNotebook(nb) },
      { label: 'Sposta in cartella', icon: 'folder', onClick: () => this.moveNotebook(nb) },
      { label: 'Colore copertina', icon: 'palette', onClick: () => this.coverDialog(nb) },
      '-',
      { label: 'Esporta / condividi PDF', icon: 'share', onClick: () => this.exportNotebook(nb, false) },
      { label: 'Salva PDF in Documenti', icon: 'download', onClick: () => this.exportNotebook(nb, true) },
      { label: 'Backup di questo quaderno', icon: 'backup', onClick: () => this.backup([nb.id], safeFileName(nb.title)) },
      '-',
      { label: 'Elimina', icon: 'trash', danger: true, onClick: () => this.deleteNotebook(nb) },
    ])
  }

  async renameNotebook(nb) {
    const t = await promptDialog('Nome del quaderno', nb.title, { okLabel: 'Rinomina' })
    if (!t) return
    nb.title = t
    nb.updatedAt = Date.now()
    await db.put('notebooks', nb)
    this.render()
  }

  moveNotebook(nb) {
    const sel = h('select', { class: 'input' }, h('option', { value: '' }, 'Nessuna cartella'), ...this.folders.map((f) => h('option', { value: f.id }, f.name)))
    sel.value = nb.folderId || ''
    openDialog({
      title: 'Sposta in cartella',
      body: sel,
      actions: [
        { label: 'Annulla' },
        {
          label: 'Sposta',
          primary: true,
          onClick: async () => {
            nb.folderId = sel.value || null
            await db.put('notebooks', nb)
            this.render()
          },
        },
      ],
    })
  }

  coverDialog(nb) {
    const row = h('div', { class: 'choice-row' })
    for (const c of COVERS) {
      const b = h('button', { class: 'cover-opt' + (c === nb.cover ? ' active' : ''), style: { background: c } })
      b.onclick = async () => {
        nb.cover = c
        await db.put('notebooks', nb)
        d.close()
        this.render()
      }
      row.append(b)
    }
    const d = openDialog({ title: 'Colore copertina', body: row, actions: [{ label: 'Chiudi' }] })
  }

  async exportNotebook(nb, toDocuments) {
    const prog = progressDialog('Esportazione PDF')
    try {
      const doc = await NotebookDoc.load(nb.id)
      const blob = await exportPdf(doc, (f) => prog.set(f, `Pagina ${Math.round(f * doc.pages.length)} di ${doc.pages.length}`))
      prog.close()
      const name = safeFileName(nb.title) + '.pdf'
      if (toDocuments) toast('Salvato: ' + (await saveFile(blob, name)), 3500)
      else await shareFile(blob, name, nb.title)
    } catch (e) {
      prog.close()
      console.error(e)
      toast('Esportazione non riuscita')
    }
  }

  async deleteNotebook(nb) {
    if (!(await confirmDialog(`Eliminare definitivamente "${nb.title}"? L'operazione non si può annullare.`, { okLabel: 'Elimina', danger: true }))) return
    const pages = await db.byIndex('pages', 'notebookId', nb.id)
    const pdfs = new Set(pages.filter((p) => p.pdf).map((p) => p.pdf.f))
    await db.batch([...pages.map((p) => ({ store: 'pages', del: p.id })), { store: 'notebooks', del: nb.id }])
    for (const f of pdfs) forgetPdf(f)
    collectGarbage().catch(() => {})
    toast('Quaderno eliminato')
    this.render()
  }

  // --- Cartelle ---
  async newFolder() {
    const name = await promptDialog('Nuova cartella (es. materia)', '', { okLabel: 'Crea', placeholder: 'Es. Fisica 2' })
    if (!name) return
    const f = { id: uid(), name, color: COVERS[Math.floor(Math.random() * COVERS.length)], createdAt: Date.now() }
    await db.put('folders', f)
    this.setFolder(f.id)
  }

  folderMenu(folder, anchor) {
    menu(anchor, [
      {
        label: 'Rinomina cartella',
        icon: 'settings',
        onClick: async () => {
          const n = await promptDialog('Nome della cartella', folder.name, { okLabel: 'Rinomina' })
          if (!n) return
          folder.name = n
          await db.put('folders', folder)
          this.render()
        },
      },
      {
        label: 'Elimina cartella',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          if (!(await confirmDialog(`Eliminare la cartella "${folder.name}"? I quaderni al suo interno non verranno eliminati.`, { okLabel: 'Elimina', danger: true }))) return
          const nbs = (await db.all('notebooks')).filter((n) => n.folderId === folder.id)
          await db.batch([...nbs.map((n) => ({ store: 'notebooks', put: { ...n, folderId: null } })), { store: 'folders', del: folder.id }])
          this.setFolder('all')
        },
      },
    ])
  }

  // --- Backup ---
  mainMenu(anchor) {
    menu(anchor, [
      { label: 'Backup automatico…', icon: 'backup', onClick: () => openAutoBackupDialog() },
      { label: 'Backup completo ora (.takenote)', icon: 'share', onClick: () => this.backup(null, 'TakeNote-backup-' + new Date().toISOString().slice(0, 10)) },
      { label: 'Ripristina da backup…', icon: 'download', onClick: () => this.restore() },
      '-',
      { label: 'Impostazioni penna e tocco', icon: 'settings', onClick: () => openSettingsDialog() },
      { label: 'Informazioni', icon: 'book', onClick: () => this.about() },
    ])
  }

  async backup(ids, name) {
    const prog = progressDialog('Creazione backup')
    try {
      if (!ids && autoBackupSupported) {
        // backup completo scritto su file a pezzi: non serve tenerlo tutto in memoria
        const uri = await writeBackupFile(name + '.takenote', 'Cache', (f) => prog.set(f))
        prog.close()
        await shareUri(uri, 'Backup TakeNote')
        return
      }
      const blob = await createBackup(ids, (f) => prog.set(f))
      prog.close()
      await shareFile(blob, name + '.takenote', 'Backup TakeNote')
    } catch (e) {
      prog.close()
      console.error(e)
      toast('Backup non riuscito')
    }
  }

  async restore() {
    const file = await pickFile('*/*')
    if (!file) return
    const prog = progressDialog('Ripristino backup')
    try {
      const r = await restoreBackup(file, (f) => prog.set(f))
      prog.close()
      toast(`Ripristinati ${r.notebooks} quaderni`)
      this.render()
    } catch (e) {
      prog.close()
      console.error(e)
      toast('Backup non valido')
    }
  }

  about() {
    openDialog({
      title: 'TakeNote',
      body: h(
        'div',
        { class: 'about' },
        h('p', null, 'Appunti a mano libera con la penna: quaderni, PDF annotabili e snip.'),
        h('p', { class: 'muted' }, 'I tuoi quaderni sono salvati solo su questo dispositivo. Disinstallando l\'app vengono cancellati: fai ogni tanto un "Backup completo" e conservalo (es. su Drive).'),
        h('p', { class: 'muted' }, 'Gesti: 1 dito scorre · 2 dita zoom · doppio tocco adatta · tocco con 2 dita annulla · 3 dita ripeti · tieni premuto a fine tratto per le forme.')
      ),
      actions: [{ label: 'OK', primary: true }],
    })
  }
}

function localStorageGet(k) {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function localStorageSet(k, v) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignora */
  }
}
