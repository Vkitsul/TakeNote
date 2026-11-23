// UI components: toasts, popovers, menus, dialogs, color picker, sliders, switches.
import { h, clamp, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from './util.js'
import { icon } from './icons.js'

let toastEl = null
let toastTimer = 0
export function toast(msg, ms = 2200) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast' })
    document.body.append(toastEl)
  }
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms)
}

// --- Popover anchored to an element ---
let openPop = null
export function closePopover() {
  if (openPop) {
    const p = openPop
    openPop = null
    p.close()
  }
}

export function popover(anchor, content, { placement = 'below', className = '', onClose } = {}) {
  closePopover()
  const el = h('div', { class: 'popover ' + className }, content)
  document.body.append(el)
  const r = anchor.getBoundingClientRect()
  const pw = el.offsetWidth
  const ph = el.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = clamp(r.left + r.width / 2 - pw / 2, 8, vw - pw - 8)
  let top = placement === 'above' ? r.top - ph - 8 : r.bottom + 8
  if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 8)
  if (top < 8) top = 8
  el.style.left = left + 'px'
  el.style.top = top + 'px'
  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover()
  }
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
  const pop = {
    el,
    close() {
      document.removeEventListener('pointerdown', onDown, true)
      el.remove()
      if (openPop === pop) openPop = null
      onClose?.()
    },
  }
  openPop = pop
  return pop
}

// List menu: items = [{label, icon, danger, onClick}] or '-' for a separator
export function menu(anchor, items, opts) {
  const list = h('div', { class: 'menu' })
  for (const it of items) {
    if (it === '-') {
      list.append(h('div', { class: 'menu-sep' }))
      continue
    }
    if (!it) continue
    list.append(
      h(
        'button',
        {
          class: 'menu-item' + (it.danger ? ' danger' : ''),
          disabled: it.disabled,
          onclick: () => {
            closePopover()
            it.onClick?.()
          },
        },
        it.icon ? icon(it.icon, 20) : null,
        h('span', null, it.label)
      )
    )
  }
  return popover(anchor, list, { className: 'menu-pop', ...opts })
}

// --- Modal dialogs ---
export function openDialog({ title, body, actions = [], className = '', onClose }) {
  closePopover()
  const backdrop = h('div', { class: 'dialog-backdrop' })
  const footer = h('div', { class: 'dialog-actions' })
  const box = h('div', { class: 'dialog ' + className }, title ? h('h2', null, title) : null, h('div', { class: 'dialog-body' }, body), footer)
  backdrop.append(box)
  const close = () => {
    backdrop.remove()
    onClose?.()
  }
  for (const a of actions) {
    footer.append(
      h(
        'button',
        {
          class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
          onclick: async () => {
            const keep = await a.onClick?.()
            if (keep !== false) close()
          },
        },
        a.label
      )
    )
  }
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close()
  })
  document.body.append(backdrop)
  return { close, box }
}

export function confirmDialog(message, { okLabel = 'Confirm', danger = false, title = '' } = {}) {
  return new Promise((resolve) => {
    let result = false
    openDialog({
      title,
      body: h('p', null, message),
      actions: [
        { label: 'Cancel' },
        { label: okLabel, primary: !danger, danger, onClick: () => { result = true } },
      ],
      onClose: () => resolve(result),
    })
  })
}

export function promptDialog(title, value = '', { okLabel = 'OK', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let result = null
    const input = h('input', { class: 'input', type: 'text', value, placeholder })
    const d = openDialog({
      title,
      body: input,
      actions: [
        { label: 'Cancel' },
        { label: okLabel, primary: true, onClick: () => { result = input.value.trim() } },
      ],
      onClose: () => resolve(result),
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        result = input.value.trim()
        d.close()
      }
    })
    setTimeout(() => {
      input.focus()
      input.select()
    }, 50)
  })
}

export function progressDialog(title) {
  const bar = h('div', { class: 'progress-bar' })
  const label = h('div', { class: 'progress-label' }, '')
  const d = openDialog({ title, body: h('div', null, h('div', { class: 'progress' }, bar), label), className: 'progress-dialog' })
  return {
    set(frac, text) {
      bar.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%'
      if (text != null) label.textContent = text
    },
    close: d.close,
  }
}

// --- Controls ---
export function slider({ min, max, step = 0.1, value, onInput, format = (v) => v }) {
  const out = h('span', { class: 'slider-value' }, format(value))
  const input = h('input', { type: 'range', min, max, step, value, class: 'slider' })
  input.addEventListener('input', () => {
    const v = parseFloat(input.value)
    out.textContent = format(v)
    onInput(v)
  })
  return h('div', { class: 'slider-row' }, input, out)
}

