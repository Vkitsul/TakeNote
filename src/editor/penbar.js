// Floating pen bar (as in Notein): favorite pens only, can be dragged anywhere,
// collapsed to an icon and expanded again. Pens are "slots": changing the color/width
// of the active pen from the top bar updates the slot too.
import { h, uid, clamp, hexToRgb } from '../util.js'
import { icon } from '../icons.js'
import { settings, saveSettings, pushRecentColor } from '../settings.js'
import { PEN_TYPES } from '../ink.js'
import { popover, colorPicker, slider, closePopover, menu, confirmDialog } from '../ui.js'
import { displayColor, isDark } from '../theme.js'

const PRESET_TYPES = ['plain', 'fountain', 'ballpoint', 'brush', 'pencil', 'highlighter']
const DRAG_THRESHOLD = 6

const toolOf = (p) => (p.type === 'highlighter' ? 'highlighter' : 'pen')

// does the color blend into the bar background (light or dark)?
function lowContrast(hex) {
  const [r, g, b] = hexToRgb(hex)
  const l = 0.299 * r + 0.587 * g + 0.114 * b
  return isDark() ? l < 70 : l > 200
}

export class PenBar {
  constructor(ed) {
    this.ed = ed
    this.el = h('div', { class: 'penbar' })
    ed.main.append(this.el)
    this.onResize = () => this.place()
    window.addEventListener('resize', this.onResize)
    this.render()
  }

  get cfg() {
    return settings.penBar
  }

  get presets() {
    return settings.penPresets
  }

  active() {
    return this.presets.find((p) => p.id === settings.activePreset) || null
  }

  // --- Rendering ---
  render() {
    const cfg = this.cfg
    this.el.className = 'penbar' + (cfg.collapsed ? ' collapsed' : '') + (cfg.vertical ? ' vertical' : '')
    this.el.style.display = cfg.show ? '' : 'none'
    this.el.replaceChildren()
    const act = this.active()
    const usingPreset = act && toolOf(act) === this.ed.tool && !this.ed.holdTool
    if (cfg.collapsed) {
      const p = act || { type: settings.pen.type, color: settings.pen.color, width: settings.pen.width }
      const fab = h('button', { class: 'pb-fab', title: 'Expand the pen bar' }, this.penIcon(p, 26))
      this.dragOn(fab, () => this.setCollapsed(false))
      this.el.append(fab)
    } else {
      const handle = h('div', { class: 'pb-handle', title: 'Drag to move' }, h('span'), h('span'), h('span'), h('span'), h('span'), h('span'))
      this.dragOn(handle, null)
      const slots = h('div', { class: 'pb-slots' })
      for (const p of this.presets) {
        const b = h('button', { class: 'pb-slot' + (usingPreset && p.id === act.id ? ' active' : ''), title: PEN_TYPES[p.type]?.label || 'Pen' }, this.penIcon(p, 24))
        b.addEventListener('click', () => {
          if (usingPreset && p.id === act.id) this.editPreset(p, b)
          else this.select(p)
        })
        slots.append(b)
      }
      const add = h('button', { class: 'pb-btn', title: 'Add pen', onclick: () => this.addPreset() }, icon('plus', 20))
      const more = h('button', { class: 'pb-btn', title: 'Bar options', onclick: (e) => this.barMenu(e.currentTarget) }, icon('more', 18))
      const collapse = h('button', { class: 'pb-btn', title: 'Collapse to icon', onclick: () => this.setCollapsed(true) }, icon('collapse', 18))
      this.el.append(handle, slots, add, more, collapse)
    }
    requestAnimationFrame(() => this.place())
  }

  penIcon(p, size) {
    const c = displayColor(p.color)
    const wrap = h('span', { class: 'pb-pen' + (lowContrast(c) ? ' outline' : ''), style: { color: c } }, icon(p.type, size))
    const maxW = p.type === 'highlighter' ? 30 : 8
    const d = clamp(3 + (p.width / maxW) * 9, 3, 12)
    wrap.append(h('span', { class: 'pb-width', style: { width: d + 'px', height: d + 'px', background: c } }))
    return wrap
  }

