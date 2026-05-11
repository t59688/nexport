import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const version = process.argv[2]?.trim()

if (!version) {
  console.error('Usage: npm run version:sync -- <version>')
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid version: ${version}`)
  process.exit(1)
}

const root = process.cwd()

const packageJsonPath = path.join(root, 'package.json')
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml')
const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json')

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
packageJson.version = version
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8').replace(
  /^version = ".*"$/m,
  `version = "${version}"`,
)
fs.writeFileSync(cargoTomlPath, cargoToml, 'utf8')

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'))
tauriConfig.version = version
fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8')

console.log(`Synced version to ${version}`)
