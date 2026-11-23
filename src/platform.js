// Android (Capacitor) or browser integration: sharing/saving files, back button.
import { Capacitor } from '@capacitor/core'
import { blobToBase64 } from './util.js'

export const isNative = Capacitor.isNativePlatform()

async function nativeWrite(blob, filename, directory) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const data = await blobToBase64(blob)
  const res = await Filesystem.writeFile({ path: filename, data, directory: Directory[directory], recursive: true })
  return res.uri
}

// Opens the Android share sheet (Drive, Files, email...) or downloads the file in the browser.
export async function shareFile(blob, filename, title = filename) {
  if (isNative) {
    const uri = await nativeWrite(blob, filename, 'Cache')
    const { Share } = await import('@capacitor/share')
    await Share.share({ title, files: [uri], dialogTitle: title })
    return 'shared'
  }
  const file = new File([blob], filename, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled'
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

// Shares a file the app already wrote (file:// uri) without loading it into memory.
export async function shareUri(uri, title) {
  const { Share } = await import('@capacitor/share')
  await Share.share({ title, files: [uri], dialogTitle: title })
}

// Saves straight to Documents/TakeNote (Android) or downloads it (browser).
export async function saveFile(blob, filename) {
  if (isNative) {
    await nativeWrite(blob, 'TakeNote/' + filename, 'Documents')
    return 'Documents/TakeNote/' + filename
  }
  downloadBlob(blob, filename)
  return filename
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// Native file picker (hidden file input).
export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    input.addEventListener('change', () => {
      resolve(multiple ? [...input.files] : input.files[0] || null)
      input.remove()
    })
    document.body.append(input)
    input.click()
  })
}

const backHandlers = []
export function onBack(fn) {
  backHandlers.push(fn)
  return () => {
    const i = backHandlers.indexOf(fn)
    if (i >= 0) backHandlers.splice(i, 1)
  }
}

export async function initPlatform() {
  if (!isNative) return
  const { App } = await import('@capacitor/app')
  App.addListener('backButton', () => {
    for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return
    App.minimizeApp()
  })
  App.addListener('pause', () => window.dispatchEvent(new Event('app-pause')))
}

export function safeFileName(name) {
  return (name || 'notebook').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'notebook'
}
