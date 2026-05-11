import { invoke } from '@tauri-apps/api/core'
import type {
  AppSettings,
  AppSnapshot,
  ExportResult,
  ImportMode,
  TrustHostPayload,
  TunnelPayload,
  TunnelTestResult,
  UpdateCheckResult,
} from '../types'

export const api = {
  bootstrap: () => invoke<AppSnapshot>('bootstrap'),
  saveTunnel: (payload: TunnelPayload) => invoke<AppSnapshot>('save_tunnel', { payload }),
  deleteTunnel: (id: string) => invoke<AppSnapshot>('delete_tunnel', { id }),
  startTunnel: (id: string) => invoke<AppSnapshot>('start_tunnel', { id }),
  stopTunnel: (id: string) => invoke<AppSnapshot>('stop_tunnel', { id }),
  startAll: () => invoke<AppSnapshot>('start_all'),
  stopAll: () => invoke<AppSnapshot>('stop_all'),
  updateSettings: (payload: AppSettings) => invoke<AppSnapshot>('update_settings', { payload }),
  clearLogs: () => invoke<AppSnapshot>('clear_logs'),
  testTunnel: (payload: TunnelPayload) => invoke<TunnelTestResult>('test_tunnel', { payload }),
  trustHostKey: (payload: TrustHostPayload) => invoke<AppSnapshot>('trust_host_key', { payload }),
  removeTrustedHost: (key: string) => invoke<AppSnapshot>('remove_trusted_host', { key }),
  importRules: (path: string, mode: ImportMode) =>
    invoke<AppSnapshot>('import_rules', { path, mode }),
  exportRules: (path: string) => invoke<ExportResult>('export_rules', { path }),
  checkForUpdates: () => invoke<UpdateCheckResult>('check_for_updates'),
  getUpdateState: () => invoke<UpdateCheckResult>('get_update_state'),
  dismissUpdate: (version: string) => invoke<UpdateCheckResult>('dismiss_update', { version }),
  openReleasePage: (url: string) => invoke<void>('open_release_page', { url }),
}
