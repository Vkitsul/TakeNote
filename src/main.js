import './styles.css'
import { openDB } from './db.js'
import { loadSettings, settings } from './settings.js'
import { initPlatform } from './platform.js'
import { Library } from './library.js'
import { Editor } from './editor/editor.js'
import { toast } from './ui.js'
import { initPenButtons } from './penbuttons.js'
import { applyTheme } from './theme.js'
import { applyPalm } from './palm.js'
import { startAutoBackup, maybeAutoBackup } from './autobackup.js'

const root = document.getElementById('app')
if (import.meta.env.DEV) window.__settings = settings
let current = null

function showLibrary() {
  current?.destroy?.()
  current = new Library(root, { onOpen: openNotebook })
}

let opening = false
async function openNotebook(id) {
  if (opening) return
  opening = true
  current?.destroy?.()
  current = null
  try {
    current = await Editor.open(root, id, () => {
      current = null
      showLibrary()
      maybeAutoBackup('close')
    })
  } catch (e) {
    console.error(e)
    toast('Impossibile aprire il quaderno')
    showLibrary()
  } finally {
    opening = false
  }
}

async function start() {
  try {
    await openDB()
    await loadSettings()
    applyTheme()
    navigator.storage?.persist?.().catch(() => {})
    initPenButtons()
    // il tasto della penna può generare un "clic destro": nessun menu contestuale nell'app
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest?.('input, textarea')) e.preventDefault()
    })
    await initPlatform()
    applyPalm()
    startAutoBackup({ isEditing: () => !!document.querySelector('.editor') })
  } catch (e) {
    console.error(e)
  }
  showLibrary()
}

start()
