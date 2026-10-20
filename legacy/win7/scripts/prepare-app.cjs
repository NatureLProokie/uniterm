const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { generate } = require('./generate-bindings.cjs')

const root = path.resolve(__dirname, '..')
const repoRoot = path.resolve(root, '../..')
const frontendRoot = path.join(repoRoot, 'frontend')
const frontendBuild = path.join(frontendRoot, 'dist-win7')
const appDir = path.join(root, 'app')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, cwd) {
  // npm is a .cmd shim on Windows; run it through cmd.exe for portability.
  const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : command
  const executableArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', [command, ...args].join(' ')]
    : args
  const result = spawnSync(executable, executableArgs, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

// Bindings must exist before Vite resolves the frontend's imports.
generate()

run(npmCommand, ['run', 'build:win7'], frontendRoot)
if (!fs.existsSync(path.join(frontendBuild, 'index.html'))) {
  throw new Error(`Win7 frontend build did not produce ${path.join(frontendBuild, 'index.html')}`)
}
fs.rmSync(appDir, { recursive: true, force: true })
fs.mkdirSync(appDir, { recursive: true })
fs.cpSync(frontendBuild, appDir, { recursive: true })
console.log('Prepared Win7 UI.')
