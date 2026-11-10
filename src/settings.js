import * as db from './db.js'
import { debounce } from './util.js'

// Preferenze utente (strumenti, colori, comportamento penna). Salvate nello store "meta".
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
  nativeInk: true, // tratto in corso disegnato da un livello nativo Android (molto più reattivo del WebView)
  fingerDraw: false,
  twoFingerUndo: true,
  pressure: 1, // esponente della curva di pressione (<1 = più sensibile)
  recentColors: [],
  // Tasti della penna: ids = segnali riconosciuti (vedi penbuttons.js), action = cosa fanno
  penButtons: [
    { name: 'Tasto 1', ids: ['key:92', 'btn:32', 'key:308', 'pbtn:2', 'btn:2'], action: 'toggle-eraser' },
    { name: 'Tasto 2', ids: ['key:93', 'btn:64', 'key:309', 'pbtn:4', 'btn:4'], action: 'toggle-lasso' },
  ],
  penButtonsRev: 2,
  inkRev: 1,
  // Barra penne flottante (come in Notein): penne preferite, posizione, ridotta/espansa
  penPresets: [
    { id: 'p1', type: 'plain', color: '#1f2a44', width: 1.6 },
    { id: 'p2', type: 'plain', color: '#e03131', width: 1.6 },
    { id: 'p3', type: 'plain', color: '#1c7ed6', width: 1.6 },
    { id: 'p4', type: 'highlighter', color: '#ffd43b', width: 14 },
  ],
  activePreset: 'p1',
  penBar: { show: true, collapsed: false, vertical: false, x: 0.5, y: 0.9 },
  dark: false,
  // Backup automatico: target 'drive' = file scelto col selettore di Android (es. Google Drive), 'device' = Documenti
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

// Dalla versione 1.4: le penne Xiaomi inviano Pagina su/giù (92/93) e i tasti si usano con un clic
// singolo (penna/gomma e penna/lazo), perché HyperOS reagisce quando un tasto resta premuto.
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

// Dalla versione 1.5: scrittura come in Paint. Niente pressione e niente forme automatiche, che
// trasformavano in linee dritte i tratti rallentati. Il tratto uniforme a parità di spessore
// appare più grosso di quello a pressione, quindi gli spessori si riducono.
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
    }
  } catch (e) {
    console.warn('Impostazioni non caricate', e)
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
