/**
 * Narrow Wails-v3 runtime compatibility layer for the Electron 22 Win7 host.
 *
 * This replaces only the frontend runtime primitives actually imported by
 * uniTerm today. The backend methods still require the separate Go RPC adapter
 * documented in legacy/win7/backend/README.md.
 */

type EventEnvelope<T = unknown> = { data: T }
type WindowPosition = { x: number; y: number }
type WindowSize = { width: number; height: number }
type Win7Bridge = {
  eventsOn: (name: string, callback: (payload: unknown) => void) => number
  eventsOff: (id: number) => void
  eventsOffName: (names: string[]) => void
  invokeRuntime: (action: string, args?: unknown[]) => Promise<any>
  invokeApp: (name: string, args?: unknown[]) => Promise<any>
}

declare global {
  interface Window {
    win7Bridge: Win7Bridge
  }
}

const invoke = (action: string, ...args: unknown[]) => window.win7Bridge.invokeRuntime(action, args)

// The context bridge clones arguments before the preload sees them, and Vue
// reactive proxies are not cloneable. Wails sent JSON, so normalise here.
const plain = (args: unknown[]) => JSON.parse(JSON.stringify(args))

// Call is what the generated bindings use to reach the Go sidecar.
export const Call = {
  ByName(name: string, ...args: unknown[]): Promise<any> {
    return window.win7Bridge.invokeApp(name, plain(args))
  },
  ByID(id: number, ...args: unknown[]): Promise<any> {
    return window.win7Bridge.invokeApp(String(id), plain(args))
  }
}

// Generated bindings type their return values as CancellablePromise and run
// results through Create. The sidecar returns plain JSON and has no per-call
// cancel yet; both keep the generated call sites working.
export class CancellablePromise<T> extends Promise<T> {
  cancel(): void { /* no-op until the RPC grows a cancel frame */ }
}

const identityCreate = (...args: unknown[]) => args[args.length - 1]
export const Create: any = new Proxy({}, { get: () => identityCreate })

export const Events = {
  On<T = unknown>(name: string, callback: (event: EventEnvelope<T>) => void): () => void {
    const id = window.win7Bridge.eventsOn(name, payload => callback({ data: payload as T }))
    return () => window.win7Bridge.eventsOff(id)
  },
  Off(...names: string[]): void {
    window.win7Bridge.eventsOffName(names)
  }
}

export const Clipboard = {
  Text(): Promise<string> {
    return invoke('clipboard.read')
  },
  SetText(text: string): Promise<boolean> {
    return invoke('clipboard.write', text)
  }
}

export const Browser = {
  OpenURL(url: string): Promise<void> {
    return invoke('browser.openURL', url)
  }
}

export const Application = {
  Quit(): void {
    void invoke('application.quit')
  }
}

export const Window = {
  SetTitle(title: string): void { void invoke('window.setTitle', title) },
  IsMaximised(): Promise<boolean> { return invoke('window.isMaximised') },
  IsMinimised(): Promise<boolean> { return invoke('window.isMinimised') },
  Maximise(): void { void invoke('window.maximise') },
  Minimise(): void { void invoke('window.minimise') },
  ToggleMaximise(): void { void invoke('window.toggleMaximise') },
  UnMaximise(): void { void invoke('window.unMaximise') },
  Position(): Promise<WindowPosition> { return invoke('window.position') },
  Size(): Promise<WindowSize> { return invoke('window.size') },
  SetMaxSize(width: number, height: number): void { void invoke('window.setMaxSize', width, height) }
}

export const System = {
  Environment(): Promise<{ OS: string; Arch: string }> { return invoke('system.environment') }
}

export const Screens = {
  GetAll(): Promise<Array<{ isCurrent: boolean; Size: { Width: number; Height: number } }>> {
    return invoke('screens.getAll')
  }
}
