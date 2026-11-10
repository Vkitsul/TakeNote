// Editor di un quaderno: unisce vista, strumenti, selezione, cronologia, pannelli e input penna/dita.
import { h, clamp, uid } from '../util.js'
import { settings, saveSettings } from '../settings.js'
import { NotebookDoc, newPage } from '../doc.js'
import * as db from '../db.js'
import { View } from './view.js'
import { History } from './history.js'
import { Toolbar } from './toolbar.js'
import { Selection } from './selection.js'
import { PenTool, EraserTool, LassoTool, SnipTool } from './tools.js'
import { PagesPanel } from './pagespanel.js'
import { SnipsPanel } from './snipspanel.js'
import { PenBar } from './penbar.js'
import { NativeInk } from './nativeink.js'
import { setPdfRenderPaused } from '../pdfdoc.js'
import { onPenButton, actionInfo, releaseAll, PEN_ACTIONS, learnButton, cancelLearn, setBinding, onRawPenSignal } from '../penbuttons.js'
import { drawItems, itemBB, transformItem } from '../ink.js'
import { renderPdfRegion } from '../pdfdoc.js'
import { storeImageBlob } from '../images.js'
import { notebookCover } from '../thumbs.js'
import { exportPdf } from '../export.js'
import { shareFile, saveFile, onBack, safeFileName, pickFile, isNative } from '../platform.js'
import { importPdfPages } from '../importer.js'
import { TEMPLATES, PAPERS } from '../templates.js'
import { toast, menu, openDialog, promptDialog, progressDialog, slider, toggle, closePopover } from '../ui.js'
import { icon } from '../icons.js'
import { onTheme, isDark, setDark } from '../theme.js'

let clipboard = null // condiviso tra quaderni

export class Editor {
  static async open(root, notebookId, onClose) {
    const doc = await NotebookDoc.load(notebookId)
    return new Editor(root, doc, onClose)
  }

  constructor(root, doc, onClose) {
    this.doc = doc
    this.onCloseCb = onClose
    this.tool = ['pen', 'highlighter', 'eraser', 'lasso', 'snip'].includes(settings.tool) ? settings.tool : 'pen'
    this.toolPtr = null
    this.holdTool = null // strumento temporaneo mentre si tiene premuto un tasto della penna
    this.prevTool = 'pen'
    this.lastPen = -1e9
    this.mousePan = null
    this.history = new History(doc, () => this.toolbar?.refreshHistory())

    this.el = h('div', { class: 'editor' })
    this.main = h('div', { class: 'ed-main' })
    this.canvasWrap = h('div', { class: 'ed-canvas' })
    this.pageInd = h('button', { class: 'page-indicator', onclick: () => this.goToPagePrompt() })
    this.main.append(this.canvasWrap)
    root.append(this.el)

    this.view = new View(this.canvasWrap, doc, { onAddPage: () => this.addPageAfter(this.doc.pages.length - 1) })
    this.selection = new Selection(this)
    this.tools = {
      pen: new PenTool(this, 'pen'),
      highlighter: new PenTool(this, 'highlighter'),
      eraser: new EraserTool(this),
      lasso: new LassoTool(this),
      snip: new SnipTool(this),
    }
    this.toolbar = new Toolbar(this)
    this.pagesPanel = new PagesPanel(this)
    this.snipsPanel = new SnipsPanel(this)
    this.main.append(this.pagesPanel.el, this.snipsPanel.el, this.pageInd)
    this.el.append(this.toolbar.el, this.main)
    this.penBar = new PenBar(this)
    this.offPenBtn = onPenButton((ev) => this.onPenButton(ev))
    this.nativeInk = new NativeInk(this)
    this.lastInk = -1e9
    this.view.isBusy = () => this.writing()
    doc.isBusy = () => this.writing()
    this.offTheme = onTheme(() => {
      this.view.refreshTheme()
      if (this.selection.active) this.selection.render()
      this.toolbar.refresh()
      this.nativeInk.sync()
    })
    // inizializza subito la camera, senza aspettare il primo callback del ResizeObserver
    this.view.onResize()

    this.view.handlers = {
      twoFingerTap: () => settings.twoFingerUndo && this.undo(),
      threeFingerTap: () => settings.twoFingerUndo && this.redo(),
      doubleTap: (x, y) => this.view.toggleFit(x, y),
      tap: () => this.selection.drop(),
    }
    this.unsubCam = this.view.onCamera(() => this.updateIndicator())
    this.unsubPages = doc.on('pages', () => {
      this.updateIndicator()
      this.pagesPanel.refresh()
    })
    this.attachInput()
    this.onKey = (e) => this.handleKey(e)
    window.addEventListener('keydown', this.onKey)
    this.onHide = (e) => {
      if (document.visibilityState === 'hidden' || e?.type === 'app-pause') {
        this.toolPtr = null
        releaseAll()
        this.selection.drop()
        this.saveNow()
      }
    }
    document.addEventListener('visibilitychange', this.onHide)
    window.addEventListener('app-pause', this.onHide)
    this.offBack = onBack(() => {
      if (document.querySelector('.dialog-backdrop')) return false
      if (this.pagesPanel.isOpen) return this.pagesPanel.close(), true
      if (this.snipsPanel.isOpen) return this.snipsPanel.close(), true
      if (this.selection.active) return this.selection.drop(), true
      this.close()
      return true
    })
    requestAnimationFrame(() => this.updateIndicator())
    if (import.meta.env.DEV) window.__ed = this
  }

