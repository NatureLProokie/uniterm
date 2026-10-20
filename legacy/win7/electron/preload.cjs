const { contextBridge, ipcRenderer } = require('electron')
const appMethodNames = require('./app-methods.cjs')

// IPC uses structured clone, which rejects Vue reactive proxies. The Wails
// bridge was JSON over the wire, so round-tripping here keeps the same shapes.
const plain = args => JSON.parse(JSON.stringify(args))

const appBindings = Object.create(null)
for (const method of appMethodNames) {
  appBindings[method] = (...args) => ipcRenderer.invoke('win7:app-invoke', method, plain(args))
}

let nextListenerId = 1
const listeners = new Map()
const eventHandler = (_event, name, payload) => {
  for (const entry of listeners.values()) {
    if (entry.name === name) {
      try { entry.callback(payload) } catch (error) { console.error('Win7 event listener failed', error) }
    }
  }
}
ipcRenderer.on('win7:event', eventHandler)

contextBridge.exposeInMainWorld('go', { main: { App: appBindings } })
contextBridge.exposeInMainWorld('win7Bridge', {
  invokeRuntime: (action, args = []) => ipcRenderer.invoke('win7:runtime', action, args),
  invokeApp: (name, args = []) => ipcRenderer.invoke('win7:app-invoke', name, plain(args)),
  eventsOn: (name, callback) => {
    const id = nextListenerId++
    listeners.set(id, { name, callback })
    return id
  },
  eventsOff: (id) => { listeners.delete(id) },
  eventsOffName: (names) => {
    const targetNames = new Set(names)
    for (const [id, entry] of listeners) {
      if (targetNames.has(entry.name)) listeners.delete(id)
    }
  }
})
