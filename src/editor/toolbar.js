// Editor toolbar.
import { h } from '../util.js'
import { icon } from '../icons.js'
import { settings, saveSettings, pushRecentColor } from '../settings.js'
import { PEN_TYPES } from '../ink.js'
import { popover, colorPicker, slider, toggle, segmented, closePopover, confirmDialog } from '../ui.js'
import { displayColor, isDark, setDark } from '../theme.js'

const TOOLS = [
  { id: 'pen', label: 'Pen' },
  { id: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
  { id: 'lasso', label: 'Lasso', icon: 'lasso' },
  { id: 'snip', label: 'Snip', icon: 'snip' },
]

export class Toolbar {
  constructor(ed) {
    this.ed = ed
    this.el = h('header', { class: 'ed-bar' })
    this.toolBtns = {}
    const left = h(
      'div',
      { class: 'bar-group bar-left' },
      h('button', { class: 'icon-btn', title: 'Library', onclick: () => ed.close() }, icon('back')),
      (this.title = h('button', { class: 'ed-title', title: 'Rename', onclick: () => ed.rename() }, ed.doc.nb.title))
    )
    const tools = h('div', { class: 'bar-group bar-tools' })
    for (const t of TOOLS) {
      const b = h('button', { class: 'tool-btn', title: t.label, onclick: () => this.onToolClick(t.id, b) })
      this.toolBtns[t.id] = b
      tools.append(b)
    }
    this.context = h('div', { class: 'bar-group bar-context' })
    this.themeBtn = h('button', { class: 'icon-btn', title: 'Dark mode', onclick: () => setDark(!isDark()) }, icon(isDark() ? 'sun' : 'moon'))
    this.undoBtn = h('button', { class: 'icon-btn', title: 'Undo', onclick: () => ed.undo() }, icon('undo'))
    this.redoBtn = h('button', { class: 'icon-btn', title: 'Redo', onclick: () => ed.redo() }, icon('redo'))
    const right = h(
      'div',
      { class: 'bar-group bar-right' },
      this.themeBtn,
      this.undoBtn,
      this.redoBtn,
      h('button', { class: 'icon-btn', title: 'Pages', onclick: () => ed.pagesPanel.toggle() }, icon('pages')),
      h('button', { class: 'icon-btn', title: 'Saved snips', onclick: () => ed.snipsPanel.toggle() }, icon('tray')),
      h('button', { class: 'icon-btn', title: 'More', onclick: (e) => ed.openMenu(e.currentTarget) }, icon('more'))
    )
    this.el.append(left, tools, this.context, right)
    this.refresh()
  }

  setTitle(t) {
    this.title.textContent = t
  }

  onToolClick(id, btn) {
    if (this.ed.tool === id) {
      this.openToolOptions(id, btn)
      return
    }
    this.ed.setTool(id)
  }

  refresh() {
    const cur = this.ed.tool
    const held = this.ed.holdTool
    for (const t of TOOLS) {
      const b = this.toolBtns[t.id]
      b.classList.toggle('active', t.id === cur)
      b.classList.toggle('held', t.id === held && held !== cur)
      b.replaceChildren(icon(t.id === 'pen' ? settings.pen.type : t.icon, 24))
      if (t.id === 'pen' || t.id === 'highlighter') {
        const cfg = settings[t.id]
        b.append(h('span', { class: 'tool-color', style: { background: displayColor(cfg.color) } }))
      }
    }
    this.themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon'))
    this.themeBtn.title = isDark() ? 'Light mode' : 'Dark mode'
    this.refreshContext()
    this.refreshHistory()
    this.ed.penBar?.sync()
    this.ed.nativeInk?.sync()
  }

  refreshHistory() {
    this.undoBtn.disabled = !this.ed.history.canUndo && !this.ed.selection?.active
    this.redoBtn.disabled = !this.ed.history.canRedo
  }

  refreshContext() {
    const c = this.context
    c.replaceChildren()
    const tool = this.ed.tool
    if (tool === 'pen' || tool === 'highlighter') {
      const cfg = settings[tool]
      cfg.colors.forEach((col, i) => {
        const b = h('button', { class: 'swatch' + (col === cfg.color ? ' active' : ''), style: { '--c': displayColor(col) }, title: 'Color' })
        b.addEventListener('click', () => {
          if (cfg.color === col) this.editSwatch(tool, i, b)
          else {
            cfg.color = col
            saveSettings()
            this.refresh()
          }
        })
        c.append(b)
      })
      c.append(h('span', { class: 'bar-sep' }))
      const maxW = Math.max(...cfg.widths)
      cfg.widths.forEach((w, i) => {
        const dot = Math.max(3, Math.min(18, (w / maxW) * 16 + (tool === 'highlighter' ? 0 : 2)))
        const b = h(
          'button',
          { class: 'width-btn' + (Math.abs(w - cfg.width) < 0.01 ? ' active' : ''), title: 'Width ' + w },
          h('span', { class: 'width-dot', style: { width: dot + 'px', height: dot + 'px', background: tool === 'highlighter' ? displayColor(cfg.color) : 'currentColor' } })
        )
        b.addEventListener('click', () => {
          if (Math.abs(w - cfg.width) < 0.01) this.editWidth(tool, i, b)
          else {
            cfg.width = w
            saveSettings()
            this.refresh()
          }
        })
        c.append(b)
      })
    } else if (tool === 'eraser') {
      c.append(
        segmented(
          [
            { value: 'stroke', label: 'Whole stroke', text: 'Stroke', icon: 'eraseStroke' },
            { value: 'area', label: 'Partial', text: 'Partial', icon: 'eraseArea' },
          ],
          settings.eraser.mode,
          (v) => {
            settings.eraser.mode = v
            saveSettings()
          }
        ),
        h('span', { class: 'bar-sep' })
      )
      settings.eraser.sizes.forEach((sz) => {
        const b = h(
          'button',
          { class: 'width-btn' + (sz === settings.eraser.size ? ' active' : ''), title: 'Size ' + sz },
          h('span', { class: 'width-dot ring', style: { width: Math.min(22, sz * 0.75) + 'px', height: Math.min(22, sz * 0.75) + 'px' } })
        )
        b.addEventListener('click', () => {
          settings.eraser.size = sz
          saveSettings()
          this.refresh()
        })
        c.append(b)
      })
    } else if (tool === 'lasso') {
      c.append(h('span', { class: 'bar-hint' }, 'Circle or tap to select'))
      if (this.ed.clipboard) c.append(h('button', { class: 'chip', onclick: () => this.ed.paste() }, icon('copy', 18), 'Paste'))
    } else if (tool === 'snip') {
      c.append(
        segmented(
          [
            { value: 'rect', label: 'Rectangle', text: 'Rectangle', icon: 'rect' },
            { value: 'free', label: 'Freeform', text: 'Freeform', icon: 'freeform' },
          ],
          settings.snip.mode,
          (v) => {
            settings.snip.mode = v
            saveSettings()
          }
        ),
        h('button', { class: 'chip', onclick: () => this.ed.snipsPanel.open() }, icon('tray', 18), 'Saved snips')
      )
    }
  }

  editSwatch(tool, i, anchor) {
    const cfg = settings[tool]
    const pick = colorPicker(
      cfg.colors[i],
      (col, final) => {
        cfg.colors[i] = col
        cfg.color = col
        saveSettings()
        anchor.style.setProperty('--c', displayColor(col))
        const tb = this.toolBtns[tool].querySelector('.tool-color')
        if (tb) tb.style.background = displayColor(col)
        if (final) pushRecentColor(col)
      },
      { recent: settings.recentColors }
    )
    popover(anchor, pick, { onClose: () => this.refresh() })
  }

  editWidth(tool, i, anchor) {
    const cfg = settings[tool]
    const hl = tool === 'highlighter'
    const body = h(
      'div',
      { class: 'pop-section' },
      h('div', { class: 'pop-title' }, 'Width'),
      slider({
        min: hl ? 3 : 0.4,
        max: hl ? 40 : 12,
        step: hl ? 1 : 0.1,
        value: cfg.widths[i],
        format: (v) => v.toFixed(hl ? 0 : 1),
        onInput: (v) => {
          cfg.widths[i] = v
          cfg.width = v
          saveSettings()
        },
      })
    )
    popover(anchor, body, { onClose: () => this.refresh() })
  }

  openToolOptions(id, anchor) {
    const body = h('div', { class: 'pop-section tool-options' })
    if (id === 'pen') {
      body.append(h('div', { class: 'pop-title' }, 'Pen type'))
      const grid = h('div', { class: 'pen-types five' })
      for (const k of ['plain', 'fountain', 'ballpoint', 'brush', 'pencil']) {
        const b = h('button', { class: 'pen-type' + (settings.pen.type === k ? ' active' : '') }, icon(k, 26), h('span', null, PEN_TYPES[k].label))
        b.addEventListener('click', () => {
          settings.pen.type = k
          saveSettings()
          grid.querySelectorAll('.pen-type').forEach((x) => x.classList.remove('active'))
          b.classList.add('active')
          this.refresh()
        })
        grid.append(b)
      }
      body.append(
        grid,
        h('div', { class: 'pop-title' }, 'Width'),
        slider({
          min: 0.4, max: 12, step: 0.1, value: settings.pen.width, format: (v) => v.toFixed(1),
          onInput: (v) => {
            const i = settings.pen.widths.findIndex((w) => Math.abs(w - settings.pen.width) < 0.01)
            if (i >= 0) settings.pen.widths[i] = v
            settings.pen.width = v
            saveSettings()
          },
        }),
        toggle('Hold for shapes (line, circle, rectangle)', settings.shapeHold, (v) => { settings.shapeHold = v; saveSettings() })
      )
    } else if (id === 'highlighter') {
      body.append(
        h('div', { class: 'pop-title' }, 'Highlighter'),
        slider({
          min: 3, max: 40, step: 1, value: settings.highlighter.width, format: (v) => v.toFixed(0),
          onInput: (v) => {
            const i = settings.highlighter.widths.findIndex((w) => Math.abs(w - settings.highlighter.width) < 0.01)
            if (i >= 0) settings.highlighter.widths[i] = v
            settings.highlighter.width = v
            saveSettings()
          },
        }),
        toggle('Always a straight line', settings.highlighter.straight, (v) => { settings.highlighter.straight = v; saveSettings() }),
        toggle('Hold for shapes', settings.shapeHold, (v) => { settings.shapeHold = v; saveSettings() })
      )
    } else if (id === 'eraser') {
      body.append(
        h('div', { class: 'pop-title' }, 'Eraser'),
        slider({
          min: 4, max: 60, step: 1, value: settings.eraser.size, format: (v) => v.toFixed(0),
          onInput: (v) => {
            const i = settings.eraser.sizes.indexOf(settings.eraser.size)
            if (i >= 0) settings.eraser.sizes[i] = v
            settings.eraser.size = v
            saveSettings()
          },
        }),
        toggle('Erase highlighter only', settings.eraser.highlighterOnly, (v) => { settings.eraser.highlighterOnly = v; saveSettings() }),
        h('button', {
          class: 'btn danger block',
          onclick: async () => {
            closePopover()
            if (await confirmDialog('Erase all ink and snips on the current page?', { okLabel: 'Erase', danger: true })) this.ed.clearCurrentPage()
          },
        }, 'Erase current page')
      )
    } else return
    popover(anchor, body, { onClose: () => this.refresh() })
  }
}
