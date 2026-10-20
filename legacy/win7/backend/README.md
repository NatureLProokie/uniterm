# Win7 Go backend sidecar

`uniterm-win7-backend.exe` runs the uniTerm backend without Wails. The
Electron host owns the window and spawns this process with `--rpc=stdio`.

- Development: `legacy/win7/backend/uniterm-win7-backend.exe`
- Packaged app: `<resources>/backend/uniterm-win7-backend.exe`

## Build

The binary must be built with [go-legacy-win7](https://github.com/thongtech/go-legacy-win7),
the only Go toolchain whose PE header still targets Windows 7. Stock Go 1.21+
stamps a Windows 10 minimum into the image and will not start on Win7.

```powershell
# toolchain expected at ../../go-legacy-win7 relative to the repo root
npm run build:backend
# or point at it explicitly
$env:GO_LEGACY_WIN7 = 'C:\go-legacy-win7'
npm run build:backend
```

Then verify the PE header stamps 6.1 (Windows 7), not 10.0:

```powershell
node -e "const b=require('fs').readFileSync('backend/uniterm-win7-backend.exe');const o=b.readUInt32LE(0x3c);console.log(b.readUInt16LE(o+64), b.readUInt16LE(o+66))"
# 6 1
```

## Protocol

Newline-delimited JSON on stdin/stdout. stdout carries protocol frames only;
logs and other prints are redirected to stderr.

Request:

```json
{"type":"request","id":1,"method":"LoadConnections","args":[]}
```

Success:

```json
{"type":"response","id":1,"result":{"groups":[],"connections":[]}}
```

Error:

```json
{"type":"error","id":1,"error":"human-readable message"}
```

Event (server initiated):

```json
{"type":"event","event":"session:data","data":{"id":"...","data":"..."}}
```

Method names match the exported `*App` methods; the host may send the Wails
form (`main.App.LoadConnections`) and the sidecar uses the last segment.
Requests are dispatched concurrently; results may arrive out of order, so the
host matches them by `id`.

## Startup

```text
uniterm-win7-backend.exe --rpc=stdio --data-dir=<config dir>
```

`--data-dir` is required in practice: the Electron host passes its own
`userData/data`, so the sidecar never reads or writes the Wails build's
`%APPDATA%\uniTerm` stores. Without the flag the old bootstrap resolution runs
and may land on the production config directory. The log and the sync metadata
(`<data-dir>/sync`) move into that directory, and `SetDataDir` is refused while
the flag is in use — the host re-passes the same path on every start.

Update checks are disabled in this build (`CheckForUpdate` reports no update,
`DownloadUpdate`/`ApplyUpdate` refuse): updates belong to the Electron package.

## Local terminal

`winpty.dll` and `winpty-agent.exe` (winpty 0.4.3, msvc2015 x64, MIT) must sit
next to the sidecar; the sidecar looks in its own directory. Windows 10+ uses
ConPTY and never loads them. `UNITERM_FORCE_WINPTY=1` forces the winpty path for
testing. License text: `winpty-LICENSE.txt`.

## What the host handles instead

- Window, tray, menus, global hotkeys
- File pickers (`OpenFileDialog*`, `SaveFileDialog*`). The two content pickers
  (`OpenPrivateKeyFile`, `OpenKubeconfigFile`) ask the host for a path, then
  call `ReadPrivateKeyFile` / `ReadKubeconfigFile` so validation stays in Go.
- System notifications for MCP approvals (the sidecar only logs them)
- Update download/apply (`ApplyUpdate` still exits; packaging is Electron's)