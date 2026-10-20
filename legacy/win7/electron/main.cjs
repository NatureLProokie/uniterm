const { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const { BackendClient } = require('./rpc-client.cjs')

// Two instances would run two sidecars against the same JSON stores.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const appRoot = path.resolve(__dirname, '..')
const backendPath = app.isPackaged
  ? path.join(process.resourcesPath, 'backend', 'uniterm-win7-backend.exe')
  : path.join(appRoot, 'backend', 'uniterm-win7-backend.exe')
let mainWindow

// Keep this prototype's configuration separate from the regular Wails build.
app.setName('uniTerm Win7 Legacy')
app.setPath('userData', path.join(app.getPath('appData'), 'uniTerm-Win7-Legacy'))

// The sidecar resolves nothing on its own: it writes stores under this dir,
// never the Wails build's %APPDATA%\uniTerm.
const backend = new BackendClient(backendPath, ['--data-dir', path.join(app.getPath('userData'), 'data')])

function sendBackendEvent(name, data) {
  if (name === 'app:relaunch') {
    app.relaunch()
    app.quit()
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('win7:event', name, data)
}
backend.on('event', ({ name, data }) => sendBackendEvent(name, data))
backend.on('stderr', line => console.error(`[uniTerm Win7 backend] ${line}`))
backend.on('exit', info => console.error('[uniTerm Win7 backend exited]', info))

function getWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('uniTerm main window is not available')
  return mainWindow
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#101319',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep a Node-capable preload so it can load the generated allowlist.
      // Renderer Node integration remains disabled and context isolation stays on.
      sandbox: false,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = undefined })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl.startsWith('file://')) {
      try {
        const targetPath = path.resolve(fileURLToPath(targetUrl))
        const uiRoot = path.resolve(appRoot, 'app')
        if (targetPath === path.join(uiRoot, 'index.html') || targetPath.startsWith(uiRoot + path.sep)) return
      } catch { /* malformed file URLs are blocked below */ }
      event.preventDefault()
      return
    }
    event.preventDefault()
    void openExternal(targetUrl)
  })

  const indexFile = path.join(appRoot, 'app', 'index.html')
  if (!fs.existsSync(indexFile)) {
    dialog.showErrorBox('uniTerm Win7 prototype', `Built frontend not found:\n${indexFile}\n\nRun: npm run prepare:app`)
    app.quit()
    return
  }
  void mainWindow.loadFile(indexFile)
}

async function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only HTTP and HTTPS links can be opened externally')
    await shell.openExternal(url.toString())
  } catch (error) {
    console.warn('Blocked external URL:', rawUrl, error.message)
  }
}

function resolveStartDir(startDir) {
  const home = app.getPath('home')
  const raw = String(startDir || '')
  if (!raw) return home
  const expanded = raw === '~' ? home : (raw.startsWith('~/') || raw.startsWith('~\\')) ? path.join(home, raw.slice(2)) : raw
  try {
    return fs.statSync(expanded).isDirectory() ? expanded : home
  } catch {
    return home
  }
}

function extensions(pattern) {
  return String(pattern || '')
    .split(/[;,\s]+/)
    .map(part => part.replace(/^\*\.?/, '').trim())
    .filter(Boolean)
}

