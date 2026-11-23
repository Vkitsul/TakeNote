// Side panel with page thumbnails: go to, add, duplicate, move, delete, background.
import { h } from '../util.js'
import { icon } from '../icons.js'
import { menu, confirmDialog } from '../ui.js'
import { renderPageThumb } from '../thumbs.js'

const THUMB_W = 150

export class PagesPanel {
  constructor(ed) {
    this.ed = ed
    this.isOpen = false
    this.list = h('div', { class: 'panel-list pages-list' })
    this.el = h(
      'aside',
      { class: 'side-panel left' },
      h(
        'div',
        { class: 'panel-head' },
        h('h3', null, 'Pages'),
        h('button', { class: 'icon-btn', title: 'Close', onclick: () => this.close() }, icon('close'))
      ),
      this.list,
      h(
        'div',
        { class: 'panel-foot' },
        h('button', { class: 'btn primary', onclick: () => this.ed.addPageAfter(this.ed.currentIndex()) }, icon('plus', 18), 'Page'),
        h('button', { class: 'btn', onclick: () => this.ed.insertPdf(this.ed.currentIndex()) }, icon('file', 18), 'PDF')
      )
    )
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) this.paintThumb(en.target)
    }, { root: this.list, rootMargin: '200px' })
  }

  toggle() {
    this.isOpen ? this.close() : this.open()
  }

  open() {
    this.ed.snipsPanel.close()
    this.isOpen = true
    this.ed.indShown = -1
    this.el.classList.add('open')
    this.ed.nativeInk?.sync()
    this.refresh()
    requestAnimationFrame(() => this.list.querySelector('.pg-item.current')?.scrollIntoView({ block: 'center' }))
  }

  close() {
    this.isOpen = false
    this.el.classList.remove('open')
    this.ed.nativeInk?.sync()
  }

  refresh() {
    if (!this.isOpen) return
    this.io.disconnect()
    const cur = this.ed.currentIndex()
    const pages = this.ed.doc.pages
    const items = pages.map((p, i) => {
      const thumb = h('div', { class: 'pg-thumb', style: { aspectRatio: `${p.w} / ${p.h}` } })
      const item = h(
        'div',
        { class: 'pg-item' + (i === cur ? ' current' : ''), dataset: { idx: i } },
        thumb,
        h(
          'div',
          { class: 'pg-meta' },
          h('span', { class: 'pg-num' }, i + 1),
          h('button', { class: 'icon-btn small', title: 'Page options', onclick: (e) => { e.stopPropagation(); this.pageMenu(i, e.currentTarget) } }, icon('more', 18))
        )
      )
      item.addEventListener('click', () => this.ed.view.scrollToPage(i))
      item._page = p
      return item
    })
    this.list.replaceChildren(...items)
    for (const it of items) this.io.observe(it)
  }

  async paintThumb(item) {
    const p = item._page
    const thumb = item.querySelector('.pg-thumb')
    if (thumb._v === p.version) return
    thumb._v = p.version
    const canvas = await renderPageThumb(p, THUMB_W * Math.min(2, window.devicePixelRatio || 1))
    if (item.isConnected && thumb._v === p.version) {
      const img = h('canvas', { width: canvas.width, height: canvas.height })
      img.getContext('2d').drawImage(canvas, 0, 0)
      thumb.replaceChildren(img)
    }
  }

  markCurrent(i) {
    if (!this.isOpen) return
    this.list.querySelectorAll('.pg-item.current').forEach((x) => x.classList.remove('current'))
    this.list.children[i]?.classList.add('current')
  }

  pageMenu(i, anchor) {
    const ed = this.ed
    const n = ed.doc.pages.length
    menu(anchor, [
      { label: 'New page after', icon: 'plus', onClick: () => ed.addPageAfter(i, { scroll: false }) },
      { label: 'Duplicate page', icon: 'duplicate', onClick: () => ed.duplicatePage(i) },
      { label: 'Insert PDF after', icon: 'file', onClick: () => ed.insertPdf(i) },
      { label: 'Background…', icon: 'pages', onClick: () => ed.openBackgroundDialog(i) },
      '-',
      { label: 'Move up', icon: 'up', disabled: i === 0, onClick: () => ed.movePage(i, i - 1) },
      { label: 'Move down', icon: 'down', disabled: i === n - 1, onClick: () => ed.movePage(i, i + 1) },
      '-',
      {
        label: 'Delete page',
        icon: 'trash',
        danger: true,
        disabled: n <= 1,
        onClick: async () => {
          if (await confirmDialog(`Delete page ${i + 1}?`, { okLabel: 'Delete', danger: true })) ed.deletePage(i)
        },
      },
    ])
  }

  destroy() {
    this.io.disconnect()
  }
}