  // Si sta scrivendo (o si è appena staccata la penna): i lavori pesanti aspettano.
  writing() {
    return !!this.toolPtr || this.nativeInk.active || performance.now() - this.lastInk < 350
  }

  inkStarted() {
    clearTimeout(this.inkTimer)
    setPdfRenderPaused(true)
  }

  inkEnded() {
    this.lastInk = performance.now()
    clearTimeout(this.inkTimer)
    this.inkTimer = setTimeout(() => setPdfRenderPaused(false), 350)
  }

  // --- Input ---
  attachInput() {
    const el = this.view.el
    el.addEventListener('pointerdown', (e) => this.onDown(e))
    el.addEventListener('pointermove', (e) => this.onMove(e))
    this.onRawBound = (e) => this.onRaw(e)
    el.addEventListener('pointerup', (e) => this.onUp(e, false))
    el.addEventListener('pointercancel', (e) => this.onUp(e, true))
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'pen' && !this.toolPtr) this.tools[this.holdTool || this.tool].leave?.()
    })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  isPalm(e) {
    if (this.toolPtr && this.toolPtr.type === 'pen') return true
    if (performance.now() - this.lastPen < 450) return true
    if ((e.width || 0) > 44 || (e.height || 0) > 44) return true
    return false
  }

  sample(e) {
    const pen = e.pointerType === 'pen'
    let p = 0.5
    if (pen) {
      p = e.pressure || 0.3
      p = Math.pow(clamp(p, 0.01, 1), settings.pressure)
    }
    return { cx: e.clientX, cy: e.clientY, p, t: e.timeStamp, sp: !pen }
  }

  onDown(e) {
    if (e.target.closest('.add-page')) return
    if (!this.view.ready) this.view.onResize()
    closePopover()
    if (e.pointerType === 'touch') {
      if (this.isPalm(e)) return
      const fingerTool = settings.fingerDraw && !this.toolPtr && this.view.touches.size === 0
      if (fingerTool) return this.startTool(e)
      if (this.toolPtr?.type === 'touch') {
        // un secondo dito: annulla il tratto col dito e passa al gesto
        const tp = this.toolPtr
        this.toolPtr = null
        tp.tool.discard ? tp.tool.discard() : tp.tool.cancel()
        this.view.touchDown({ pointerId: tp.id, clientX: tp.lastX, clientY: tp.lastY, timeStamp: e.timeStamp })
      }
      this.view.touchDown(e)
      return
    }
    if (e.pointerType === 'mouse' && e.button === 1) {
      this.mousePan = e.pointerId
      this.view.el.setPointerCapture(e.pointerId)
      this.view.touchDown(e)
      return
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (this.toolPtr) return
    if (e.pointerType === 'pen') {
      this.lastPen = performance.now()
      // tasto premuto con la penna sospesa: non è un tocco sullo schermo
      if (!(e.pressure > 0) && !(e.buttons & 33)) return
      this.view.cancelTouches()
    }
    this.startTool(e)
  }

  startTool(e) {
    let tool = this.tools[this.holdTool || this.tool]
    if (e.pointerType === 'pen' && e.buttons & 32) tool = this.tools.eraser // gommino in cima alla penna
    if (tool !== this.tools.lasso && tool !== this.tools.snip) this.selection.drop()
    try {
      this.view.el.setPointerCapture(e.pointerId)
    } catch {
      /* ignora */
    }
    this.toolPtr = { id: e.pointerId, tool, type: e.pointerType, raw: false, lastX: e.clientX, lastY: e.clientY }
    // gli eventi "grezzi" servono solo a tratto iniziato: con la penna sospesa non svegliano l'app
    if ('onpointerrawupdate' in window) this.view.el.addEventListener('pointerrawupdate', this.onRawBound)
    this.inkStarted()
    tool.down(this.sample(e))
  }

  feed(e) {
    const tp = this.toolPtr
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null
    const evs = list && list.length ? list : [e]
    tp.lastX = e.clientX
    tp.lastY = e.clientY
    tp.tool.move(evs.map((ev) => this.sample(ev)))
  }

  onRaw(e) {
    const tp = this.toolPtr
    if (!tp || e.pointerId !== tp.id) return
    tp.raw = true
    this.feed(e)
  }

  onMove(e) {
    const tp = this.toolPtr
    if (tp && e.pointerId === tp.id) {
      if (!tp.raw) this.feed(e)
      return
    }
    if (e.pointerType === 'touch' || e.pointerId === this.mousePan) {
      this.view.touchMove(e)
      return
    }
    if (e.pointerType === 'pen') {
      this.lastPen = performance.now()
      if (!tp) this.tools[this.holdTool || this.tool].hover?.(this.sample(e))
    }
  }

  onUp(e, cancelled) {
    const tp = this.toolPtr
    if (tp && e.pointerId === tp.id) {
      this.toolPtr = null
      this.view.el.removeEventListener('pointerrawupdate', this.onRawBound)
      this.inkEnded()
      if (cancelled) tp.tool.cancel()
      else tp.tool.up(this.sample(e))
      if (e.pointerType === 'pen') this.lastPen = performance.now()
      this.toolbar.refreshHistory()
      return
    }
    if (e.pointerType === 'touch' || e.pointerId === this.mousePan) {
      if (e.pointerId === this.mousePan) this.mousePan = null
      this.view.touchUp(e, cancelled)
    }
  }

  handleKey(e) {
    if (e.target.closest?.('input, textarea')) return
    const k = e.key.toLowerCase()
    const mod = e.ctrlKey || e.metaKey
    if (mod && k === 'z') {
      e.preventDefault()
      e.shiftKey ? this.redo() : this.undo()
    } else if (mod && k === 'y') {
      e.preventDefault()
      this.redo()
    } else if (mod && k === 'c') this.selection.copy()
    else if (mod && k === 'x') this.selection.cut()
    else if (mod && k === 'v') this.paste()
    else if (mod && k === 'd') {
      e.preventDefault()
      this.selection.duplicate()
    } else if ((k === 'delete' || k === 'backspace') && this.selection.active) this.selection.remove()
    else if (k === 'escape') this.selection.drop()
    else if (!mod) {
      const map = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', s: 'snip' }
      if (map[k]) this.setTool(map[k])
    }
  }

  // --- Tasti della penna ---
  onPenButton({ binding, down }) {
    // con un dialogo aperto (es. prova dei tasti) la pressione non deve agire sul quaderno
    if (down && document.querySelector('.dialog-backdrop')) return
    const a = actionInfo(binding.action)
    if (a.hold) {
      if (down) {
        if (a.hold !== 'lasso' && a.hold !== 'snip') this.selection.drop()
        this.holdTool = a.hold
      } else if (this.holdTool === a.hold) {
        this.tools[a.hold].leave?.()
        this.holdTool = null
      }
      this.toolbar.refresh()
      return
    }
    if (!down) return
    switch (a.id) {
      case 'toggle-eraser':
        this.setTool(this.tool === 'eraser' ? this.prevTool : 'eraser')
        break
      case 'toggle-lasso':
        this.setTool(this.tool === 'lasso' ? this.prevTool : 'lasso')
        break
      case 'undo':
        this.undo()
        break
      case 'redo':
        this.redo()
        break
      case 'next-pen':
        this.penBar.cycle(1)
        break
      case 'prev-pen':
        this.penBar.cycle(-1)
        break
      case 'toggle-penbar':
        this.penBar.toggleCollapsed()
        break
    }
  }

  // --- Strumenti ---
  setTool(id) {
    if (id !== 'lasso') this.selection.drop()
    this.tools[this.tool].leave?.()
    if (id !== this.tool && (this.tool === 'pen' || this.tool === 'highlighter')) this.prevTool = this.tool
    this.tool = id
    settings.tool = id
    saveSettings()
    this.toolbar.refresh()
  }

  onSelectionChange() {
    this.toolbar?.refreshHistory()
  }

  setClipboard(items) {
    clipboard = items
    toast('Copiato')
    this.toolbar.refreshContext()
  }

  get clipboard() {
    return clipboard
  }

  paste() {
    if (!clipboard?.length) return
    let bb = null
    for (const it of clipboard) {
      const b = itemBB(it)
      bb = bb ? [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])] : [...b]
    }
    const v = this.view.visibleWorld()
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2
    const dx = cx - (bb[0] + bb[2]) / 2, dy = cy - (bb[1] + bb[3]) / 2
    if (this.tool !== 'lasso') this.setTool('lasso')
    this.selection.liftNew(clipboard.map((it) => transformItem(it, 1, dx, dy, true)))
  }

  undo() {
    if (this.selection.active) {
      this.selection.drop()
    }
    if (this.history.undo()) toast('Annullato', 900)
    this.toolbar.refreshHistory()
  }

  redo() {
    this.selection.drop()
    if (this.history.redo()) toast('Ripetuto', 900)
    this.toolbar.refreshHistory()
  }

  // --- Pagine ---
  currentIndex() {
    return this.view.currentIndex()
  }

  updateIndicator() {
    const n = this.doc.pages.length
    this.pageInd.textContent = `${Math.min(n, this.currentIndex() + 1)} / ${n}`
    this.pagesPanel?.markCurrent(this.currentIndex())
  }

  async goToPagePrompt() {
    const v = await promptDialog('Vai alla pagina', String(this.currentIndex() + 1), { okLabel: 'Vai' })
    const n = parseInt(v, 10)
    if (n >= 1) this.view.scrollToPage(n - 1)
  }

  blankPageLike(ref) {
    const nb = this.doc.nb
    return newPage(nb.id, { w: ref ? ref.w : 595.28, h: ref ? ref.h : 841.89, tpl: nb.tpl || 'blank', paper: nb.paper || '#ffffff' })
  }

  addPageAfter(index, { scroll = true } = {}) {
    this.selection.drop()
    const pages = this.doc.pages
    const ref = pages[clamp(index, 0, pages.length - 1)]
    const p = this.blankPageLike(ref)
    const before = pages.slice()
    const after = pages.slice()
    after.splice(index + 1, 0, p)
    this.history.commitPages(before, after)
    if (scroll) requestAnimationFrame(() => this.view.scrollToPage(index + 1))
    return p
  }

  duplicatePage(index) {
    this.selection.drop()
    const pages = this.doc.pages
    const src = pages[index]
    const p = newPage(this.doc.nb.id, { w: src.w, h: src.h, tpl: src.tpl, paper: src.paper, pdf: src.pdf })
    p.items = src.items.map((it) => transformItem(it, 1, 0, 0, true))
    const after = pages.slice()
    after.splice(index + 1, 0, p)
    this.history.commitPages(pages.slice(), after)
  }

  deletePage(index) {
    this.selection.drop()
    const pages = this.doc.pages
    if (pages.length <= 1) {
      toast('Un quaderno deve avere almeno una pagina')
      return
    }
    const after = pages.slice()
    after.splice(index, 1)
    this.history.commitPages(pages.slice(), after)
    toast('Pagina eliminata — tocca Annulla per recuperarla')
  }

  movePage(from, to) {
    const pages = this.doc.pages
    if (to < 0 || to >= pages.length || from === to) return
    this.selection.drop()
    const after = pages.slice()
    const [p] = after.splice(from, 1)
    after.splice(to, 0, p)
    this.history.commitPages(pages.slice(), after)
  }

  clearCurrentPage() {
    this.selection.drop()
    const p = this.doc.pages[this.currentIndex()]
    if (!p || !p.items.length) return
    this.history.commitItems(p.id, p.items, [])
  }

  setPageBackground(index, { tpl, paper }, all = false) {
    const targets = all ? this.doc.pages.filter((p) => !p.pdf) : [this.doc.pages[index]]
    for (const p of targets) {
      const patch = {}
      if (tpl) patch.tpl = tpl
      if (paper && !p.pdf) patch.paper = paper
      this.doc.updatePage(p.id, patch)
    }
    if (all) {
      if (tpl) this.doc.nb.tpl = tpl
      if (paper) this.doc.nb.paper = paper
      this.doc.touch()
    }
  }

  async insertPdf(index) {
    const file = await pickFile('application/pdf')
    if (!file) return
    const prog = progressDialog('Importazione PDF')
    try {
      const newPages = await importPdfPages(file, this.doc.nb.id, (f) => prog.set(f, 'Lettura pagine…'))
      const pages = this.doc.pages
      const after = pages.slice()
      after.splice(index + 1, 0, ...newPages)
      this.history.commitPages(pages.slice(), after)
      prog.close()
      toast(`${newPages.length} pagine inserite`)
      requestAnimationFrame(() => this.view.scrollToPage(index + 1))
    } catch (e) {
      prog.close()
      console.error(e)
      toast('PDF non valido o protetto')
    }
  }

  openBackgroundDialog(index) {
    const page = this.doc.pages[index]
    let tpl = page.tpl || 'blank'
    let paper = page.paper || '#ffffff'
    let all = false
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
    const paperRow = h('div', { class: 'paper-row' })
    for (const p of PAPERS) {
      const b = h('button', { class: 'paper-opt' + (p.c === paper ? ' active' : ''), style: { background: p.c }, title: p.label })
      b.onclick = () => {
        paper = p.c
        paperRow.querySelectorAll('.paper-opt').forEach((x) => x.classList.remove('active'))
        b.classList.add('active')
      }
      paperRow.append(b)
    }
    openDialog({
      title: 'Sfondo pagina',
      body: h(
        'div',
        null,
        tplGrid,
        page.pdf ? h('p', { class: 'muted' }, 'Le pagine PDF mantengono il loro sfondo; le righe verranno sovrapposte.') : h('div', null, h('div', { class: 'pop-title' }, 'Colore carta'), paperRow),
        toggle('Applica a tutte le pagine (non PDF)', false, (v) => { all = v })
      ),
      actions: [{ label: 'Annulla' }, { label: 'Applica', primary: true, onClick: () => this.setPageBackground(index, { tpl, paper }, all) }],
    })
  }

  // --- Snip ---
  async renderWorldRegion(rect, poly) {
    const maxDim = 2600
    const res = clamp(Math.min(maxDim / Math.max(rect.w, rect.h), this.view.s * this.view.dpr), 1.5, 5)
    const W = Math.max(1, Math.ceil(rect.w * res)), H = Math.max(1, Math.ceil(rect.h * res))
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    for (const e of this.view.entries) {
      if (e.x > rect.x + rect.w || e.x + e.w < rect.x || e.y > rect.y + rect.h || e.y + e.h < rect.y) continue
      const x0 = Math.max(rect.x, e.x) - e.x, y0 = Math.max(rect.y, e.y) - e.y
      const x1 = Math.min(rect.x + rect.w, e.x + e.w) - e.x, y1 = Math.min(rect.y + rect.h, e.y + e.h) - e.y
      const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      ctx.save()
      ctx.setTransform(res, 0, 0, res, (e.x - rect.x) * res, (e.y - rect.y) * res)
      ctx.beginPath()
      ctx.rect(region.x, region.y, region.w, region.h)
      ctx.clip()
      if (e.page.pdf) {
        try {
          const pc = await renderPdfRegion(e.page.pdf, res, region, 0).promise
          ctx.drawImage(pc, region.x, region.y, region.w, region.h)
          pc.width = pc.height = 0
        } catch (err) {
          console.warn(err)
        }
      }
      drawItems(ctx, e.page.items, [x0, y0, x1, y1], true)
      ctx.restore()
    }
    if (poly) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.setTransform(res, 0, 0, res, -rect.x * res, -rect.y * res)
      ctx.beginPath()
      ctx.moveTo(poly[0], poly[1])
      for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1])
      ctx.closePath()
      ctx.fillStyle = '#000'
      ctx.fill()
    }
    return canvas
  }

  async addSnipToTray(canvas, w, h) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
    canvas.width = canvas.height = 0
    const fileId = await storeImageBlob(blob)
    const snip = { id: uid(), fileId, w, h, createdAt: Date.now(), notebookId: this.doc.nb.id }
    await db.put('snips', snip)
    this.snipsPanel.onAdded(snip)
    return snip
  }

  async snipRegion(rect, poly) {
    try {
      const canvas = await this.renderWorldRegion(rect, poly)
      const snip = await this.addSnipToTray(canvas, rect.w, rect.h)
      const off = 14 / this.view.s
      const img = { id: uid(), t: 'i', f: snip.fileId, x: rect.x + off, y: rect.y + off, w: rect.w, h: rect.h }
      this.selection.liftNew([img], { discardIfUntouched: true })
      toast('Snip salvato: trascinalo dove vuoi')
    } catch (e) {
      console.error(e)
      toast('Snip non riuscito')
    }
  }

  async saveItemsAsSnip(items) {
    let bb = null
    for (const it of items) {
      const b = itemBB(it)
      bb = bb ? [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])] : [...b]
    }
    const w = bb[2] - bb[0], hh = bb[3] - bb[1]
    const res = clamp(2600 / Math.max(w, hh), 1.5, 4)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(w * res)
    canvas.height = Math.ceil(hh * res)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(res, 0, 0, res, -bb[0] * res, -bb[1] * res)
    drawItems(ctx, items, null, true)
    await this.addSnipToTray(canvas, w, hh)
    toast('Salvato negli snip')
  }

  insertSnip(snip, clientX, clientY) {
    const v = this.view
    let wx, wy
    if (clientX != null) ({ x: wx, y: wy } = v.toWorld(clientX, clientY))
    else {
      const r = v.visibleWorld()
      wx = r.x + r.w / 2
      wy = r.y + r.h / 2
    }
    let w = snip.w, hh = snip.h
    const e = v.entryAt(wx, wy) || v.nearestEntry(wx, wy)
    if (e && w > e.w * 0.95) {
      const k = (e.w * 0.9) / w
      w *= k
      hh *= k
    }
    const img = { id: uid(), t: 'i', f: snip.fileId, x: wx - w / 2, y: wy - hh / 2, w, h: hh }
    if (this.tool !== 'lasso') this.setTool('lasso')
    this.selection.liftNew([img])
  }

  // --- Menu e impostazioni ---
  openMenu(anchor) {
    const idx = this.currentIndex()
    menu(anchor, [
      { label: 'Esporta / condividi PDF', icon: 'share', onClick: () => this.exportPdf(false) },
      { label: 'Salva PDF in Documenti', icon: 'download', onClick: () => this.exportPdf(true) },
      '-',
      { label: 'Sfondo pagina…', icon: 'pages', onClick: () => this.openBackgroundDialog(idx) },
      { label: 'Aggiungi pagina dopo questa', icon: 'plus', onClick: () => this.addPageAfter(idx) },
      { label: 'Inserisci PDF dopo questa pagina', icon: 'file', onClick: () => this.insertPdf(idx) },
      { label: 'Vai alla pagina…', icon: 'book', onClick: () => this.goToPagePrompt() },
      { label: 'Adatta alla larghezza', icon: 'fit', onClick: () => this.view.fitWidth() },
      '-',
      { label: isDark() ? 'Modalità chiara' : 'Modalità scura', icon: isDark() ? 'sun' : 'moon', onClick: () => setDark(!isDark()) },
      {
        label: settings.penBar.show ? 'Nascondi barra penne' : 'Mostra barra penne',
        icon: 'pen',
        onClick: () => this.penBar.setShown(!settings.penBar.show),
      },
      { label: 'Impostazioni penna e tasti', icon: 'settings', onClick: () => openSettingsDialog() },
    ])
  }

  async exportPdf(toDocuments) {
    this.selection.drop()
    await this.doc.flush()
    const prog = progressDialog('Esportazione PDF')
    try {
      const blob = await exportPdf(this.doc, (f) => prog.set(f, `Pagina ${Math.round(f * this.doc.pages.length)} di ${this.doc.pages.length}`))
      prog.close()
      const name = safeFileName(this.doc.nb.title) + '.pdf'
      if (toDocuments) {
        const where = await saveFile(blob, name)
        toast('Salvato: ' + where, 3500)
      } else await shareFile(blob, name, this.doc.nb.title)
    } catch (e) {
      prog.close()
      console.error(e)
      toast('Esportazione non riuscita')
    }
  }

  async rename() {
    const t = await promptDialog('Nome del quaderno', this.doc.nb.title, { okLabel: 'Rinomina' })
    if (!t) return
    this.doc.nb.title = t
    this.doc.touch()
    this.toolbar.setTitle(t)
  }

  async saveNow() {
    this.doc.nb.lastPage = this.currentIndex()
    this.doc.touch()
    try {
      await this.doc.flush()
    } catch {
      toast('Errore di salvataggio!')
    }
  }

  async close() {
    if (this.closing) return
    this.closing = true
    this.selection.drop()
    await this.saveNow()
    try {
      const cover = await notebookCover(this.doc.pages[0])
      if (cover) {
        this.doc.nb.thumb = cover
        await db.put('notebooks', this.doc.nb)
      }
    } catch (e) {
      console.warn(e)
    }
    this.destroy()
    this.onCloseCb?.()
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey)
    document.removeEventListener('visibilitychange', this.onHide)
    window.removeEventListener('app-pause', this.onHide)
    this.offBack()
    this.offPenBtn()
    this.offTheme()
    this.nativeInk.destroy()
    clearTimeout(this.inkTimer)
    setPdfRenderPaused(false)
    releaseAll()
    this.penBar.destroy()
    this.unsubCam()
    this.unsubPages()
    this.selection.destroy()
    this.pagesPanel.destroy()
    this.snipsPanel.destroy()
    this.view.destroy()
    closePopover()
    this.el.remove()
  }
}

