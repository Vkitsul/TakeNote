// Archivio locale su IndexedDB: quaderni, pagine, file (PDF/immagini), snip, cartelle, impostazioni.

const DB_NAME = 'takenote'
const VERSION = 1
let dbPromise = null

export function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('pages')) {
        const s = db.createObjectStore('pages', { keyPath: 'id' })
        s.createIndex('notebookId', 'notebookId')
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('snips')) db.createObjectStore('snips', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

export async function get(store, key) {
  const db = await openDB()
  return wrap(db.transaction(store).objectStore(store).get(key))
}

export async function all(store) {
  const db = await openDB()
  return wrap(db.transaction(store).objectStore(store).getAll())
}

export async function byIndex(store, index, value) {
  const db = await openDB()
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(value))
}

export async function put(store, value) {
  const db = await openDB()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value)
  return done(tx)
}

export async function putMany(store, values) {
  if (!values.length) return
  const db = await openDB()
  const tx = db.transaction(store, 'readwrite')
  const s = tx.objectStore(store)
  for (const v of values) s.put(v)
  return done(tx)
}

export async function del(store, key) {
  const db = await openDB()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  return done(tx)
}

export async function delMany(store, keys) {
  if (!keys.length) return
  const db = await openDB()
  const tx = db.transaction(store, 'readwrite')
  const s = tx.objectStore(store)
  for (const k of keys) s.delete(k)
  return done(tx)
}

// Scrive in più store con una sola transazione: ops = [{store, put?: value, del?: key}]
export async function batch(ops) {
  if (!ops.length) return
  const stores = [...new Set(ops.map((o) => o.store))]
  const db = await openDB()
  const tx = db.transaction(stores, 'readwrite')
  for (const o of ops) {
    const s = tx.objectStore(o.store)
    if (o.put !== undefined) s.put(o.put)
    if (o.del !== undefined) s.delete(o.del)
  }
  return done(tx)
}

export async function allKeys(store) {
  const db = await openDB()
  return wrap(db.transaction(store).objectStore(store).getAllKeys())
}
