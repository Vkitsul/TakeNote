// Snip tray: saved clippings to drag (or tap) into any page or notebook.
import { h } from '../util.js'
import { icon } from '../icons.js'
import { confirmDialog, toast } from '../ui.js'
import * as db from '../db.js'
import { getFileBlob } from '../images.js'

export class SnipsPanel {
  constructor(ed) {
    this.ed = ed
    this.isOpen = false
    this.urls = new Map()
    this.list = h('div', { class: 'panel-list snips-list' })
    this.empty = h('div', { class: 'panel-empty' }, icon('snip', 36), h('p', null, 'No snips.'), h('p', { class: 'muted' }, 'Use the Snip tool to clip part of a page or PDF.'))
    this.el = h(
      'aside',
      { class: 'side-panel right' },
      h(
        'div',
        { class: 'panel-head' },
        h('h3', null, 'Snip'),
        h('button', { class: 'icon-btn', title: 'Close', onclick: () => this.close() }, icon('close'))
      ),
      h('p', { class: 'panel-hint' }, 'Drag a snip onto the page, or tap it to insert it in the middle.'),
      this.list
    )
  }

  toggle() {
    this.isOpen ? this.close() : this.open()
  }

  async open() {
    this.ed.pagesPanel.close()
    this.isOpen = true
    this.el.classList.add('open')
    this.ed.nativeInk?.sync()
    await this.load()
  }

  close() {
    this.isOpen = false
    this.el.classList.remove('open')
    this.ed.nativeInk?.sync()
  }

  async load() {
    const snips = (await db.all('snips')).sort((a, b) => b.createdAt - a.createdAt)
    this.list.replaceChildren()
    if (!snips.length) {
      this.list.append(this.empty)
      return
    }
    for (const s of snips) this.list.append(await this.makeItem(s))
  }

  onAdded(snip) {
    if (!this.isOpen) return
    this.empty.remove()
    this.makeItem(snip).then((el) => {
      el.classList.add('fresh')
      this.list.prepend(el)
    })
  }

  async urlFor(snip) {
    let u = this.urls.get(snip.fileId)
    if (!u) {
      const blob = await getFileBlob(snip.fileId)
      if (!blob) return ''
      u = URL.createObjectURL(blob)
      this.urls.set(snip.fileId, u)
    }
    return u
  }

  async makeItem(snip) {
    const url = await this.urlFor(snip)
    const img = h('img', { src: url, draggable: 'false', alt: 'snip' })
    const del = h('button', { class: 'snip-del', title: 'Delete snip' }, icon('close', 16))
    const item = h('div', { class: 'snip-item' }, img, del)
    del.addEventListener('pointerdown', (e) => e.stopPropagation())
    del.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!(await confirmDialog('Delete this snip from the tray? Copies already placed on pages stay.', { okLabel: 'Delete', danger: true }))) return
      await db.del('snips', snip.id)
      item.remove()
      if (!this.list.children.length) this.list.append(this.empty)
    })
    this.attachDrag(item, img, snip, url)
    return item
  }

  attachDrag(item, img, snip, url) {
    item.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return
      e.preventDefault()
      item.setPointerCapture(e.pointerId)
      const sx = e.clientX, sy = e.clientY
      let ghost = null
      const ratio = snip.h / snip.w
      const move = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
          const gw = Math.min(260, Math.max(80, snip.w * this.ed.view.s))
          ghost = h('img', { class: 'snip-ghost', src: url, style: { width: gw + 'px', height: gw * ratio + 'px' } })
          document.body.append(ghost)
        }
        if (ghost) {
          ghost.style.left = ev.clientX + 'px'
          ghost.style.top = ev.clientY + 'px'
          ghost.classList.toggle('over-panel', this.isOverPanel(ev.clientX, ev.clientY))
        }
      }
      const up = (ev) => {
        item.removeEventListener('pointermove', move)
        item.removeEventListener('pointerup', up)
        item.removeEventListener('pointercancel', up)
        if (ghost) {
          ghost.remove()
          if (ev.type === 'pointerup' && !this.isOverPanel(ev.clientX, ev.clientY) && this.isOverView(ev.clientX, ev.clientY)) {
            this.ed.insertSnip(snip, ev.clientX, ev.clientY)
          }
        } else if (ev.type === 'pointerup') {
          this.ed.insertSnip(snip)
          if (window.innerWidth < 900) this.close()
          toast('Snip inserted: move it anywhere')
        }
      }
      item.addEventListener('pointermove', move)
      item.addEventListener('pointerup', up)
      item.addEventListener('pointercancel', up)
    })
  }

  isOverPanel(x, y) {
    const r = this.el.getBoundingClientRect()
    return this.isOpen && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  isOverView(x, y) {
    const r = this.ed.view.el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  destroy() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
  }
}