export function openSettingsDialog() {
  openDialog({
    title: 'Impostazioni penna e tocco',
    body: h(
      'div',
      { class: 'settings-list' },
      h('div', { class: 'pop-title' }, 'Sensibilità alla pressione (solo stilografica, sfera, pennello, matita)'),
      slider({
        min: 0.4,
        max: 2,
        step: 0.05,
        value: settings.pressure,
        format: (v) => (v < 0.85 ? 'Alta' : v > 1.2 ? 'Bassa' : 'Normale'),
        onInput: (v) => { settings.pressure = v; saveSettings() },
      }),
      isNative ? toggle('Scrittura veloce (livello nativo Android)', settings.nativeInk, (v) => { settings.nativeInk = v; saveSettings() }) : null,
      toggle('Disegna anche con il dito', settings.fingerDraw, (v) => { settings.fingerDraw = v; saveSettings() }),
      toggle('Tocco con 2 dita = Annulla, 3 dita = Ripeti', settings.twoFingerUndo, (v) => { settings.twoFingerUndo = v; saveSettings() }),
      toggle('Tieni premuto a fine tratto per creare forme', settings.shapeHold, (v) => { settings.shapeHold = v; saveSettings() }),
      penButtonsSection()
    ),
    actions: [{ label: 'Chiudi', primary: true }],
    onClose: () => {
      cancelLearn()
      offMonitor?.()
      offMonitor = null
    },
  })
}