// Native pickers live in the Electron main process: the Go sidecar has no
// window. Methods that return file *contents* ask the backend to validate the
// chosen path, so the rules stay in one place.
const dialogMethods = {
  async OpenFileDialog(startDir) {
    const r = await dialog.showOpenDialog(getWindow(), {
      defaultPath: resolveStartDir(startDir),
      properties: ['openFile', 'showHiddenFiles']
    })
    return r.canceled ? '' : (r.filePaths[0] || '')
  },
  async OpenMultipleFilesDialog(startDir) {
    const r = await dialog.showOpenDialog(getWindow(), {
      defaultPath: resolveStartDir(startDir),
      properties: ['openFile', 'multiSelections', 'showHiddenFiles']
    })
    return r.canceled ? [] : r.filePaths
  },
  async OpenDirectoryDialog(startDir) {
    const r = await dialog.showOpenDialog(getWindow(), {
      defaultPath: resolveStartDir(startDir),
      properties: ['openDirectory', 'showHiddenFiles']
    })
    return r.canceled ? '' : (r.filePaths[0] || '')
  },
  async SaveFileDialog(defaultName, startDir) {
    const r = await dialog.showSaveDialog(getWindow(), {
      defaultPath: path.join(resolveStartDir(startDir), String(defaultName || '')),
      properties: ['showHiddenFiles']
    })
    return r.canceled ? '' : (r.filePath || '')
  },
  async OpenFileDialogFiltered(title, filterDisplayName, filterPattern, startDir) {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: String(title || ''),
      defaultPath: resolveStartDir(startDir),
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: String(filterDisplayName || ''), extensions: extensions(filterPattern) }]
    })
    return r.canceled ? '' : (r.filePaths[0] || '')
  },
  async SaveFileDialogFiltered(title, defaultName, filterDisplayName, filterPattern, startDir) {
    const r = await dialog.showSaveDialog(getWindow(), {
      title: String(title || ''),
      defaultPath: path.join(resolveStartDir(startDir), String(defaultName || '')),
      properties: ['showHiddenFiles'],
      filters: [{ name: String(filterDisplayName || ''), extensions: extensions(filterPattern) }]
    })
    return r.canceled ? '' : (r.filePath || '')
  },
  async OpenPrivateKeyFile() {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Select Private Key',
      defaultPath: path.join(os.homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    if (r.canceled || !r.filePaths[0]) return ''
    return backend.invoke('ReadPrivateKeyFile', [r.filePaths[0]])
  },
  async OpenKubeconfigFile() {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Select Kubeconfig',
      defaultPath: path.join(os.homedir(), '.kube'),
      properties: ['openFile', 'showHiddenFiles']
    })
    if (r.canceled || !r.filePaths[0]) return ''
    return backend.invoke('ReadKubeconfigFile', [r.filePaths[0]])
  }
}

ipcMain.handle('win7:app-invoke', async (_event, method, args) => {
  if (typeof method !== 'string' || !Array.isArray(args)) throw new TypeError('Invalid app invocation payload')
  const name = method.split('.').pop()
  const local = dialogMethods[name]
  if (local) return local(...args)
  return backend.invoke(name, args)
})

ipcMain.handle('win7:runtime', async (_event, action, args = []) => {
  const win = () => getWindow()
  switch (action) {
    case 'application.quit': app.quit(); return true
    case 'browser.openURL': return openExternal(String(args[0] || ''))
    case 'clipboard.read': return clipboard.readText()
    case 'clipboard.write': clipboard.writeText(String(args[0] || '')); return true
    case 'window.setTitle': win().setTitle(String(args[0] || 'uniTerm')); return true
    case 'window.isMaximised': return win().isMaximized()
    case 'window.isMinimised': return win().isMinimized()
    case 'window.maximise': win().maximize(); return true
    case 'window.minimise': win().minimize(); return true
    case 'window.toggleMaximise': win().isMaximized() ? win().unmaximize() : win().maximize(); return true
    case 'window.unMaximise': win().unmaximize(); return true
    case 'window.position': { const [x, y] = win().getPosition(); return { x, y } }
    case 'window.size': { const [width, height] = win().getSize(); return { width, height } }
    case 'window.setMaxSize': {
      const width = Math.max(0, Number(args[0]) || 0)
      const height = Math.max(0, Number(args[1]) || 0)
      if (width === 0 || height === 0) win().setMaximumSize(0, 0)
      else win().setMaximumSize(width, height)
      return true
    }
    case 'system.environment': return { OS: 'windows', Arch: process.arch, BuildType: app.isPackaged ? 'production' : 'development' }
    case 'screens.getAll': {
      const current = screen.getDisplayMatching(win().getBounds())
      return screen.getAllDisplays().map(display => ({
        isCurrent: display.id === current.id,
        isPrimary: display.id === screen.getPrimaryDisplay().id,
        Size: { Width: display.size.width, Height: display.size.height },
        WorkArea: { X: display.workArea.x, Y: display.workArea.y, Width: display.workArea.width, Height: display.workArea.height }
      }))
    }
    default: throw new Error(`Unsupported Win7 runtime operation: ${action}`)
  }
})

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(() => {
  backend.start()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch(error => {
  console.error('Unable to start uniTerm Win7 prototype:', error)
  dialog.showErrorBox('uniTerm Win7 prototype', String(error && error.stack || error))
  app.quit()
})

app.on('window-all-closed', () => {
  backend.stop()
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => backend.stop())
