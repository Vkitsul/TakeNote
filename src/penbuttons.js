// Tasti della penna configurabili.
// I segnali arrivano da due fonti, entrambe tradotte in un id testuale:
//  - Android (MainActivity): 'btn:<bit>' dallo stato dei pulsanti, 'key:<keycode>' o 'scan:<code>' dai tasti fisici
//    (le penne Xiaomi usano 'key:92' e 'key:93', cioè Pagina su/giù)
//  - Pointer Events del WebView/browser: 'pbtn:<bit>' dai bit di `buttons` (2 = tasto laterale, 4 = secondo tasto)
// Ogni tasto configurato raccoglie uno o più id: così una sola pressione segnalata da più fonti scatta una volta sola.
import { settings, saveSettings } from './settings.js'

export const PEN_ACTIONS = [
  { id: 'none', label: 'Nessuna azione' },
  { id: 'hold-eraser', label: 'Gomma finché tieni premuto', hold: 'eraser' },
  { id: 'hold-highlighter', label: 'Evidenziatore finché tieni premuto', hold: 'highlighter' },
  { id: 'hold-lasso', label: 'Lazo finché tieni premuto', hold: 'lasso' },
  { id: 'hold-snip', label: 'Snip finché tieni premuto', hold: 'snip' },
  { id: 'toggle-eraser', label: 'Alterna penna / gomma' },
  { id: 'toggle-lasso', label: 'Alterna penna / lazo' },
  { id: 'undo', label: 'Annulla' },
  { id: 'redo', label: 'Ripeti' },
  { id: 'next-pen', label: 'Penna successiva della barra' },
  { id: 'prev-pen', label: 'Penna precedente della barra' },
  { id: 'toggle-penbar', label: 'Riduci / espandi la barra penne' },
]

const WEB_BITS = [2, 4, 8, 16]
const held = new Set()
const pressed = new Set() // indici dei tasti configurati attualmente premuti
const listeners = new Set()
let webBits = 0
let learner = null
const monitors = new Set()

export function onPenButton(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Riceve ogni segnale grezzo (per la schermata "prova tasti").
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
    // un rilascio dal lato Android chiude anche gli eventuali segnali web rimasti appesi
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

// Bit dei pulsanti dai Pointer Events della penna (fallback quando Android non inoltra nulla).
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

// Attende la pressione di un tasto (fino a timeoutMs) e restituisce gli id ricevuti.
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
  // un id appartiene a un solo tasto
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
  // in cattura, così lo stato dei tasti è aggiornato prima che l'editor gestisca l'evento
  for (const t of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(t, feedPointer, true)
}