  // Position: x/y are the bar's center as fractions of the editor area
  place() {
    const area = this.ed.main.getBoundingClientRect()
    const w = this.el.offsetWidth, hh = this.el.offsetHeight
    if (!area.width || !w) return
    const m = 6
    const left = clamp(this.cfg.x * area.width - w / 2, m, Math.max(m, area.width - w - m))
    const top = clamp(this.cfg.y * area.height - hh / 2, m, Math.max(m, area.height - hh - m))
    this.el.style.left = left + 'px'
    this.el.style.top = top + 'px'
    this.ed.nativeInk?.sync()
  }

  // Dragging (handle or collapsed icon). onTap: action for a tap without movement.
  dragOn(el, onTap) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return
      e.preventDefault()
      e.stopPropagation()
      closePopover()
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      const area = this.ed.main.getBoundingClientRect()
      const r = this.el.getBoundingClientRect()
      const ox = e.clientX - r.left, oy = e.clientY - r.top
      const sx = e.clientX, sy = e.clientY
      let moved = false
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return
        moved = true
        this.el.classList.add('dragging')
        const left = clamp(ev.clientX - ox - area.left, 0, area.width - r.width)
        const top = clamp(ev.clientY - oy - area.top, 0, area.height - r.height)
        this.el.style.left = left + 'px'
        this.el.style.top = top + 'px'
        this.cfg.x = (left + r.width / 2) / area.width
        this.cfg.y = (top + r.height / 2) / area.height
      }
      const up = (ev) => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        this.el.classList.remove('dragging')
        this.ed.nativeInk?.sync()
        if (moved) saveSettings()
        else if (ev.type === 'pointerup') onTap?.()
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    })
  }

  // --- Pens ---
  applyPreset(p) {
    if (toolOf(p) === 'highlighter') {
      settings.highlighter.color = p.color
      settings.highlighter.width = p.width
    } else {
      settings.pen.type = p.type
      settings.pen.color = p.color
      settings.pen.width = p.width
    }
  }

  select(p) {
    settings.activePreset = p.id
    this.applyPreset(p)
    saveSettings()
    this.ed.setTool(toolOf(p)) // updates the top bar, which in turn calls sync()
    this.render()
  }

  // Called by the top bar after every change: keeps the active slot in step.
  sync() {
    const tool = this.ed.tool
    const act = this.active()
    if (tool === 'pen' || tool === 'highlighter') {
      if (act && toolOf(act) === tool) {
        const cfg = settings[tool]
        if (tool === 'pen') act.type = cfg.type
        act.color = cfg.color
        act.width = cfg.width
      } else {
        const cfg = settings[tool]
        const match = this.presets.find(
          (p) => toolOf(p) === tool && p.color === cfg.color && Math.abs(p.width - cfg.width) < 0.01 && (tool === 'highlighter' || p.type === cfg.type)
        )
        if (match) settings.activePreset = match.id
      }
    }
    this.render()
  }

  cycle(dir) {
    const list = this.presets
    if (!list.length) return
    const act = this.active()
    let i = act ? list.indexOf(act) : -1
    // if another tool was in use, the first tap goes back to the active pen
    if (act && toolOf(act) !== this.ed.tool) i -= dir
    i = (i + dir + list.length) % list.length
    this.select(list[i])
  }

  addPreset() {
    const tool = this.ed.tool === 'highlighter' ? 'highlighter' : 'pen'
    const cfg = settings[tool]
    const p = { id: uid(), type: tool === 'highlighter' ? 'highlighter' : cfg.type, color: cfg.color, width: cfg.width }
    this.presets.push(p)
    this.select(p)
    const btn = this.el.querySelectorAll('.pb-slot')[this.presets.length - 1]
    if (btn) this.editPreset(p, btn)
  }

  editPreset(p, anchor) {
    const live = () => {
      if (settings.activePreset === p.id) {
        this.applyPreset(p)
        if (this.ed.tool !== toolOf(p)) this.ed.setTool(toolOf(p))
        else this.ed.toolbar.refresh()
      } else this.render()
      saveSettings()
    }
    const types = h('div', { class: 'pen-types six' })
    for (const k of PRESET_TYPES) {
      const b = h('button', { class: 'pen-type' + (p.type === k ? ' active' : '') }, icon(k, 24), h('span', null, PEN_TYPES[k].label))
      b.addEventListener('click', () => {
        const wasHl = p.type === 'highlighter'
        p.type = k
        if (wasHl !== (k === 'highlighter')) p.width = k === 'highlighter' ? 14 : 1.6
        types.querySelectorAll('.pen-type').forEach((x) => x.classList.remove('active'))
        b.classList.add('active')
        widthRow.replaceWith((widthRow = makeWidth()))
        live()
      })
      types.append(b)
    }
    const makeWidth = () => {
      const hl = p.type === 'highlighter'
      return slider({
        min: hl ? 3 : 0.4,
        max: hl ? 40 : 12,
        step: hl ? 1 : 0.1,
        value: p.width,
        format: (v) => v.toFixed(hl ? 0 : 1),
        onInput: (v) => {
          p.width = v
          live()
        },
      })
    }
    let widthRow = makeWidth()
    const picker = colorPicker(
      p.color,
      (c, final) => {
        p.color = c
        live()
        if (final) pushRecentColor(c)
      },
      { recent: settings.recentColors }
    )
    const del = h('button', { class: 'btn danger block', disabled: this.presets.length <= 1 }, icon('trash', 18), 'Remove from bar')
    del.addEventListener('click', () => {
      closePopover()
      this.removePreset(p)
    })
    const body = h(
      'div',
      { class: 'pop-section preset-editor' },
      h('div', { class: 'pop-title' }, 'Type'),
      types,
      h('div', { class: 'pop-title' }, 'Width'),
      widthRow,
      h('div', { class: 'pop-title' }, 'Color'),
      picker,
      del
    )
    popover(anchor, body, { placement: this.el.getBoundingClientRect().top > window.innerHeight / 2 ? 'above' : 'below' })
  }

  removePreset(p) {
    const list = this.presets
    const i = list.indexOf(p)
    if (i < 0 || list.length <= 1) return
    list.splice(i, 1)
    if (settings.activePreset === p.id) {
      const next = list[Math.min(i, list.length - 1)]
      this.select(next)
    } else {
      saveSettings()
      this.render()
    }
  }

  barMenu(anchor) {
    menu(anchor, [
      {
        label: this.cfg.vertical ? 'Horizontal bar' : 'Vertical bar',
        icon: 'move',
        onClick: () => {
          this.cfg.vertical = !this.cfg.vertical
          saveSettings()
          this.render()
        },
      },
      {
        label: 'Move the active pen earlier',
        icon: 'back',
        disabled: !this.active() || this.presets.indexOf(this.active()) <= 0,
        onClick: () => this.moveActive(-1),
      },
      {
        label: 'Move the active pen later',
        icon: 'forward',
        disabled: !this.active() || this.presets.indexOf(this.active()) >= this.presets.length - 1,
        onClick: () => this.moveActive(1),
      },
      { label: 'Restore default pens', icon: 'undo', onClick: () => this.resetPresetsPrompt() },
      '-',
      { label: 'Hide pen bar', icon: 'close', onClick: () => this.setShown(false) },
    ])
  }

  moveActive(dir) {
    const list = this.presets
    const act = this.active()
    const i = list.indexOf(act)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    saveSettings()
    this.render()
  }

  setCollapsed(v) {
    this.cfg.collapsed = v
    saveSettings()
    this.render()
  }

  toggleCollapsed() {
    if (!this.cfg.show) return this.setShown(true)
    this.setCollapsed(!this.cfg.collapsed)
  }

  setShown(v) {
    this.cfg.show = v
    saveSettings()
    this.render()
  }

  async resetPresetsPrompt() {
    if (await confirmDialog('Restore the default pens in the bar?')) {
      settings.penPresets = [
        { id: uid(), type: 'plain', color: '#1f2a44', width: 1.6 },
        { id: uid(), type: 'plain', color: '#e03131', width: 1.6 },
        { id: uid(), type: 'plain', color: '#1c7ed6', width: 1.6 },
        { id: uid(), type: 'highlighter', color: '#ffd43b', width: 14 },
      ]
      this.select(settings.penPresets[0])
    }
  }

  destroy() {
    window.removeEventListener('resize', this.onResize)
    this.el.remove()
  }
}
