# uniTerm Win7 legacy host

Electron 22 window + standalone Go sidecar. This tree is the Windows 7 target;
the Wails build lives in the original project.

## Status

Working end to end on a current Windows machine:

- The real Vue frontend builds with `vite.win7.config.ts` (Chromium 108 target).
- Generated bindings call the Go sidecar through the `@wailsio/runtime` shim.
- The sidecar starts, initializes its stores under the host's `userData/data`,
  answers RPC calls, and streams events (`session:data`, `store:*`, …).
- File pickers run in Electron; content pickers validate through Go.
- Verified on this machine: UI renders, `LoadConnections` / `GetAppInfo` /
  `SaveFavoriteConnections` / `SaveConnections` / `SaveSettings` round-trip,
  `store:favorites:changed` events arrive in the renderer.
- Verified packaged: `dist/win-unpacked` starts, finds the sidecar in
  `resources/backend`, and the portable `dist/uniTerm-Win7-0.1.0-x64.exe`
  is produced.

Renderer-to-backend arguments are normalised with a JSON round-trip in
`Call.ByName`: the context bridge uses structured clone, which rejects Vue
reactive proxies. Wails' own transport was JSON, so shapes are unchanged.

Still required:

- Windows 7 SP1 x64 VM acceptance (Electron 22 startup, TLS/SSH, xterm
  rendering, input methods, fonts, clipboard).
- Local terminal on Win7 uses winpty; still needs VM acceptance for IME,
  Ctrl+C, resize and Git Bash.
- Administrator terminals stay ConPTY-only (deferred): on Win7 they return an
  unsupported error instead of opening.
- Feature audit on the legacy toolchain: SMB named pipes, mosh, serial, RDP
  child-window embedding. RDP finds the host window by title ("uniTerm"), so a
  Wails build running at the same time can be picked instead.
- Electron 22 and Windows 7 are both end-of-life. Treat this as a legacy
  target and do not store production credentials until it is validated.

## Build

Prerequisites: Node.js 22+ on the build machine, network access for npm and Go
modules, and [go-legacy-win7](https://github.com/thongtech/go-legacy-win7)
(Go 1.21+ stamps a Windows 10 minimum into the PE image).

```powershell
cd frontend
npm ci

cd ..\legacy\win7
npm install

# GO_LEGACY_WIN7 defaults to <repo>/../../go-legacy-win7
npm run build:backend
npm run pack:win7
```

`prepare:app` regenerates `frontend/bindings`, builds the Win7 frontend to
`frontend/dist-win7`, and copies it to `legacy/win7/app`. Run the app without
packaging with `npm start`.

Output in `legacy/win7/dist/`:

- `uniTerm-Win7-<version>-x64.zip` — no-install build: `uniTerm Win7 Legacy.exe`,
  Chromium DLLs/locales and `resources/backend/uniterm-win7-backend.exe`.
- `uniTerm-Win7-<version>-x64.exe` — single-file portable launcher (self-extracts
  to a temp folder; slower first start).

## Layout

- `electron/main.cjs` — window, IPC, native dialogs, sidecar lifecycle
- `electron/rpc-client.cjs` — newline-delimited JSON transport
- `electron/preload.cjs` — `window.go` compatibility surface + bridge
- `electron/app-methods.cjs` — generated allowlist (method names only)
- `scripts/generate-bindings.cjs` — writes `frontend/bindings` from the Go
  `*App` method set; replaces `wails3 generate bindings`
- `scripts/build-backend.cjs` — builds the sidecar with the legacy toolchain
- `backend/` — the sidecar binary, winpty runtime (`winpty.dll`,
  `winpty-agent.exe`) and protocol notes

## Local terminal backends

`backend/session/local_session_windows.go` picks the first available backend:

1. **ConPTY** — Windows 10 1809+ (the existing path).
2. **winpty** — Windows 7/8; ships next to the sidecar. Read, write and resize
   all work. `UNITERM_FORCE_WINPTY=1` forces this path on Windows 10+ for
   testing.
3. **Pipes** — last resort when the DLL/agent is missing; no resize and no
   real console.

Administrator terminals (`admin://`) still go through the ConPTY broker and are
not winpty-backed yet.

## Isolation from the Wails build

- Different app ID, `productName`, and `%APPDATA%\uniTerm-Win7-Legacy` data dir.
- The sidecar is always started with `--data-dir`; it never resolves the
  production `%APPDATA%\uniTerm` stores. `SetDataDir` is refused while the host
  pins the path: the launcher re-passes it on every start, and writing a
  bootstrap pointer would redirect the Wails build.
- Sync metadata (`sync-config.json`, `sync-repo`) lives in `<data-dir>/sync`
  instead of the shared `%APPDATA%\uniTerm`.
- `frontend/dist` and the Wails build config are not touched.