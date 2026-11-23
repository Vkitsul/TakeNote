// Model of an open notebook: ordered pages, items, autosave.
import * as db from './db.js'
import { uid, debounce } from './util.js'

export function newPage(notebookId, { w, h, tpl = 'blank', paper = '#ffffff', pdf = null }) {
  return { id: uid(), notebookId, w, h, tpl, paper, pdf, items: [], version: 0 }
}

export function newNotebook({ title, folderId = null, tpl = 'lined', paper = '#ffffff', size = 'a4p', cover = '#3157d6' }) {
  const now = Date.now()
  return { id: uid(), title, folderId, tpl, paper, size, cover, pageIds: [], createdAt: now, updatedAt: now, lastPage: 0, thumb: null }
}

export class NotebookDoc {
  static async load(id) {
    const nb = await db.get('notebooks', id)
    if (!nb) throw new Error('Notebook not found')
    const list = await db.byIndex('pages', 'notebookId', id)
    const map = new Map(list.map((p) => [p.id, p]))
    const order = nb.pageIds.map((pid) => map.get(pid)).filter(Boolean)
    // orphan pages (should not happen): append them
    for (const p of list) if (!nb.pageIds.includes(p.id)) order.push(p)
    for (const p of order) p.version = p.version || 0
    return new NotebookDoc(nb, order)
  }

  constructor(nb, pages) {
    this.nb = nb
    this.pages = pages
    this.byId = new Map(pages.map((p) => [p.id, p]))
    this.dirty = new Set()
    this.removed = new Set()
    this.nbDirty = false
    this.saveOverride = null
    this.listeners = { items: new Set(), pages: new Set() }
    this.isBusy = () => false
    this.save = debounce(() => {
      if (this.isBusy()) this.save()
      else this.flush()
    }, 1200)
  }

  on(type, fn) {
    this.listeners[type].add(fn)
    return () => this.listeners[type].delete(fn)
  }
  emit(type, ...args) {
    for (const fn of this.listeners[type]) fn(...args)
  }

  page(id) {
    return this.byId.get(id)
  }
  indexOf(id) {
    return this.pages.findIndex((p) => p.id === id)
  }

  // change: { type: 'append', item } | { type: 'replace', region? }
  setItems(pageId, items, change = { type: 'replace' }) {
    const p = this.byId.get(pageId)
    if (!p) return
    p.items = items
    p.version++
    this.dirty.add(pageId)
    this.save()
    this.emit('items', pageId, change)
  }

  addItem(pageId, item) {
    const p = this.byId.get(pageId)
    if (!p) return
    this.setItems(pageId, [...p.items, item], { type: 'append', item })
  }

  updatePage(pageId, patch) {
    const p = this.byId.get(pageId)
    if (!p) return
    Object.assign(p, patch)
    p.version++
    this.dirty.add(pageId)
    this.save()
    this.emit('pages', { type: 'bg', pageId })
  }

  // Replaces the page order (used for inserts, deletes, moves and undo).
  setPages(pages) {
    const before = new Set(this.pages.map((p) => p.id))
    const after = new Set(pages.map((p) => p.id))
    for (const id of before) if (!after.has(id)) {
      this.removed.add(id)
      this.byId.delete(id)
    }
    for (const p of pages) if (!before.has(p.id)) {
      this.removed.delete(p.id)
      this.byId.set(p.id, p)
      this.dirty.add(p.id)
    }
    this.pages = pages
    this.nbDirty = true
    this.save()
    this.emit('pages', { type: 'order' })
  }

  touch() {
    this.nbDirty = true
    this.save()
  }

  async flush() {
    this.save.cancel()
    const ops = []
    for (const id of this.dirty) {
      const p = this.byId.get(id)
      if (!p) continue
      const override = this.saveOverride?.get(id)
      ops.push({ store: 'pages', put: override ? { ...p, items: override } : p })
    }
    for (const id of this.removed) ops.push({ store: 'pages', del: id })
    if (ops.length || this.nbDirty) {
      this.nb.pageIds = this.pages.map((p) => p.id)
      this.nb.updatedAt = Date.now()
      ops.push({ store: 'notebooks', put: this.nb })
    }
    this.dirty.clear()
    this.removed.clear()
    this.nbDirty = false
    if (!ops.length) return
    try {
      await db.batch(ops)
    } catch (e) {
      console.error('Save failed', e)
      throw e
    }
  }
}