let offMonitor = null

// Configurazione dei due tasti della penna: azione + rilevamento del segnale.
function penButtonsSection() {
  const testLabel = h('div', { class: 'pb-test' }, 'Premi un tasto della penna per provarlo…')
  const log = h('div', { class: 'pb-log' }, 'Segnali ricevuti: nessuno')
  const lines = []
  offMonitor?.()
  offMonitor = onRawPenSignal((id, down, device) => {
    if (!down) return
    const b = settings.penButtons.find((x) => x.ids.includes(id))
    testLabel.textContent = b ? `${b.name}: ${actionInfo(b.action).label}` : `Segnale "${id}" non assegnato: usa "Rileva"`
    testLabel.classList.add('hit')
    clearTimeout(testLabel._t)
    testLabel._t = setTimeout(() => testLabel.classList.remove('hit'), 900)
    lines.unshift(device ? `${id} — ${device}` : id)
    lines.length = Math.min(lines.length, 5)
    log.replaceChildren('Segnali ricevuti:', ...lines.map((l) => h('div', null, l)))
  })
  const rows = settings.penButtons.map((b, i) => {
    const sel = h('select', { class: 'input' }, ...PEN_ACTIONS.map((a) => h('option', { value: a.id }, a.label)))
    sel.value = b.action
    sel.addEventListener('change', () => setBinding(i, { action: sel.value }))
    const learn = h('button', { class: 'btn' }, icon('pen', 18), 'Rileva')
    const status = h('span', { class: 'muted small' }, '')
    learn.addEventListener('click', async () => {
      learn.disabled = true
      status.textContent = 'Premi ora il ' + b.name.toLowerCase() + ' della penna…'
      const ids = await learnButton()
      learn.disabled = false
      if (ids.length) {
        setBinding(i, { ids })
        status.textContent = `Rilevato ✓ (${ids.join(', ')})`
      } else status.textContent = 'Nessun segnale ricevuto: HyperOS potrebbe usare questo tasto per una sua funzione.'
    })
    return h('div', { class: 'pen-btn-row' }, h('div', { class: 'pen-btn-head' }, h('b', null, b.name), learn), sel, status)
  })
  return h(
    'div',
    { class: 'pen-buttons' },
    h('div', { class: 'pop-title' }, 'Tasti della penna'),
    h('p', { class: 'muted small' }, 'Dai un tocco breve al tasto: se lo tieni premuto, HyperOS può avviare lo screenshot o la nota rapida. Per questo le azioni "finché tieni premuto" potrebbero non funzionare bene.'),
    ...rows,
    testLabel,
    log
  )
}
