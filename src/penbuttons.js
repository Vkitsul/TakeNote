// Configurable pen buttons.
// Signals come from two sources, both turned into a text id:
//  - Android (MainActivity): 'btn:<bit>' from the button state, 'key:<keycode>' or 'scan:<code>' from physical keys
//    (Xiaomi pens use 'key:92' and 'key:93', i.e. Page up/down)
//  - WebView/browser Pointer Events: 'pbtn:<bit>' from the `buttons` bits (2 = barrel button, 4 = second button)
// Each configured button collects one or more ids, so a single press reported by several sources fires once.
import { settings, saveSettings } from './settings.js'

export const PEN_ACTIONS = [
  { id: 'none', label: 'No action' },
  { id: 'hold-eraser', label: 'Eraser while held', hold: 'eraser' },
  { id: 'hold-highlighter', label: 'Highlighter while held', hold: 'highlighter' },
  { id: 'hold-lasso', label: 'Lasso while held', hold: 'lasso' },
  { id: 'hold-snip', label: 'Snip while held', hold: 'snip' },
  { id: 'toggle-eraser', label: 'Toggle pen / eraser' },
  { id: 'toggle-lasso', label: 'Toggle pen / lasso' },
  { id: 'undo', label: 'Undo' },
  { id: 'redo', label: 'Redo' },
  { id: 'next-pen', label: 'Next pen in the bar' },
  { id: 'prev-pen', label: 'Previous pen in the bar' },
  { id: 'toggle-penbar', label: 'Collapse / expand the pen bar' },
]

const WEB_BITS = [2, 4, 8, 16]
const held = new Set()
const pressed = new Set() // indexes of the configured buttons currently pressed
const listeners = new Set()
let webBits = 0
let learner = null
const monitors = new Set()

export function onPenButton(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Receives every raw signal (for the "test buttons" screen).
export function onRawPenSignal(fn) {
  monitors.add(fn)
  return () => monitors.delete(fn)
}

export function actionInfo(id) {
  return PEN_ACTIONS.find((a) => a.id === id) || PEN_ACTIONS[0]
}

function signal(id, down, device = '') {
  for (const fn of monitors) fn(id, down, device)
  if (learner) {
    if (down) learner.ids.add(id)
    if (down && !learner.timer) learner.timer = setTimeout(finishLearn, 450)
    return
  }
  if (down) held.add(id)
  else {
    held.delete(id)
    // a release from the Android side also closes any web signals left hanging
    if (!id.startsWith('pbtn:')) {
      for (const x of [...held]) if (x.startsWith('pbtn:')) held.delete(x)
      webBits = 0
    }
  }
  settings.penButtons.forEach((b, i) => {
    const isDown = b.ids.some((x) => held.has(x))
    if (isDown && !pressed.has(i)) {
      pressed.add(i)
      for (const fn of listeners) fn({ index: i, binding: b, down: true })
    } else if (!isDown && pressed.has(i)) {
      pressed.delete(i)
      for (const fn of listeners) fn({ index: i, binding: b, down: false })
    }
  })
}

// Button bits from the pen's Pointer Events (fallback when Android forwards nothing).
export function feedPointer(e) {
  if (e.pointerType !== 'pen') return
  let bits = 0
  for (const b of WEB_BITS) if (e.buttons & b) bits |= b
  const changed = bits ^ webBits
  if (!changed) return
  webBits = bits
  for (const b of WEB_BITS) if (changed & b) signal('pbtn:' + b, !!(bits & b))
}

export function releaseAll() {
  for (const id of [...held]) signal(id, false)
  webBits = 0
}

function finishLearn() {
  const l = learner
  learner = null
  l?.resolve([...l.ids])
}

// Waits for a button press (up to timeoutMs) and returns the ids received.
export function learnButton(timeoutMs = 10000) {
  releaseAll()
  if (learner) finishLearn()
  return new Promise((resolve) => {
    learner = { ids: new Set(), timer: 0, resolve }
    const l = learner
    setTimeout(() => {
      if (learner === l) finishLearn()
    }, timeoutMs)
  })
}

export function cancelLearn() {
  if (!learner) return
  clearTimeout(learner.timer)
  const l = learner
  learner = null
  l.resolve([])
}

export function setBinding(index, patch) {
  const b = settings.penButtons[index]
  if (!b) return
  Object.assign(b, patch)
  // an id belongs to one button only
  if (patch.ids) {
    settings.penButtons.forEach((o, i) => {
      if (i !== index) o.ids = o.ids.filter((x) => !patch.ids.includes(x))
    })
  }
  pressed.clear()
  held.clear()
  saveSettings()
}

export function initPenButtons() {
  window.addEventListener('penbutton', (e) => {
    const d = e.detail || {}
    if (typeof d.id === 'string') signal(d.id, !!d.down, typeof d.device === 'string' ? d.device : '')
  })
  window.addEventListener('blur', releaseAll)
  // in the capture phase, so the button state is up to date before the editor handles the event
  for (const t of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(t, feedPointer, true)
}
