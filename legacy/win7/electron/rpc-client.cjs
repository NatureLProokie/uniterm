const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const fs = require('node:fs')

/**
 * JSON-lines transport for the future standalone Go backend.
 *
 * Request:  {"type":"request","id":1,"method":"LoadConnections","args":[]}
 * Response: {"type":"response","id":1,"result":{...}}
 * Error:    {"type":"error","id":1,"error":"message"}
 * Event:    {"type":"event","event":"session:data","data":{...}}
 *
 * stdout is protocol-only; diagnostics must be written to stderr by the Go
 * sidecar. This class intentionally fails loudly if the sidecar is absent.
 */
class BackendClient extends EventEmitter {
  constructor(executablePath, extraArgs = []) {
    super()
    this.executablePath = executablePath
    this.extraArgs = extraArgs
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.stopping = false
  }

  start() {
    if (this.child || !fs.existsSync(this.executablePath)) {
      if (!fs.existsSync(this.executablePath)) {
        this.emit('stderr', `RPC backend not found: ${this.executablePath}`)
      }
      return false
    }
    this.stopping = false
    const child = spawn(this.executablePath, ['--rpc=stdio', ...this.extraArgs], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    const stdout = readline.createInterface({ input: child.stdout })
    stdout.on('line', line => this.#onLine(line))
    const stderr = readline.createInterface({ input: child.stderr })
    stderr.on('line', line => this.emit('stderr', line))
    child.on('error', error => this.#failAll(new Error(`Unable to start Go backend: ${error.message}`)))
    child.on('exit', (code, signal) => {
      this.child = null
      this.#failAll(new Error(`Go backend exited (code=${code}, signal=${signal || 'none'})`))
      this.emit('exit', { code, signal })
    })
    return true
  }

  invoke(method, args) {
    if (!this.child || !this.child.stdin.writable) {
      const error = new Error(
        `Win7 Go backend is not installed. Missing executable: ${this.executablePath}. ` +
        'The Electron shell is only a prototype; SSH/SFTP and other backend features are not available yet.'
      )
      error.code = 'WIN7_BACKEND_MISSING'
      return Promise.reject(error)
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      const message = JSON.stringify({ type: 'request', id, method, args }) + '\n'
      this.child.stdin.write(message, error => {
        if (!error) return
        const pending = this.pending.get(id)
        if (pending) {
          this.pending.delete(id)
          pending.reject(error)
        }
      })
    })
  }

  #onLine(line) {
    if (!line.trim()) return
    let message
    try { message = JSON.parse(line) } catch (error) {
      this.emit('stderr', `Ignoring non-JSON backend stdout: ${line.slice(0, 300)}`)
      return
    }
    if (message.type === 'event' && typeof message.event === 'string') {
      this.emit('event', { name: message.event, data: message.data })
      return
    }
    if (message.type !== 'response' && message.type !== 'error') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.type === 'error') pending.reject(new Error(String(message.error || `Backend method ${pending.method} failed`)))
    else pending.resolve(message.result)
  }

  #failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  stop() {
    this.stopping = true
    const child = this.child
    this.child = null
    this.#failAll(new Error('Go backend stopped'))
    if (!child || child.killed) return
    // Closing stdin lets the sidecar run App.shutdown (flush terminal history
    // and output logs) instead of dying mid-write. Kill only if it hangs.
    child.stdin.on('error', () => {}) // EPIPE when the sidecar already exited
    child.stdin.end()
    const timer = setTimeout(() => { if (!child.killed) child.kill() }, 5000)
    timer.unref()
    child.once('exit', () => clearTimeout(timer))
  }
}

module.exports = { BackendClient }
