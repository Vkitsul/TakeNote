// Undo / redo.
// Entries: { kind: 'items', changes: [{ pageId, before, after }] } | { kind: 'pages', before: Page[], after: Page[] }
const LIMIT = 300

export class History {
  constructor(doc, onChange) {
    this.doc = doc
    this.undoStack = []
    this.redoStack = []
    this.onChange = onChange
  }

  push(entry) {
    if (entry.kind === 'items') {
      entry.changes = entry.changes.filter((c) => c.before !== c.after)
      if (!entry.changes.length) return
    }
    this.undoStack.push(entry)
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.redoStack.length = 0
    this.onChange?.()
  }

  // Records a change to the items of a page and applies it.
  commitItems(pageId, before, after, change) {
    this.doc.setItems(pageId, after, change)
    this.push({ kind: 'items', changes: [{ pageId, before, after }] })
  }

  commitPages(before, after) {
    this.doc.setPages(after)
    this.push({ kind: 'pages', before, after })
  }

  apply(entry, dir) {
    if (entry.kind === 'items') {
      for (const c of entry.changes) {
        if (this.doc.page(c.pageId)) this.doc.setItems(c.pageId, dir === 'undo' ? c.before : c.after)
      }
    } else if (entry.kind === 'pages') {
      this.doc.setPages(dir === 'undo' ? entry.before : entry.after)
    }
  }

  undo() {
    const e = this.undoStack.pop()
    if (!e) return null
    this.apply(e, 'undo')
    this.redoStack.push(e)
    this.onChange?.()
    return e
  }

  redo() {
    const e = this.redoStack.pop()
    if (!e) return null
    this.apply(e, 'redo')
    this.undoStack.push(e)
    this.onChange?.()
    return e
  }

  get canUndo() {
    return this.undoStack.length > 0
  }
  get canRedo() {
    return this.redoStack.length > 0
  }
}
