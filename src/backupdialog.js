// Schermata "Backup automatico" e indicatore di stato nella libreria.
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
      body.append(h('p', { class: 'muted' }, 'Il backup automatico è disponibile nell’app Android. Qui nel browser usa “Backup completo”.'))
      return
    }
    body.append(
      toggle('Backup automatico attivo', cfg.enabled, (v) => {
        cfg.enabled = v
        saveSettings()
        render()
      })
    )
    if (!cfg.enabled) {
      body.append(h('p', { class: 'muted small' }, 'Senza backup, se il tablet si rompe o disinstalli l’app i quaderni vanno persi.'))
      return
    }
    body.append(
      h('div', { class: 'pop-title' }, 'Quando'),
      segmented(
        FREQUENCIES.map((f) => ({ value: f.value, label: f.label, text: f.label })),
        cfg.frequency,
        (v) => {
          cfg.frequency = v
          saveSettings()
        }
      ),
      h('p', { class: 'muted small' }, 'Il backup parte solo se hai modificato qualcosa dall’ultima volta.'),
      h('div', { class: 'pop-title' }, 'Dove')
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
        toast('Destinazione salvata: faccio subito un backup')
        render()
        backupNow()
      } catch (e) {
        if (e?.message !== 'cancelled') toast('Impossibile usare quel file')
      }
    }
    const driveExtra = h(
      'div',
      { class: 'dest-extra' },
      cfg.uri ? h('span', { class: 'dest-file' }, icon('file', 16), cfg.label || 'File scelto') : null,
      h('button', { class: 'btn small-btn', onclick: choose }, cfg.uri ? 'Cambia' : 'Scegli su Drive…')
    )
    body.append(
      option(
        'drive',
        'backup',
        'Google Drive (o un’altra app)',
        'Si apre il selettore file: tocca ☰ → Drive, scegli una cartella e Salva. Il file viene aggiornato a ogni backup.',
        driveExtra
      ),
      option('device', 'folder', 'Memoria del tablet', `Documenti/TakeNote/Backup, ultime ${cfg.keep || 5} copie. Non protegge se perdi il tablet.`)
    )

    const status = h('div', { class: 'backup-status' })
    const paintStatus = (running) => {
      status.className = 'backup-status' + (cfg.lastError && !running ? ' error' : '')
      if (running) status.textContent = 'Backup in corso…'
      else if (cfg.lastError) status.textContent = `Ultimo tentativo non riuscito: ${cfg.lastError}`
      else if (cfg.lastAt) status.textContent = `Ultimo backup: ${formatDate(cfg.lastAt)}`
      else status.textContent = 'Nessun backup ancora eseguito.'
    }
    paintStatus(isBackupRunning())
    offStatus?.()
    offStatus = onBackupStatus((s) => paintStatus(s.state === 'running'))
    body.append(status)
  }

  const backupNow = async () => {
    const prog = progressDialog('Backup in corso')
    const ok = await runBackup({ onProgress: (f) => prog.set(f) })
    prog.close()
    toast(ok ? 'Backup completato' : 'Backup non riuscito: ' + settings.autoBackup.lastError, 3500)
    render()
  }

  render()
  openDialog({
    title: 'Backup automatico',
    className: 'wide',
    body,
    actions: autoBackupSupported ? [{ label: 'Esegui ora', onClick: () => (backupNow(), false) }, { label: 'Chiudi', primary: true }] : [{ label: 'Chiudi', primary: true }],
    onClose: () => offStatus?.(),
  })
}

// Piccolo indicatore nella barra della libreria (in corso / completato / errore).
export function backupStatusChip() {
  const chip = h('button', { class: 'backup-chip', title: 'Backup automatico', onclick: () => openAutoBackupDialog() })
  let hideTimer = 0
  const show = (cls, text) => {
    chip.className = 'backup-chip show ' + cls
    chip.replaceChildren(icon('backup', 16), h('span', null, text))
  }
  const paint = (s) => {
    clearTimeout(hideTimer)
    if (s?.state === 'running' || (!s && isBackupRunning())) show('running', 'Backup…')
    else if (s?.state === 'done') {
      show('done', 'Backup fatto')
      hideTimer = setTimeout(() => (chip.className = 'backup-chip'), 3000)
    } else if (s?.state === 'error' || settings.autoBackup.lastError) show('error', 'Backup non riuscito')
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
