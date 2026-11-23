// Bridge to the native Android layer that draws the live stroke (InkOverlayPlugin).
// The app tells it where and how the user can write; it draws without going through the WebView and,
// when the pen lifts, returns the points: the stroke joins the page like any other.
// When the layer cannot handle it (other tools, shapes, open menus, page in motion)
// the pen reaches the WebView as usual.
import { Capacitor } from '@capacitor/core'
import { InkOverlay } from '../palm.js'
import { settings } from '../settings.js'
import { PEN_TYPES } from '../ink.js'
import { displayColor, isDark } from '../theme.js'

const SETTLE_MS = 80

export class NativeInk {
  constructor(ed) {
    this.ed = ed
    this.available = Capacitor.isNativePlatform()
    this.active = false
    this.moving = false
    this.last = ''
    if (!this.available) return
    this.onEvent = (e) => this.handle(e.detail || {})
    window.addEventListener('nativeink', this.onEvent)
    this.offCam = ed.view.onCamera(() => this.cameraMoved())
    // popovers and dialogs are appended to body: with one open, the pen must reach the WebView
    this.observer = new MutationObserver(() => this.sync())
    this.observer.observe(document.body, { childList: true })
    // side panels slide in: their area is measured once they arrive
    this.onTransition = () => this.sync()
    document.addEventListener('transitionend', this.onTransition, true)
    this.sync()
  }

  handle(d) {
    const ed = this.ed
    if (d.phase === 'down') {
      this.active = true
      ed.lastPen = performance.now()
      ed.view.cancelTouches(true)
      ed.selection.drop()
      ed.inkStarted()
      // a button pressed mid-stroke switches tool, but the stroke stays with the tool that started it
      this.strokeTool = ed.tools[ed.holdTool || ed.tool]
    } else if (d.phase === 'up') {
      this.active = false
      ed.lastPen = performance.now()
      ed.inkEnded()
      const tool = this.strokeTool || ed.tools[ed.holdTool || ed.tool]
      this.strokeTool = null
      if (Array.isArray(d.points) && d.points.length >= 2) tool.commitNative?.(d.points)
      ed.toolbar.refreshHistory()
      // the native layer clears its stroke once the page's copy is ready to appear
      InkOverlay.committed({ id: d.id }).catch(() => {})
    }
  }

  cameraMoved() {
    if (!this.moving) {
      this.moving = true
      this.sync()
    }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.moving = false
      this.sync()
    }, SETTLE_MS)
  }

  canUse(tool) {
    if (!settings.nativeInk || settings.shapeHold || this.moving) return false
    if (tool !== 'pen' && tool !== 'highlighter') return false
    if (tool === 'highlighter' && settings.highlighter.straight) return false
    const type = tool === 'highlighter' ? 'highlighter' : settings.pen.type
    if (!PEN_TYPES[type]?.line) return false
    if (this.ed.selection.active) return false
    return !document.querySelector('.dialog-backdrop, .popover')
  }

  // Rectangles in CSS px relative to the WebView: visible pages and areas reserved for the UI.
  config() {
    const ed = this.ed
    const v = ed.view
    const tool = ed.holdTool || ed.tool
    if (!this.canUse(tool)) return { enabled: false }
    const cfg = settings[tool]
    const T = PEN_TYPES[tool === 'highlighter' ? 'highlighter' : cfg.type]
    const pages = []
    const left = v.left, top = v.top, right = v.left + v.vw, bottom = v.top + v.vh
    for (const e of v.entries) {
      const a = v.toClient(e.x, e.y)
      const b = v.toClient(e.x + e.w, e.y + e.h)
      const x0 = Math.max(a.x, left), y0 = Math.max(a.y, top)
      const x1 = Math.min(b.x, right), y1 = Math.min(b.y, bottom)
      if (x1 > x0 && y1 > y0) pages.push(x0, y0, x1, y1)
    }
    const excl = []
    for (const el of document.querySelectorAll('.penbar, .side-panel.open, .page-indicator')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.height) excl.push(r.left, r.top, r.right, r.bottom)
    }
    return {
      enabled: true,
      color: displayColor(cfg.color),
      alpha: isDark() && T.blend ? Math.min(1, T.alpha + 0.08) : T.alpha,
      width: cfg.width * v.s * v.dpr,
      dpr: v.dpr,
      predict: settings.predict,
      pages,
      excl,
    }
  }

  sync() {
    if (!this.available) return
    const c = this.config()
    const key = JSON.stringify(c)
    if (key === this.last) return
    this.last = key
    InkOverlay.configure(c).catch(() => {})
  }

  destroy() {
    if (!this.available) return
    clearTimeout(this.timer)
    window.removeEventListener('nativeink', this.onEvent)
    this.offCam()
    this.observer.disconnect()
    document.removeEventListener('transitionend', this.onTransition, true)
    InkOverlay.configure({ enabled: false }).catch(() => {})
  }
}
