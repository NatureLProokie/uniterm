// Builds the sidecar with go-legacy-win7 (the only toolchain whose PE header
// still targets Windows 7). GO_LEGACY_WIN7 overrides its location.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const repoRoot = path.resolve(root, '../..')
const goRoot = process.env.GO_LEGACY_WIN7 || path.resolve(repoRoot, '../../go-legacy-win7')
const go = path.join(goRoot, 'bin', process.platform === 'win32' ? 'go.exe' : 'go')
const out = path.join(root, 'backend', 'uniterm-win7-backend.exe')

if (!fs.existsSync(go)) {
  console.error(`Win7 Go toolchain not found at ${goRoot}. Set GO_LEGACY_WIN7 to its folder.`)
  process.exit(1)
}

// Stamp the packaged version so About/GetAppInfo do not report "dev".
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const result = spawnSync(go, ['build', '-trimpath', '-ldflags', `-s -w -X main.Version=${pkg.version}`, '-o', out, '.'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, GOTOOLCHAIN: 'local', GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
console.log(`Built ${out}`)