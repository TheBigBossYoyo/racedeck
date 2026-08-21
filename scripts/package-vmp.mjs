import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const appOutDir = resolve(root, 'release', packageJson.version, 'win-unpacked')
const builderCli = resolve(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const env = { ...process.env, EVS_NO_ASK: '1' }
const hasCodeSigningIdentity = Boolean(
  process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.CSC_NAME
)
const builderOverrides = hasCodeSigningIdentity
  ? []
  : ['--config.win.signAndEditExecutable=false']

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function runBuilder(args) {
  run(process.execPath, [builderCli, ...args])
}

function runEvs(args) {
  const configured = process.env.PYTHON ? [[process.env.PYTHON, []]] : []
  const candidates = [
    ...configured,
    ['py', ['-3']],
    ['python', []]
  ]
  for (const [command, prefix] of candidates) {
    const result = spawnSync(
      command,
      [...prefix, '-m', 'castlabs_evs.vmp', '--no-ask', ...args],
      { cwd: root, env, stdio: 'inherit' }
    )
    if (result.error?.code === 'ENOENT') continue
    if (result.error) throw result.error
    if (result.status === 0) return
    throw new Error(`castLabs EVS failed with exit code ${result.status ?? 'unknown'}`)
  }
  throw new Error('Python 3 was not found. Install Python 3.7+ and castlabs-evs==1.3.2 first.')
}

// Windows ordering is deliberate: package/code-sign the executable first,
// apply and verify VMP second, then wrap that exact directory in the installer.
runBuilder(['--win', '--dir', ...builderOverrides])
runEvs(['sign-pkg', '--streaming', appOutDir])
runEvs(['verify-pkg', '--streaming', appOutDir])
runBuilder(['--win', 'nsis', '--prepackaged', appOutDir, ...builderOverrides])