export function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox' })
  input.checked = !!checked
  input.addEventListener('change', () => onChange(input.checked))
  return h('label', { class: 'toggle' }, h('span', null, label), input, h('span', { class: 'switch' }))
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented' })
  for (const o of options) {
    const b = h('button', { class: 'seg' + (o.value === value ? ' active' : ''), title: o.label }, o.icon ? icon(o.icon, 18) : null, o.text ?? o.label)
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.seg').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
      onChange(o.value)
    })
    wrap.append(b)
  }
  return wrap
}

export const PALETTE = [
  '#000000', '#1f2a44', '#495057', '#868e96', '#ffffff',
  '#1c3faa', '#1c7ed6', '#4dabf7', '#0c8599', '#15aabf',
  '#2b8a3e', '#37b24d', '#8ce99a', '#7a4b2a', '#a17044',
  '#c92a2a', '#e03131', '#ff6b6b', '#e64980', '#ffa8c5',
  '#e8590c', '#f08c00', '#ffd43b', '#6741d9', '#9c36b5',
]

// HSV color picker + palette
export function colorPicker(initial, onChange, { recent = [] } = {}) {
  let [hue, sat, val] = rgbToHsv(...hexToRgb(initial))
  const W = 232, H = 140
  const sv = h('canvas', { class: 'cp-sv', width: W, height: H })
  const hueBar = h('canvas', { class: 'cp-hue', width: W, height: 18 })
  const hex = h('div', { class: 'cp-hex' })
  const swatch = h('div', { class: 'cp-swatch' })
  const svCtx = sv.getContext('2d')
  const hueCtx = hueBar.getContext('2d')
  const grad = hueCtx.createLinearGradient(0, 0, W, 0)
  for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, rgbToHex(...hsvToRgb(i * 60 % 360, 1, 1)))

  function draw() {
    svCtx.fillStyle = rgbToHex(...hsvToRgb(hue, 1, 1))
    svCtx.fillRect(0, 0, W, H)
    const g1 = svCtx.createLinearGradient(0, 0, W, 0)
    g1.addColorStop(0, '#fff')
    g1.addColorStop(1, 'rgba(255,255,255,0)')
    svCtx.fillStyle = g1
    svCtx.fillRect(0, 0, W, H)
    const g2 = svCtx.createLinearGradient(0, 0, 0, H)
    g2.addColorStop(0, 'rgba(0,0,0,0)')
    g2.addColorStop(1, '#000')
    svCtx.fillStyle = g2
    svCtx.fillRect(0, 0, W, H)
    svCtx.strokeStyle = val > 0.5 ? '#000' : '#fff'
    svCtx.lineWidth = 2
    svCtx.beginPath()
    svCtx.arc(sat * W, (1 - val) * H, 7, 0, Math.PI * 2)
    svCtx.stroke()
    hueCtx.fillStyle = grad
    hueCtx.fillRect(0, 0, W, 18)
    hueCtx.strokeStyle = '#fff'
    hueCtx.lineWidth = 3
    hueCtx.strokeRect((hue / 360) * W - 3, 1, 6, 16)
    const c = current()
    hex.textContent = c.toUpperCase()
    swatch.style.background = c
  }
  const current = () => rgbToHex(...hsvToRgb(hue, sat, val))
  const emit = () => {
    draw()
    onChange(current(), false)
  }
  function drag(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId)
      const r = el.getBoundingClientRect()
      const move = (ev) => fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1))
      move(e)
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        onChange(current(), true)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    })
  }
  drag(sv, (x, y) => { sat = x; val = 1 - y; emit() })
  drag(hueBar, (x) => { hue = x * 359.9; emit() })

  const pal = h('div', { class: 'cp-palette' })
  const setHex = (c) => {
    ;[hue, sat, val] = rgbToHsv(...hexToRgb(c))
    draw()
    onChange(c, true)
  }
  for (const c of PALETTE) pal.append(h('button', { class: 'cp-dot', style: { background: c }, onclick: () => setHex(c) }))
  const rec = recent.length
    ? h('div', { class: 'cp-recent' }, h('span', { class: 'cp-label' }, 'Recent'), ...recent.map((c) => h('button', { class: 'cp-dot', style: { background: c }, onclick: () => setHex(c) })))
    : null
  draw()
  return h('div', { class: 'color-picker' }, pal, rec, sv, hueBar, h('div', { class: 'cp-row' }, swatch, hex))
}
