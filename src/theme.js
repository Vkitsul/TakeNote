// Modalità scura: cambia solo la visualizzazione, mai i dati salvati.
// - pagine, carta e PDF vengono invertiti (come il filtro CSS DARK_FILTER)
// - l'inchiostro "nero" (colori scuri e poco saturi) diventa chiaro, gli altri colori restano uguali
// Togliendo la modalità scura tutto torna com'era; l'export PDF usa sempre i colori originali.
import { Capacitor } from '@capacitor/core'
import { settings, saveSettings } from './settings.js'
import { hexToRgb, rgbToHex } from './util.js'

export const DARK_FILTER = 'invert(0.9) hue-rotate(180deg)'

const listeners = new Set()
const inkCache = new Map()
const paperCache = new Map()

export const isDark = () => !!settings.dark

export function onTheme(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setDark(v) {
  settings.dark = !!v
  saveSettings()
  inkCache.clear()
  paperCache.clear()
  applyTheme()
  for (const fn of listeners) fn()
}

export function applyTheme() {
  const dark = isDark()
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1c20' : '#ffffff')
  if (Capacitor.isNativePlatform()) {
    import('@capacitor/core')
      .then(({ SystemBars, SystemBarsStyle }) => SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }))
      .catch(() => {})
  }
}

// Colore con cui disegnare un tratto sullo schermo.
export function displayColor(hex) {
  if (!isDark()) return hex
  let c = inkCache.get(hex)
  if (c) return c
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max < 0.45 && max - min < 0.2) {
    // "nero": inverte la luminosità mantenendo la tinta, poi lo avvicina al bianco
    const k = 1 - max - min
    const mix = (v) => ((v + k) * 0.6 + 0.4) * 255
    c = rgbToHex(mix(r), mix(g), mix(b))
  } else c = hex
  inkCache.set(hex, c)
  return c
}

// Stesso risultato di DARK_FILTER applicato a un colore pieno (per lo sfondo della carta).
export function displayPaper(hex) {
  if (!isDark()) return hex
  let c = paperCache.get(hex)
  if (c) return c
  const inv = hexToRgb(hex).map((v) => {
    const x = v / 255
    return 0.1 * x + 0.9 * (1 - x)
  })
  const [r, g, b] = inv
  const cl = (v) => Math.min(1, Math.max(0, v)) * 255
  c = rgbToHex(
    cl(-0.574 * r + 1.43 * g + 0.144 * b),
    cl(0.426 * r + 0.43 * g + 0.144 * b),
    cl(0.426 * r + 1.43 * g - 0.856 * b)
  )
  paperCache.set(hex, c)
  return c
}
