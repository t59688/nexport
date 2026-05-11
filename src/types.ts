export type AuthMethod = 'password' | 'private_key'
export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error' | 'stopping'
export type HostKeyStatus = 'skipped' | 'trusted' | 'unknown' | 'mismatch'
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'
export type ImportMode = 'merge' | 'replace'
export type PortInput = number | ''

export interface TunnelRecord {
  id: string
  name: string
  bindAddress: string
  localPort: number
  targetHost: string
  targetPort: number
  sshHost: string
  sshPort: number
  sshUser: string
  authMethod: AuthMethod
  password?: string | null
  privateKeyPath?: string | null
  privateKeyPassphrase?: string | null
  autoStart: boolean
  skipHostKeyCheck: boolean
  note?: string | null
  status: TunnelStatus
  statusMessage: string
  activeConnections: number
  startedAt?: string | null
  lastError?: string | null
}

export interface AppSettings {
  closeToTray: boolean
  launchOnStartup: boolean
}

export interface LogEntry {
  id: string
  level: LogLevel
  scope: string
  message: string
  timestamp: string
}

export interface TrustedHost {
  key: string
  host: string
  port: number
  algorithm: string
  fingerprint: string
  trustedAt: string
  note?: string | null
}

export interface AppSnapshot {
  tunnels: TunnelRecord[]
  settings: AppSettings
  logs: LogEntry[]
  trustedHosts: TrustedHost[]
}

export interface TunnelForm {
  id?: string | null
  name: string
  bindAddress: string
  localPort: PortInput
  targetHost: string
  targetPort: PortInput
  sshHost: string
  sshPort: PortInput
  sshUser: string
  authMethod: AuthMethod
  password?: string | null
  privateKeyPath?: string | null
  privateKeyPassphrase?: string | null
  autoStart: boolean
  skipHostKeyCheck: boolean
  note?: string | null
}

export interface TunnelPayload extends Omit<TunnelForm, 'localPort' | 'targetPort' | 'sshPort'> {
  localPort: number
  targetPort: number
  sshPort: number
}

export interface TunnelTestResult {
  hostKeyStatus: HostKeyStatus
  portAvailable: boolean
  portMessage: string
  sshReachable: boolean
  authOk: boolean
  targetReachable: boolean
  message: string
  fingerprint?: string | null
  expectedFingerprint?: string | null
  algorithm?: string | null
}

export interface TrustHostPayload {
  host: string
  port: number
  algorithm: string
  fingerprint: string
  note?: string | null
}

export interface ExportResult {
  path: string
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion?: string | null
  releaseUrl: string
  publishedAt?: string | null
  hasUpdate: boolean
  dismissed: boolean
  checkedAt: string
}
