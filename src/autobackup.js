// Backup automatico: verso un file scelto dall'utente (Google Drive o altra app, tramite il
// selettore di Android) oppure nella memoria del tablet (Documenti/TakeNote/Backup, ultime copie).
// Parte solo se i dati sono cambiati dall'ultimo backup.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { settings, saveSettings } from './settings.js'
import { writeBackup, dataSignature } from './backup.js'
import { blobToBase64 } from './util.js'

const BackupTarget = registerPlugin('BackupTarget')
// in sviluppo si può simulare l'app Android (il plugin Filesystem ha un'implementazione web)
export const autoBackupSupported =
  Capacitor.isNativePlatform() || (import.meta.env.DEV && globalThis.localStorage?.getItem('tn-fake-native') === '1')

const DEVICE_DIR = 'TakeNote/Backup'
const CHUNK = 3 * 1024 * 1024
const INTERVALS = { change: 0, daily: 20 * 3600e3, weekly: 6.5 * 86400e3 }

export const FREQUENCIES = [
  { value: 'daily', label: 'Ogni giorno' },
  { value: 'change', label: 'A ogni chiusura' },
  { value: 'weekly', label: 'Ogni settimana' },
]

let running = null
const listeners = new Set()

export function onBackupStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = (status) => {
  for (const fn of listeners) fn(status)
}

export const isBackupRunning = () => !!running

async function fs() {
  return import('@capacitor/filesystem')
}

// Scrive il backup in un file dell'app a blocchi da qualche MB e ne restituisce l'uri.
export async function writeBackupFile(path, directory, onProgress) {
  const { Filesystem, Directory } = await fs()
  let first = true
  let buf = []
  let size = 0
  const out = async (force) => {
    if (!buf.length || (!force && size < CHUNK)) return
    const data = await blobToBase64(new Blob(buf))
    buf = []
    size = 0
    if (first) {
      await Filesystem.writeFile({ path, data, directory: Directory[directory], recursive: true })
      first = false
    } else await Filesystem.appendFile({ path, data, directory: Directory[directory] })
  }
  await writeBackup(
    async (chunk) => {
      buf.push(chunk)
      size += chunk.length
      await out(false)
    },
    null,
    onProgress
  )
  await out(true)
  const { uri } = await Filesystem.getUri({ path, directory: Directory[directory] })
  return uri
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function pruneDevice(keep) {
  const { Filesystem, Directory } = await fs()
  const { files } = await Filesystem.readdir({ path: DEVICE_DIR, directory: Directory.Documents })
  const list = files
    .map((f) => (typeof f === 'string' ? f : f.name))
    .filter((n) => /^TakeNote-.*\.takenote$/.test(n))
    .sort()
    .reverse()
  for (const name of list.slice(keep)) {
    await Filesystem.deleteFile({ path: `${DEVICE_DIR}/${name}`, directory: Directory.Documents }).catch(() => {})
  }
}

// Esegue subito un backup verso la destinazione configurata.
export function runBackup({ onProgress } = {}) {
  if (running) return running
  running = (async () => {
    const cfg = settings.autoBackup
    emit({ state: 'running' })
    try {
      if (!autoBackupSupported) throw new Error('Disponibile solo nell’app Android')
      const sig = await dataSignature()
      const { Filesystem, Directory } = await fs()
      if (cfg.target === 'drive') {
        if (!cfg.uri) throw new Error('Scegli prima dove salvare il backup')
        const path = 'autobackup.takenote'
        const uri = await writeBackupFile(path, 'Cache', onProgress)
        try {
          await BackupTarget.write({ uri: cfg.uri, path: uri })
        } catch (e) {
          if (e?.code === 'PERMISSION') throw new Error('Accesso al file di backup perso: sceglilo di nuovo')
          throw e
        } finally {
          await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {})
        }
      } else {
        await writeBackupFile(`${DEVICE_DIR}/TakeNote-${stamp()}.takenote`, 'Documents', onProgress)
        await pruneDevice(Math.max(1, cfg.keep || 5))
      }
      cfg.lastAt = Date.now()
      cfg.lastSig = sig
      cfg.lastError = ''
      saveSettings()
      emit({ state: 'done' })
      return true
    } catch (e) {
      console.error('Backup automatico', e)
      cfg.lastError = String(e?.message || e)
      cfg.lastErrorAt = Date.now()
      saveSettings()
      emit({ state: 'error', error: cfg.lastError })
      return false
    } finally {
      running = null
    }
  })()
  return running
}

// Controlla se è il momento di fare un backup (frequenza + dati cambiati).
export async function maybeAutoBackup(reason = 'timer') {
  const cfg = settings.autoBackup
  if (!autoBackupSupported || !cfg.enabled || running) return false
  if (cfg.target === 'drive' && !cfg.uri) return false
  if (cfg.frequency === 'change' && reason === 'timer') return false
  if (Date.now() - (cfg.lastAt || 0) < (INTERVALS[cfg.frequency] ?? INTERVALS.daily)) return false
  if ((await dataSignature()) === cfg.lastSig) return false
  return runBackup()
}

// Fa scegliere all'utente il file di destinazione (es. una cartella di Google Drive).
export async function pickDriveTarget() {
  const r = await BackupTarget.pick({ name: 'TakeNote-backup.takenote' })
  const cfg = settings.autoBackup
  cfg.target = 'drive'
  cfg.uri = r.uri
  cfg.label = [r.provider, r.name].filter(Boolean).join(' · ')
  cfg.persistent = !!r.persistent
  cfg.lastSig = '' // il prossimo backup va fatto anche se i dati non sono cambiati
  saveSettings()
  return r
}

let timer = 0
export function startAutoBackup({ isEditing }) {
  if (!autoBackupSupported) return
  clearInterval(timer)
  // controllo periodico, solo fuori dall'editor per non rallentare la scrittura
  timer = setInterval(() => {
    if (!isEditing()) maybeAutoBackup('timer')
  }, 20 * 60e3)
  window.addEventListener('app-pause', () => setTimeout(() => maybeAutoBackup('pause'), 1500))
  setTimeout(() => maybeAutoBackup('start'), 4000)
}
