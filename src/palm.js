// Palm rejection: the app picks the level; the real filter is native (InputRouter.java) and acts
// before touches reach the WebView. In the browser the editor's simpler check remains.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { settings } from './settings.js'

export const InkOverlay = registerPlugin('InkOverlay')

export const PALM_MODES = [
  { value: 'normal', label: 'Normal', text: 'Normal' },
  { value: 'strong', label: 'Strong', text: 'Strong' },
  { value: 'two', label: 'Strong, and scroll with two fingers only', text: 'Two fingers' },
]

// graceMs: after the last pen signal, fingers are ignored everywhere
// zoneMs/zoneMm: longer, but only near where the pen wrote (that is where the hand rests)
// palmMm: contacts wider than this are not a finger
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
