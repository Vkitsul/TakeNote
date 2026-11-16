// Rifiuto del palmo: l'app sceglie il livello, il filtro vero è nativo (InputRouter.java) e agisce
// prima che i tocchi arrivino al WebView. Nel browser resta il controllo più semplice dell'editor.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { settings } from './settings.js'

export const InkOverlay = registerPlugin('InkOverlay')

export const PALM_MODES = [
  { value: 'normal', label: 'Normale', text: 'Normale' },
  { value: 'strong', label: 'Forte', text: 'Forte' },
  { value: 'two', label: 'Forte, e si scorre solo con due dita', text: 'Due dita' },
]

// graceMs: dopo l'ultimo segnale della penna le dita sono ignorate ovunque
// zoneMs/zoneMm: più a lungo, ma solo vicino a dove la penna ha scritto (lì c'è la mano)
// palmMm: contatti più larghi di così non sono un dito
const STRONG = { graceMs: 700, zoneMs: 2500, zoneMm: 90, palmMm: 20 }
const LEVELS = {
  normal: { graceMs: 350, zoneMs: 0, zoneMm: 0, palmMm: 0 },
  strong: STRONG,
  two: STRONG,
}

export function applyPalm() {
  if (!Capacitor.isNativePlatform()) return
  InkOverlay.palm({ enabled: true, ...(LEVELS[settings.palm] || STRONG) }).catch(() => {})
}
