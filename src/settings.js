import * as db from './db.js'
import { debounce } from './util.js'

// User preferences (tools, colors, pen behavior). Saved in the "meta" store.
const DEFAULTS = {
  tool: 'pen',
  pen: {
    type: 'plain',
    color: '#1f2a44',
    width: 1.6,
    colors: ['#1f2a44', '#e03131', '#1c7ed6', '#2f9e44', '#f08c00'],
    widths: [1, 1.6, 2.8],
  },
  highlighter: {
    color: '#ffd43b',
    width: 14,
    colors: ['#ffd43b', '#8ce99a', '#ffa8c5', '#74c0fc', '#ffc078'],
    widths: [8, 14, 22],
    straight: false,
  },
  eraser: { mode: 'stroke', size: 14, sizes: [8, 14, 28], highlighterOnly: false },
  snip: { mode: 'rect' },
  shapeHold: false,
  nativeInk: true, // live stroke drawn by a native Android layer (much more responsive than the WebView)
  predict: true, // the stroke tip runs a few milliseconds ahead of the pen
  palm: 'strong', // palm rejection: 'normal' | 'strong' | 'two' (scroll with two fingers only)
  fingerDraw: false,
  twoFingerUndo: true,
  pressure: 1, // pressure curve exponent (<1 = more sensitive)
  recentColors: [],
  // Pen buttons: ids = recognized signals (see penbuttons.js), action = what they do
  penButtons: [
    { name: 'Button 1', ids: ['key:92', 'btn:32', 'key:308', 'pbtn:2', 'btn:2'], action: 'toggle-eraser' },
    { name: 'Button 2', ids: ['key:93', 'btn:64', 'key:309', 'pbtn:4', 'btn:4'], action: 'toggle-lasso' },
  ],
  penButtonsRev: 2,
  inkRev: 1,
  // Floating pen bar (as in Notein): favorite pens, position, collapsed/expanded
  penPresets: [
    { id: 'p1', type: 'plain', color: '#1f2a44', width: 1.6 },
    { id: 'p2', type: 'plain', color: '#e03131', width: 1.6 },
    { id: 'p3', type: 'plain', color: '#1c7ed6', width: 1.6 },
    { id: 'p4', type: 'highlighter', color: '#ffd43b', width: 14 },
  ],
  activePreset: 'p1',
  penBar: { show: true, collapsed: false, vertical: false, x: 0.5, y: 0.9 },
  dark: false,
  // Automatic backup: target 'drive' = file picked with the Android picker (e.g. Google Drive), 'device' = Documents
  autoBackup: { enabled: true, frequency: 'daily', target: 'device', uri: '', label: '', persistent: true, keep: 5, lastAt: 0, lastSig: '', lastError: '', bannerDismissed: false },
}

export const settings = structuredClone(DEFAULTS)

function merge(target, src) {
  for (const k in src) {
    if (!(k in target)) continue
    const v = src[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object') merge(target[k], v)
    else target[k] = v
  }
}

// Since 1.4: Xiaomi pens send Page up/down (92/93) and the buttons are used with a single
// click (pen/eraser and pen/lasso), because HyperOS reacts when a button is held.
function migratePenButtons() {
  const [a, b] = settings.penButtons
  const taken = (id) => settings.penButtons.some((x) => x.ids.includes(id))
  if (a && !taken('key:92')) a.ids.unshift('key:92')
  if (b && !taken('key:93')) b.ids.unshift('key:93')
  if (a?.action === 'hold-eraser') a.action = 'toggle-eraser'
  if (b?.action === 'undo') b.action = 'toggle-lasso'
  settings.penButtonsRev = 2
  saveSettings()
}

// Since 1.5: writing works like Paint. No pressure and no automatic shapes, which
// turned slow strokes into straight lines. At the same width the uniform stroke looks
// thicker than the pressure one, so the widths are reduced.
function migrateInk() {
  const round1 = (v) => Math.max(0.4, Math.round(v * 7.5) / 10)
  settings.shapeHold = false
  if (settings.pen.type !== 'plain') {
    settings.pen.type = 'plain'
    settings.pen.width = round1(settings.pen.width)
    settings.pen.widths = settings.pen.widths.map(round1)
  }
  for (const p of settings.penPresets) {
    if (p.type !== 'highlighter' && p.type !== 'plain') {
      p.type = 'plain'
      p.width = round1(p.width)
    }
  }
  settings.inkRev = 1
  saveSettings()
}

export async function loadSettings() {
  try {
    const rec = await db.get('meta', 'settings')
    if (rec?.value) {
      merge(settings, rec.value)
      if (!rec.value.penButtonsRev) migratePenButtons()
      if (!rec.value.inkRev) migrateInk()
      // since 1.7 the interface is in English: rename the buttons saved with their old names
      settings.penButtons.forEach((b, i) => { if (/^Tasto \d$/.test(b.name)) b.name = 'Button ' + (i + 1) })
    }
  } catch (e) {
    console.warn('Settings not loaded', e)
  }
}

export const saveSettings = debounce(() => {
  db.put('meta', { key: 'settings', value: structuredClone(settings) }).catch((e) => console.warn(e))
}, 400)

export function pushRecentColor(c) {
  const list = settings.recentColors.filter((x) => x !== c)
  list.unshift(c)
  settings.recentColors = list.slice(0, 8)
  saveSettings()
}
