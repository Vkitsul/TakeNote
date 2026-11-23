// "Automatic backup" screen and status indicator in the library.
import { h, formatDate } from './util.js'
import { icon } from './icons.js'
import { settings, saveSettings } from './settings.js'
import { openDialog, toggle, segmented, toast, progressDialog } from './ui.js'
import { autoBackupSupported, FREQUENCIES, runBackup, pickDriveTarget, onBackupStatus, isBackupRunning } from './autobackup.js'

export function openAutoBackupDialog() {
  const cfg = settings.autoBackup
  const body = h('div', { class: 'backup-dialog' })
  let offStatus = null

  const render = () => {
    body.replaceChildren()
    if (!autoBackupSupported) {
      body.append(h('p', { class: 'muted' }, 'Automatic backup is available in the Android app. Here in the browser, use “Full backup”.'))
      return
    }
    body.append(
      toggle('Automatic backup on', cfg.enabled, (v) => {
        cfg.enabled = v
        saveSettings()
        render()
      })
    )
    if (!cfg.enabled) {
      body.append(h('p', { class: 'muted small' }, 'Without a backup, your notebooks are lost if the tablet breaks or you uninstall the app.'))
      return
    }
    body.append(
      h('div', { class: 'pop-title' }, 'When'),
      segmented(
        FREQUENCIES.map((f) => ({ value: f.value, label: f.label, text: f.label })),
        cfg.frequency,
        (v) => {
          cfg.frequency = v
          saveSettings()
        }
      ),
      h('p', { class: 'muted small' }, 'A backup runs only if you changed something since the last one.'),
      h('div', { class: 'pop-title' }, 'Where')
    )

    const option = (value, ic, title, desc, extra) => {
      const card = h(
        'div',
        { class: 'dest-card' + (cfg.target === value ? ' active' : '') },
        h('span', { class: 'dest-ic' }, icon(ic, 22)),
        h('div', { class: 'dest-text' }, h('b', null, title), h('span', { class: 'muted small' }, desc), extra)
      )
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        if (value === 'drive' && !cfg.uri) return choose()
        cfg.target = value
        cfg.lastSig = ''
        saveSettings()
        render()
      })
      return card
    }
    const choose = async () => {
      try {
        await pickDriveTarget()
        toast('Destination saved: backing up now')
        render()
        backupNow()
      } catch (e) {
        if (e?.message !== 'cancelled') toast('That file cannot be used')
      }
    }
    const driveExtra = h(
      'div',
      { class: 'dest-extra' },
      cfg.uri ? h('span', { class: 'dest-file' }, icon('file', 16), cfg.label || 'Chosen file') : null,
      h('button', { class: 'btn small-btn', onclick: choose }, cfg.uri ? 'Change' : 'Choose on Drive…')
    )
    body.append(
      option(
        'drive',
        'backup',
        'Google Drive (or another app)',
        'The file picker opens: tap ☰ → Drive, choose a folder and tap Save. The file is updated on every backup.',
        driveExtra
      ),
      option('device', 'folder', 'Tablet storage', `Documents/TakeNote/Backup, latest ${cfg.keep || 5} copies. Does not protect you if you lose the tablet.`)
    )

    const status = h('div', { class: 'backup-status' })
    const paintStatus = (running) => {
      status.className = 'backup-status' + (cfg.lastError && !running ? ' error' : '')
      if (running) status.textContent = 'Backing up…'
      else if (cfg.lastError) status.textContent = `Last attempt failed: ${cfg.lastError}`
      else if (cfg.lastAt) status.textContent = `Last backup: ${formatDate(cfg.lastAt)}`
      else status.textContent = 'No backup yet.'
    }
    paintStatus(isBackupRunning())
    offStatus?.()
    offStatus = onBackupStatus((s) => paintStatus(s.state === 'running'))
    body.append(status)
  }

  const backupNow = async () => {
    const prog = progressDialog('Backing up')
    const ok = await runBackup({ onProgress: (f) => prog.set(f) })
    prog.close()
    toast(ok ? 'Backup complete' : 'Backup failed: ' + settings.autoBackup.lastError, 3500)
    render()
  }

  render()
  openDialog({
    title: 'Automatic backup',
    className: 'wide',
    body,
    actions: autoBackupSupported ? [{ label: 'Run now', onClick: () => (backupNow(), false) }, { label: 'Close', primary: true }] : [{ label: 'Close', primary: true }],
    onClose: () => offStatus?.(),
  })
}

// Small indicator in the library bar (running / done / error).
export function backupStatusChip() {
  const chip = h('button', { class: 'backup-chip', title: 'Automatic backup', onclick: () => openAutoBackupDialog() })
  let hideTimer = 0
  const show = (cls, text) => {
    chip.className = 'backup-chip show ' + cls
    chip.replaceChildren(icon('backup', 16), h('span', null, text))
  }
  const paint = (s) => {
    clearTimeout(hideTimer)
    if (s?.state === 'running' || (!s && isBackupRunning())) show('running', 'Backup…')
    else if (s?.state === 'done') {
      show('done', 'Backup done')
      hideTimer = setTimeout(() => (chip.className = 'backup-chip'), 3000)
    } else if (s?.state === 'error' || settings.autoBackup.lastError) show('error', 'Backup failed')
    else chip.className = 'backup-chip'
  }
  paint(null)
  const off = onBackupStatus(paint)
  chip.destroy = () => {
    off()
    clearTimeout(hideTimer)
  }
  return chip
}
