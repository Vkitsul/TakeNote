// Automatic backup: to a file the user picked (Google Drive or another app, through the
// Android file picker) or to the tablet storage (Documents/TakeNote/Backup, latest copies).
// Runs only if the data changed since the last backup.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { settings, saveSettings } from './settings.js'
import { writeBackup, dataSignature } from './backup.js'
import { blobToBase64 } from './util.js'

const BackupTarget = registerPlugin('BackupTarget')
// in development the Android app can be simulated (the Filesystem plugin has a web implementation)
export const autoBackupSupported =
  Capacitor.isNativePlatform() || (import.meta.env.DEV && globalThis.localStorage?.getItem('tn-fake-native') === '1')

const DEVICE_DIR = 'TakeNote/Backup'
const CHUNK = 3 * 1024 * 1024
const INTERVALS = { change: 0, daily: 20 * 3600e3, weekly: 6.5 * 86400e3 }

export const FREQUENCIES = [
  { value: 'daily', label: 'Every day' },
  { value: 'change', label: 'Each time a notebook closes' },
  { value: 'weekly', label: 'Every week' },
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

// Writes the backup to an app file in chunks of a few MB and returns its uri.
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

// Runs a backup to the configured destination right away.
export function runBackup({ onProgress } = {}) {
  if (running) return running
  running = (async () => {
    const cfg = settings.autoBackup
    emit({ state: 'running' })
    try {
      if (!autoBackupSupported) throw new Error('Only available in the Android app')
      const sig = await dataSignature()
      const { Filesystem, Directory } = await fs()
      if (cfg.target === 'drive') {
        if (!cfg.uri) throw new Error('Choose where to save the backup first')
        const path = 'autobackup.takenote'
        const uri = await writeBackupFile(path, 'Cache', onProgress)
        try {
          await BackupTarget.write({ uri: cfg.uri, path: uri })
        } catch (e) {
          if (e?.code === 'PERMISSION') throw new Error('Access to the backup file was lost: choose it again')
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
      console.error('Automatic backup', e)
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

// Checks whether a backup is due (frequency + changed data).
export async function maybeAutoBackup(reason = 'timer') {
  const cfg = settings.autoBackup
  if (!autoBackupSupported || !cfg.enabled || running) return false
  if (cfg.target === 'drive' && !cfg.uri) return false
  if (cfg.frequency === 'change' && reason === 'timer') return false
  if (Date.now() - (cfg.lastAt || 0) < (INTERVALS[cfg.frequency] ?? INTERVALS.daily)) return false
  if ((await dataSignature()) === cfg.lastSig) return false
  return runBackup()
}

// Lets the user pick the destination file (e.g. a Google Drive folder).
export async function pickDriveTarget() {
  const r = await BackupTarget.pick({ name: 'TakeNote-backup.takenote' })
  const cfg = settings.autoBackup
  cfg.target = 'drive'
  cfg.uri = r.uri
  cfg.label = [r.provider, r.name].filter(Boolean).join(' · ')
  cfg.persistent = !!r.persistent
  cfg.lastSig = '' // the next backup runs even if the data has not changed
  saveSettings()
  return r
}

let timer = 0
export function startAutoBackup({ isEditing }) {
  if (!autoBackupSupported) return
  clearInterval(timer)
  // periodic check, only outside the editor so it never slows down writing
  timer = setInterval(() => {
    if (!isEditing()) maybeAutoBackup('timer')
  }, 20 * 60e3)
  window.addEventListener('app-pause', () => setTimeout(() => maybeAutoBackup('pause'), 1500))
  setTimeout(() => maybeAutoBackup('start'), 4000)
}
