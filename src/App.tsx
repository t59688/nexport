import { useEffect, useMemo, useState } from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from '@tauri-apps/plugin-autostart'
import {
  BadgeCheck,
  Cable,
  CircleAlert,
  Download,
  FolderCog,
  FolderKey,
  Import,
  Minus,
  PencilLine,
  Play,
  Plus,
  Power,
  RefreshCw,
  ScanSearch,
  ServerCog,
  Settings2,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  Waypoints,
  Eye,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from './lib/api'
import { cn } from './lib/cn'
import i18n, { type AppLanguage, persistLanguage } from './i18n'
import appIcon from './assets/app-icon.svg'
import type {
  AppSettings,
  AppSnapshot,
  AuthMethod,
  ImportMode,
  LogEntry,
  LogLevel,
  TrustHostPayload,
  TrustedHost,
  TunnelForm,
  TunnelPayload,
  TunnelRecord,
  TunnelStatus,
  TunnelTestResult,
  UpdateCheckResult,
} from './types'

const emptyForm: TunnelForm = {
  name: '',
  bindAddress: '',
  localPort: 12345,
  targetHost: '',
  targetPort: 22,
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  authMethod: 'password',
  password: '',
  privateKeyPath: '',
  privateKeyPassphrase: '',
  autoStart: false,
  skipHostKeyCheck: true,
  note: '',
}

const statusTone: Record<TunnelStatus, string> = {
  stopped: 'text-slate-300 bg-slate-400/10 ring-slate-300/15',
  starting: 'text-cyan-300 bg-cyan-400/10 ring-cyan-300/20',
  running: 'text-emerald-300 bg-emerald-400/10 ring-emerald-300/20',
  error: 'text-rose-300 bg-rose-400/10 ring-rose-300/20',
  stopping: 'text-amber-300 bg-amber-400/10 ring-amber-300/20',
}

const logTone: Record<LogLevel, string> = {
  trace: 'text-slate-400',
  debug: 'text-cyan-200',
  info: 'text-emerald-200',
  warn: 'text-amber-200',
  error: 'text-rose-200',
}

type Notice = {
  tone: 'success' | 'error'
  text: string
}

type UpdatePromptState = {
  source: 'auto' | 'manual'
  result: UpdateCheckResult
}

type SettingsTab = 'general' | 'trust' | 'logs' | 'transfer'

function App() {
  const { t } = useTranslation()
  const appWindow = getCurrentWindow()
  const [snapshot, setSnapshot] = useState<AppSnapshot>({
    tunnels: [],
    settings: { closeToTray: true, launchOnStartup: false },
    logs: [],
    trustedHosts: [],
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [openModal, setOpenModal] = useState(false)
  const [openSettings, setOpenSettings] = useState(false)
  const [openHelp, setOpenHelp] = useState(false)
  const [openInspector, setOpenInspector] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [editing, setEditing] = useState<TunnelRecord | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<TunnelForm>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [modalNotice, setModalNotice] = useState<Notice | null>(null)
  const [testResult, setTestResult] = useState<TunnelTestResult | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [updatePrompt, setUpdatePrompt] = useState<UpdatePromptState | null>(null)
  const didScheduleUpdateCheck = useRef(false)

  const load = async () => {
    const data = await api.bootstrap()
    let startup = data.settings.launchOnStartup
    try {
      startup = await isAutostartEnabled()
    } catch {
      // keep stored value
    }
    setSnapshot({
      ...data,
      settings: {
        ...data.settings,
        launchOnStartup: startup,
      },
    })
    setSelectedId((current) => current ?? data.tunnels[0]?.id ?? null)
  }

  useEffect(() => {
    load()
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (didScheduleUpdateCheck.current) return
    didScheduleUpdateCheck.current = true
    api.getUpdateState().then(setUpdateInfo).catch(() => {})
    const timer = window.setTimeout(() => {
      api
        .checkForUpdates()
        .then((result) => {
          setUpdateInfo(result)
          if (!result.hasUpdate || result.dismissed || !result.latestVersion) return
          setUpdatePrompt({ source: 'auto', result })
        })
        .catch(() => {})
    }, 3500)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized).catch(() => {})
    let unlisten: (() => void) | undefined
    appWindow
      .onResized(async () => {
        try {
          setIsMaximized(await appWindow.isMaximized())
        } catch {
          // ignore
        }
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => unlisten?.()
  }, [appWindow])

  useEffect(() => {
    if (openModal) return
    const timer = window.setInterval(() => {
      api
        .bootstrap()
        .then(async (data) => {
          let startup = data.settings.launchOnStartup
          try {
            startup = await isAutostartEnabled()
          } catch {
            // ignore
          }
          setSnapshot((current) => ({
            ...current,
            ...data,
            settings: {
              ...data.settings,
              launchOnStartup: startup,
            },
          }))
          setSelectedId((current) => {
            if (current && data.tunnels.some((item) => item.id === current)) return current
            return data.tunnels[0]?.id ?? null
          })
        })
        .catch((err) => setError(String(err)))
    }, 1200)
    return () => window.clearInterval(timer)
  }, [openModal])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current))
    }, 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const selected = snapshot.tunnels.find((item) => item.id === selectedId) ?? snapshot.tunnels[0] ?? null

  const summary = useMemo(() => {
    const running = snapshot.tunnels.filter((item) => item.status === 'running').length
    const autoStart = snapshot.tunnels.filter((item) => item.autoStart).length
    const totalConnections = snapshot.tunnels.reduce((sum, item) => sum + item.activeConnections, 0)
    return { running, autoStart, totalConnections, total: snapshot.tunnels.length }
  }, [snapshot])

  const mutate = async (key: string, task: () => Promise<AppSnapshot>, successText?: string) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const next = await task()
      setSnapshot(next)
      setSelectedId((current) => {
        if (current && next.tunnels.some((item) => item.id === current)) return current
        return next.tunnels[0]?.id ?? null
      })
      if (successText) setNotice({ tone: 'success', text: successText })
      return true
    } catch (err) {
      const message = String(err)
      setError(message)
      setNotice({ tone: 'error', text: message })
      return false
    } finally {
      setBusy(null)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, localPort: nextPort(snapshot.tunnels) })
    setTestResult(null)
    setModalNotice(null)
    setOpenModal(true)
  }

  const openEdit = (item: TunnelRecord) => {
    setEditing(item)
    setSelectedId(item.id)
    setForm({
      id: item.id,
      name: item.name,
      bindAddress: item.bindAddress,
      localPort: item.localPort,
      targetHost: item.targetHost,
      targetPort: item.targetPort,
      sshHost: item.sshHost,
      sshPort: item.sshPort,
      sshUser: item.sshUser,
      authMethod: item.authMethod,
      password: item.password ?? '',
      privateKeyPath: item.privateKeyPath ?? '',
      privateKeyPassphrase: item.privateKeyPassphrase ?? '',
      autoStart: item.autoStart,
      skipHostKeyCheck: item.skipHostKeyCheck,
      note: item.note ?? '',
    })
    setTestResult(null)
    setModalNotice(null)
    setOpenModal(true)
  }

  const saveRule = async () => {
    setModalNotice(null)
    const payload = normalizeTunnelForm(form)
    if (!payload) return
    const ok = await mutate(
      editing?.id ?? 'save-rule',
      () => api.saveTunnel(payload),
      editing ? t('notice.ruleUpdated') : t('notice.ruleSaved'),
    )
    if (ok) setOpenModal(false)
  }

  const runTest = async () => {
    setBusy('test-rule')
    setError(null)
    setModalNotice(null)
    const payload = normalizeTunnelForm(form)
    if (!payload) {
      setBusy(null)
      return
    }
    try {
      const result = await api.testTunnel(payload)
      setTestResult(result)
      setModalNotice({
        tone: result.authOk && result.targetReachable && result.portAvailable ? 'success' : 'error',
        text: result.message,
      })
    } catch (err) {
      const message = String(err)
      setError(message)
      setModalNotice({ tone: 'error', text: message })
    } finally {
      setBusy(null)
    }
  }

  const trustCurrentHost = async () => {
    if (!testResult?.fingerprint || !testResult.algorithm) return
    const normalized = normalizeTunnelForm(form)
    if (!normalized) return
    const payload: TrustHostPayload = {
      host: form.sshHost,
      port: normalized.sshPort,
      algorithm: testResult.algorithm,
      fingerprint: testResult.fingerprint,
      note: form.name ? `来自规则：${form.name}` : null,
    }
    const ok = await mutate('trust-host', () => api.trustHostKey(payload), t('notice.hostTrusted'))
    if (ok) await runTest()
  }

  const updateSettings = async (next: AppSettings) => {
    await mutate('settings', () => api.updateSettings(next), t('notice.settingsUpdated'))
  }

  const changeLanguage = async (language: AppLanguage) => {
    await i18n.changeLanguage(language)
    persistLanguage(language)
    setNotice({ tone: 'success', text: `${t('settings.general.languageTitle')} ${language === 'en' ? 'English' : '简体中文'}` })
  }

  const toggleAutostart = async () => {
    setBusy('autostart')
    setNotice(null)
    setError(null)
    try {
      const enabled = !snapshot.settings.launchOnStartup
      if (enabled) await enableAutostart()
      else await disableAutostart()
      const refreshed = await api.updateSettings({
        ...snapshot.settings,
        launchOnStartup: enabled,
      })
      setSnapshot(refreshed)
      setNotice({ tone: 'success', text: enabled ? t('notice.autostartEnabled') : t('notice.autostartDisabled') })
    } catch (err) {
      const message = String(err)
      setError(message)
      setNotice({ tone: 'error', text: message })
    } finally {
      setBusy(null)
    }
  }

  const exportRules = async () => {
    const path = await save({
      title: t('settings.transfer.exportTitle'),
      defaultPath: 'nexport-rules.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!path) return
    try {
      setBusy('export')
      setError(null)
      setNotice(null)
      await api.exportRules(path)
      setNotice({ tone: 'success', text: t('notice.exportDone', { path }) })
    } catch (err) {
      const message = String(err)
      setError(message)
      setNotice({ tone: 'error', text: message })
    } finally {
      setBusy(null)
    }
  }

  const checkForUpdates = async () => {
    setBusy('check-update')
    setError(null)
    setNotice(null)
    try {
      const result = await api.checkForUpdates()
      setUpdateInfo(result)
      if (!result.hasUpdate || !result.latestVersion) {
        setNotice({ tone: 'success', text: t('update.upToDate', { version: result.currentVersion }) })
        return
      }
      setUpdatePrompt({ source: 'manual', result })
    } catch (err) {
      const message = String(err)
      setError(message)
      setNotice({ tone: 'error', text: message })
    } finally {
      setBusy(null)
    }
  }

  const importRules = async (mode: ImportMode) => {
    const path = await open({
      title: t('settings.transfer.mergeTitle'),
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!path || Array.isArray(path)) return
    if (mode === 'replace') {
      const confirmed = await ask(t('confirm.replaceImportBody'), {
        title: t('confirm.replaceImportTitle'),
        kind: 'warning',
      })
      if (!confirmed) return
    }
    await mutate(
      `import-${mode}`,
      () => api.importRules(path, mode),
      mode === 'replace' ? t('notice.importReplaced') : t('notice.importMerged'),
    )
  }

  const confirmUpdatePrompt = async () => {
    if (!updatePrompt?.result.latestVersion) return
    await api.openReleasePage(updatePrompt.result.releaseUrl)
    setNotice({ tone: 'success', text: t('update.releaseOpened', { version: updatePrompt.result.latestVersion }) })
    setUpdatePrompt(null)
  }

  const dismissUpdatePrompt = async () => {
    if (!updatePrompt?.result.latestVersion) {
      setUpdatePrompt(null)
      return
    }
    if (updatePrompt.source === 'auto') {
      const dismissed = await api.dismissUpdate(updatePrompt.result.latestVersion)
      setUpdateInfo(dismissed)
    } else {
      setNotice({ tone: 'success', text: t('update.foundLater', { version: updatePrompt.result.latestVersion }) })
    }
    setUpdatePrompt(null)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(49,196,141,0.16),_transparent_30%),linear-gradient(180deg,#09111b_0%,#05080f_100%)] text-slate-100">
      <TopMenuBar
        appWindow={appWindow}
        activeMenu={activeMenu}
        isMaximized={isMaximized}
        onToggleMenu={setActiveMenu}
        onCloseMenu={() => setActiveMenu(null)}
        onNewRule={() => {
          setActiveMenu(null)
          openCreate()
        }}
        onEditRule={() => {
          setActiveMenu(null)
          if (selected) openEdit(selected)
        }}
        onDeleteRule={() => {
          setActiveMenu(null)
          if (selected) void mutate(selected.id, () => api.deleteTunnel(selected.id), t('notice.ruleDeleted'))
        }}
        onRefresh={() => {
          setActiveMenu(null)
          load().catch((err) => setError(String(err)))
        }}
        onOpenSettings={() => {
          setActiveMenu(null)
          setOpenSettings(true)
        }}
        onOpenHelp={() => {
          setActiveMenu(null)
          setOpenHelp(true)
        }}
        onCheckForUpdates={() => {
          setActiveMenu(null)
          void checkForUpdates()
        }}
        onImportMerge={() => {
          setActiveMenu(null)
          void importRules('merge')
        }}
        onImportReplace={() => {
          setActiveMenu(null)
          void importRules('replace')
        }}
        onExport={() => {
          setActiveMenu(null)
          void exportRules()
        }}
        hasUpdate={Boolean(updateInfo?.hasUpdate)}
        checkingUpdate={busy === 'check-update'}
        selectedAvailable={Boolean(selected)}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col px-3 py-3">
        <section className="shrink-0 border border-white/10 bg-[#111821]/95">
          <div className="hidden items-center justify-end gap-6 border-b border-white/10 px-5 py-3">
            <div className="hidden min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center border border-cyan-400/20 bg-cyan-400/10">
                <Waypoints className="h-5 w-5 text-cyan-200" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan-200/75">
                  NexPort
                </p>
                <h1 className="mt-1 truncate text-[28px] font-semibold tracking-tight text-white">{t('shell.title')}</h1>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 max-[1050px]:hidden">
              <Metric label={t('metrics.totalRules')} value={summary.total} accent="text-white" />
              <Metric label={t('metrics.running')} value={summary.running} accent="text-emerald-300" />
              <Metric label={t('metrics.autoRules')} value={summary.autoStart} accent="text-cyan-200" />
              <Metric label={t('metrics.activeConnections')} value={summary.totalConnections} accent="text-amber-200" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <ToolbarButton icon={Plus} label={t('toolbar.newRule')} onClick={openCreate} />
            <div className="mx-1 h-7 w-px bg-white/10" />
            <ToolbarButton
              icon={Play}
              label={busy === 'start-all' ? t('toolbar.startingAll') : t('toolbar.startAll')}
              variant="success"
              disabled={busy !== null}
              onClick={() => void mutate('start-all', () => api.startAll(), t('notice.allStarted'))}
            />
            <ToolbarButton
              icon={Square}
              label={busy === 'stop-all' ? t('toolbar.stoppingAll') : t('toolbar.stopAll')}
              disabled={busy !== null}
              onClick={() => void mutate('stop-all', () => api.stopAll(), t('notice.allStopped'))}
            />
            <div className="ml-auto grid grid-cols-4 gap-3 max-[1050px]:hidden">
              <Metric label={t('metrics.totalRules')} value={summary.total} accent="text-white" />
              <Metric label={t('metrics.running')} value={summary.running} accent="text-emerald-300" />
              <Metric label={t('metrics.autoRules')} value={summary.autoStart} accent="text-cyan-200" />
              <Metric label={t('metrics.activeConnections')} value={summary.totalConnections} accent="text-amber-200" />
            </div>
          </div>
        </section>

        {notice ? <NoticeBar notice={notice} /> : null}

        <div className="shrink-0 pt-4">
          {error ? (
            <div className="mt-3 border border-rose-400/20 bg-rose-500/10 px-6 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </div>

        <main className="min-h-0 flex-1 pt-3">
          <section className="flex h-full min-h-0 flex-col overflow-hidden border border-white/10 bg-[#0d141c]/98">
            <div className="flex items-center justify-between border-b border-white/10 bg-[#131c25] px-5 py-3">
              <div>
                <div className="text-[15px] font-medium text-white">{t('shell.ruleList')}</div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left">
                <thead className="sticky top-0 z-10 bg-[#0c1522] text-[13px] uppercase tracking-[0.16em] text-slate-400">
                  <tr>
                    <HeadCell>{t('rule.fields.name')}</HeadCell>
                    <HeadCell>{t('common.details')}</HeadCell>
                    <HeadCell>{t('rule.fields.localPort')}</HeadCell>
                    <HeadCell>{t('details.targetService')}</HeadCell>
                    <HeadCell>{t('details.sshJump')}</HeadCell>
                    <HeadCell>{t('details.activeConnections')}</HeadCell>
                    <HeadCell>{t('common.edit')}</HeadCell>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                        {t('shell.readingConfig')}
                      </td>
                    </tr>
                  ) : snapshot.tunnels.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-14 text-center text-slate-400">
                        {t('shell.emptyRules')}
                      </td>
                    </tr>
                  ) : (
                    snapshot.tunnels.map((item) => (
                      <tr
                        key={item.id}
                        className={cn('group cursor-pointer', item.id === selectedId && 'bg-cyan-400/[0.045]')}
                        onClick={() => setSelectedId(item.id)}
                        onDoubleClick={() => openEdit(item)}
                      >
                        <BodyCell className="w-[220px]">
                          <div className="space-y-1">
                            <div className="text-[15px] font-medium text-white">{item.name}</div>
                            <div className="text-xs text-slate-500">{item.note || t('rule.noNote')}</div>
                          </div>
                        </BodyCell>
                        <BodyCell className="w-[160px]">
                          <div className="space-y-2">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1',
                                statusTone[item.status],
                              )}
                            >
                              {statusLabel(item.status)}
                            </span>
                            <div className="text-xs text-slate-400">
                              {item.lastError ?? item.statusMessage ?? t('rule.waiting')}
                            </div>
                          </div>
                        </BodyCell>
                        <BodyCell className="w-[150px] font-mono text-sm text-cyan-100">
                          {item.bindAddress}:{item.localPort}
                        </BodyCell>
                        <BodyCell className="w-[220px] font-mono text-sm text-slate-200">
                          {item.targetHost}:{item.targetPort}
                        </BodyCell>
                        <BodyCell className="w-[220px] font-mono text-sm text-slate-200">
                          {item.sshUser}@{item.sshHost}:{item.sshPort}
                        </BodyCell>
                        <BodyCell className="w-[80px] text-sm text-amber-200">{item.activeConnections}</BodyCell>
                        <BodyCell className="w-[180px]">
                          <div className="flex items-center gap-2">
                            <RowButton
                              icon={item.status === 'running' || item.status === 'starting' ? Square : Play}
                              tone={item.status === 'running' || item.status === 'starting' ? 'neutral' : 'success'}
                              title={
                                item.status === 'running' || item.status === 'starting'
                                  ? t('rule.stopRule')
                                  : t('rule.startRule')
                              }
                              onClick={() =>
                                void mutate(
                                  item.id,
                                  () =>
                                    item.status === 'running' || item.status === 'starting'
                                      ? api.stopTunnel(item.id)
                                      : api.startTunnel(item.id),
                                  item.status === 'running' || item.status === 'starting'
                                    ? t('notice.tunnelStopped')
                                    : t('notice.tunnelStartSent'),
                                )
                              }
                            />
                            <RowButton
                              icon={Eye}
                              tone="neutral"
                              title={t('common.details')}
                              onClick={() => {
                                setSelectedId(item.id)
                                setOpenInspector(true)
                              }}
                            />
                            <RowButton
                              icon={PencilLine}
                              tone="neutral"
                              title={t('common.edit')}
                              onClick={() => openEdit(item)}
                            />
                            <RowButton
                              icon={Trash2}
                              tone="danger"
                              title={t('common.delete')}
                              onClick={() =>
                                void mutate(item.id, () => api.deleteTunnel(item.id), t('notice.ruleDeleted'))
                              }
                            />
                          </div>
                        </BodyCell>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="hidden flex min-h-0 flex-col border border-white/10 bg-black/20 p-5 backdrop-blur-xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5">
                <ServerCog className="h-4 w-4 text-cyan-200" />
              </div>
              <div>
                <div className="text-[15px] font-medium text-white">{t('shell.currentRule')}</div>
                <div className="mt-1 text-sm text-slate-500">{t('shell.emptySelection')}</div>
              </div>
            </div>

            {selected ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="border border-white/8 bg-black/15 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-white">{selected.name}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-400">{selected.note || t('rule.noNoteLong')}</div>
                    </div>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1',
                        statusTone[selected.status],
                      )}
                    >
                      {statusLabel(selected.status)}
                    </span>
                  </div>
                </div>

                <InfoGrid selected={selected} />

                <div className="mt-auto grid grid-cols-2 gap-3">
                  <ToolbarButton
                    icon={selected.status === 'running' || selected.status === 'starting' ? Square : Play}
                    label={selected.status === 'running' || selected.status === 'starting' ? '停止当前规则' : '启动当前规则'}
                    variant={selected.status === 'running' || selected.status === 'starting' ? 'neutral' : 'success'}
                    disabled={busy !== null}
                    onClick={() =>
                      void mutate(
                        selected.id,
                        () =>
                          selected.status === 'running' || selected.status === 'starting'
                            ? api.stopTunnel(selected.id)
                            : api.startTunnel(selected.id),
                      )
                    }
                  />
                  <ToolbarButton
                    icon={PencilLine}
                    label="编辑规则"
                    disabled={busy !== null}
                    onClick={() => openEdit(selected)}
                  />
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                选中一条规则后，这里会显示它的关键信息与快捷操作。
              </div>
            )}
          </section>
        </main>
      </div>

      {openModal ? (
        <TunnelModal
          editing={editing}
          form={form}
          notice={modalNotice}
          testResult={testResult}
          onChange={setForm}
          onClose={() => setOpenModal(false)}
          onSave={saveRule}
          onTest={runTest}
          onTrust={trustCurrentHost}
          disabled={busy !== null}
          saving={busy === 'save-rule' || busy === editing?.id}
          testing={busy === 'test-rule'}
        />
      ) : null}

      {openSettings ? (
        <SettingsModal
          tab={settingsTab}
          onTabChange={setSettingsTab}
          settings={snapshot.settings}
          currentLanguage={(i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'zh-CN') as AppLanguage}
          trustedHosts={snapshot.trustedHosts}
          logs={snapshot.logs}
          busy={busy}
          onClose={() => setOpenSettings(false)}
          onToggleCloseToTray={() =>
            updateSettings({
              ...snapshot.settings,
              closeToTray: !snapshot.settings.closeToTray,
            })
          }
          onToggleAutostart={toggleAutostart}
          onRemoveTrustedHost={(key) =>
            void mutate(`remove-host-${key}`, () => api.removeTrustedHost(key), t('notice.hostRemoved'))
          }
          onClearLogs={() => void mutate('clear-logs', () => api.clearLogs(), t('notice.logsCleared'))}
          onChangeLanguage={(language) => void changeLanguage(language)}
          onExport={() => void exportRules()}
          onImportMerge={() => void importRules('merge')}
          onImportReplace={() => void importRules('replace')}
        />
      ) : null}

      {openHelp ? <HelpModal onClose={() => setOpenHelp(false)} /> : null}
      {updatePrompt ? (
        <UpdatePromptModal
          result={updatePrompt.result}
          onConfirm={() => void confirmUpdatePrompt()}
          onClose={() => void dismissUpdatePrompt()}
        />
      ) : null}
      {openInspector && selected ? (
        <DetailsModal
          selected={selected}
          busy={busy !== null}
          onClose={() => setOpenInspector(false)}
          onEdit={() => {
            setOpenInspector(false)
            openEdit(selected)
          }}
          onToggle={() =>
            void mutate(
              selected.id,
              () =>
                selected.status === 'running' || selected.status === 'starting'
                  ? api.stopTunnel(selected.id)
                  : api.startTunnel(selected.id),
            )
          }
        />
      ) : null}
    </div>
  )
}

function TopMenuBar({
  appWindow,
  activeMenu,
  isMaximized,
  onToggleMenu,
  onCloseMenu,
  onNewRule,
  onEditRule,
  onDeleteRule,
  onRefresh,
  onOpenSettings,
  onOpenHelp,
  onCheckForUpdates,
  onImportMerge,
  onImportReplace,
  onExport,
  hasUpdate,
  checkingUpdate,
  selectedAvailable,
}: {
  appWindow: ReturnType<typeof getCurrentWindow>
  activeMenu: string | null
  isMaximized: boolean
  onToggleMenu: (menu: string | null) => void
  onCloseMenu: () => void
  onNewRule: () => void
  onEditRule: () => void
  onDeleteRule: () => void
  onRefresh: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onCheckForUpdates: () => void
  onImportMerge: () => void
  onImportReplace: () => void
  onExport: () => void
  hasUpdate: boolean
  checkingUpdate: boolean
  selectedAvailable: boolean
}) {
  const { t } = useTranslation()
  useEffect(() => {
    const close = () => onCloseMenu()
    const closeByEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMenu()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', closeByEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', closeByEsc)
    }
  }, [onCloseMenu])

  const toggleMaximize = () => {
    void appWindow.toggleMaximize()
  }

  return (
    <div
      className="flex shrink-0 select-none items-stretch border-b border-white/10 bg-[#151b24]"
      style={{ height: 32 }}
    >
      <div
        className="flex items-center gap-1.5 border-r border-white/6 px-2.5"
        data-tauri-drag-region
        onDoubleClick={toggleMaximize}
      >
        <img
          src={appIcon}
          alt="NexPort"
          className="pointer-events-none select-none"
          draggable={false}
          style={{ width: 18, height: 18 }}
        />
        <div className="pointer-events-none hidden max-w-[220px] truncate text-sm font-medium text-slate-100">
          NexPort
        </div>
      </div>

      <div
        className="flex items-stretch"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <MenuTrigger label={t('menu.file')} menuKey="file" activeMenu={activeMenu} onToggleMenu={onToggleMenu}>
          <MenuItem icon={Plus} label={t('menu.newRule')} onClick={onNewRule} />
          <MenuItem icon={Import} label={t('menu.importMerge')} onClick={onImportMerge} />
          <MenuItem icon={Upload} label={t('menu.importReplace')} onClick={onImportReplace} />
          <MenuItem icon={Download} label={t('menu.exportRules')} onClick={onExport} />
        </MenuTrigger>
        <MenuTrigger label={t('menu.edit')} menuKey="edit" activeMenu={activeMenu} onToggleMenu={onToggleMenu}>
          <MenuItem icon={PencilLine} label={t('menu.editCurrentRule')} onClick={onEditRule} disabled={!selectedAvailable} />
          <MenuItem icon={Trash2} label={t('menu.deleteCurrentRule')} onClick={onDeleteRule} disabled={!selectedAvailable} />
        </MenuTrigger>
        <MenuTrigger label={t('menu.view')} menuKey="view" activeMenu={activeMenu} onToggleMenu={onToggleMenu}>
          <MenuItem icon={RefreshCw} label={t('common.refresh')} onClick={onRefresh} />
          <MenuItem icon={Settings2} label={t('menu.openSettings')} onClick={onOpenSettings} />
        </MenuTrigger>
        <MenuTrigger label={t('menu.window')} menuKey="window" activeMenu={activeMenu} onToggleMenu={onToggleMenu}>
          <MenuItem icon={Settings2} label={t('common.settings')} onClick={onOpenSettings} />
        </MenuTrigger>
        <MenuTrigger
          label={t('menu.help')}
          menuKey="help"
          activeMenu={activeMenu}
          onToggleMenu={onToggleMenu}
          hasBadge={hasUpdate}
        >
          <MenuItem
            icon={RefreshCw}
            label={checkingUpdate ? t('menu.checkingUpdates') : t('menu.checkUpdates')}
            onClick={onCheckForUpdates}
            disabled={checkingUpdate}
          />
          <MenuItem icon={ShieldAlert} label={t('menu.usage')} onClick={onOpenHelp} />
        </MenuTrigger>
      </div>

      <div className="min-w-0 flex-1" data-tauri-drag-region onDoubleClick={toggleMaximize} />

      <div
        className="flex items-stretch border-l border-white/6"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <WindowButton
          title={t('menu.minimize')}
          onClick={() => {
            void appWindow.minimize()
          }}
        >
          <Minus className="h-4 w-4" />
        </WindowButton>
        <WindowButton title={isMaximized ? t('menu.restore') : t('menu.maximize')} onClick={toggleMaximize}>
          <Square className="h-3.5 w-3.5" />
        </WindowButton>
        <WindowButton
          title={t('menu.close')}
          tone="danger"
          onClick={() => {
            void appWindow.close()
          }}
        >
          <X className="h-4 w-4" />
        </WindowButton>
      </div>
    </div>
  )
}

function MenuTrigger({
  label,
  menuKey,
  activeMenu,
  onToggleMenu,
  hasBadge,
  children,
}: {
  label: string
  menuKey: string
  activeMenu: string | null
  onToggleMenu: (menu: string | null) => void
  hasBadge?: boolean
  children: ReactNode
}) {
  const open = activeMenu === menuKey
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onToggleMenu(open ? null : menuKey)}
        style={{ height: 32, paddingLeft: 10, paddingRight: 10, fontSize: 12, lineHeight: '12px', fontWeight: 400 }}
        className={cn(
          'inline-flex items-center transition',
          open ? 'bg-white/7 text-slate-100' : 'text-slate-300/90 hover:bg-white/5 hover:text-slate-100',
        )}
      >
        <span className="relative inline-flex items-center">
          {label}
          {hasBadge ? <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-rose-400" /> : null}
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[184px] border border-white/10 bg-[#0b111a] p-1 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
          {children}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        style={{ minHeight: 28, padding: '5px 10px', fontSize: 12, lineHeight: '12px', fontWeight: 400 }}
        className="flex w-full items-center gap-2 text-left text-slate-300/90 transition hover:bg-white/7 hover:text-slate-100 disabled:opacity-40"
      >
      <Icon className="text-cyan-200/90" style={{ width: 12, height: 12 }} />
      <span>{label}</span>
    </button>
  )
}

function WindowButton({
  children,
  title,
  onClick,
  tone = 'neutral',
}: {
  children: ReactNode
  title: string
  onClick: () => void
  tone?: 'neutral' | 'danger'
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(event) => event.stopPropagation()}
      className={cn(
        'flex items-center justify-center text-slate-300 transition duration-100 active:scale-[0.98]',
        tone === 'danger'
          ? 'hover:bg-[#c42b1c] hover:text-white active:bg-[#a82619]'
          : 'hover:bg-white/10 hover:text-white active:bg-white/15',
      )}
      style={{ width: 36, height: 32 }}
    >
      {children}
    </button>
  )
}

function NoticeBar({ notice }: { notice: Notice }) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed right-5 top-12 z-[80] min-w-[280px] max-w-[420px] border px-5 py-3 text-sm shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-sm',
        notice.tone === 'success'
          ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
          : 'border-rose-400/20 bg-rose-500/10 text-rose-200',
      )}
    >
      {notice.text}
    </div>
  )
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="min-w-[112px] border border-white/8 bg-black/15 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={cn('mt-2 text-[22px] font-semibold tracking-tight', accent)}>{value}</div>
    </div>
  )
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = 'neutral',
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'neutral' | 'success' | 'danger'
}) {
  const tone =
    variant === 'success'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15'
      : variant === 'danger'
        ? 'border-rose-400/20 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15'
        : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 items-center gap-2 border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45',
        tone,
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function HeadCell({ children }: { children: string }) {
  return <th className="border-b border-r border-white/10 px-6 py-4 font-medium last:border-r-0">{children}</th>
}

function BodyCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td
      className={cn(
        'border-b border-r border-white/6 px-6 py-5 align-middle text-sm text-slate-300 last:border-r-0 group-hover:bg-white/[0.025]',
        className,
      )}
    >
      {children}
    </td>
  )
}

function RowButton({
  icon: Icon,
  tone,
  title,
  onClick,
}: {
  icon: LucideIcon
  tone: 'neutral' | 'success' | 'danger'
  title: string
  onClick: () => void
}) {
  const palette =
    tone === 'success'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
      : tone === 'danger'
        ? 'border-rose-400/20 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20'
        : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'

  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn('inline-flex h-9 w-9 items-center justify-center border transition', palette)}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

function InfoGrid({ selected }: { selected: TunnelRecord }) {
  const { t } = useTranslation()
  const items = [
    [t('details.bindAddress'), `${selected.bindAddress}:${selected.localPort}`],
    [t('details.targetService'), `${selected.targetHost}:${selected.targetPort}`],
    [t('details.sshJump'), `${selected.sshUser}@${selected.sshHost}:${selected.sshPort}`],
    [t('details.authMethod'), selected.authMethod === 'password' ? t('common.password') : t('common.privateKey')],
    [t('details.activeConnections'), String(selected.activeConnections)],
    [t('details.startupMode'), selected.autoStart ? t('rule.startupModeAuto') : t('rule.startupModeManual')],
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="border border-white/8 bg-black/15 px-4 py-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
          <div className="mt-2 break-all font-mono text-sm text-slate-200">{value}</div>
        </div>
      ))}
    </div>
  )
}

function DetailsModal({
  selected,
  busy,
  onClose,
  onEdit,
  onToggle,
}: {
  selected: TunnelRecord
  busy: boolean
  onClose: () => void
  onEdit: () => void
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const running = selected.status === 'running' || selected.status === 'starting'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 py-6 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-48px)] w-full max-w-5xl flex-col overflow-hidden border border-white/10 bg-[#09111b] shadow-[0_40px_150px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">Rule Details</div>
            <div className="mt-2 text-2xl font-semibold text-white">{selected.name}</div>
            <div className="mt-2 text-sm text-slate-400">{selected.note || t('rule.noNoteLong')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5 text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-4 flex items-center justify-between">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1',
                statusTone[selected.status],
              )}
            >
              {statusLabel(selected.status)}
            </span>
            <div className="text-sm text-slate-500">{selected.lastError ?? selected.statusMessage ?? t('rule.waiting')}</div>
          </div>
          <InfoGrid selected={selected} />
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <ToolbarButton
              icon={running ? Square : Play}
              label={running ? t('rule.stopRule') : t('rule.startRule')}
              variant={running ? 'neutral' : 'success'}
              disabled={busy}
              onClick={onToggle}
            />
            <ToolbarButton icon={PencilLine} label={t('rule.editRule')} disabled={busy} onClick={onEdit} />
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsModal({
  tab,
  onTabChange,
  settings,
  currentLanguage,
  trustedHosts,
  logs,
  busy,
  onClose,
  onToggleCloseToTray,
  onToggleAutostart,
  onChangeLanguage,
  onRemoveTrustedHost,
  onClearLogs,
  onExport,
  onImportMerge,
  onImportReplace,
}: {
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  settings: AppSettings
  currentLanguage: AppLanguage
  trustedHosts: TrustedHost[]
  logs: LogEntry[]
  busy: string | null
  onClose: () => void
  onToggleCloseToTray: () => void
  onToggleAutostart: () => void
  onChangeLanguage: (language: AppLanguage) => void
  onRemoveTrustedHost: (key: string) => void
  onClearLogs: () => void
  onExport: () => void
  onImportMerge: () => void
  onImportReplace: () => void
}) {
  const { t } = useTranslation()
  const nav: Array<{ key: SettingsTab; icon: LucideIcon; title: string; desc: string }> = [
    { key: 'general', icon: Settings2, title: t('settings.nav.general.title'), desc: t('settings.nav.general.desc') },
    { key: 'trust', icon: BadgeCheck, title: t('settings.nav.trust.title'), desc: t('settings.nav.trust.desc') },
    { key: 'logs', icon: Cable, title: t('settings.nav.logs.title'), desc: t('settings.nav.logs.desc') },
    { key: 'transfer', icon: FolderCog, title: t('settings.nav.transfer.title'), desc: t('settings.nav.transfer.desc') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 py-6 backdrop-blur-sm">
      <div className="flex h-[min(86vh,900px)] w-full max-w-6xl overflow-hidden border border-white/10 bg-[#09111b] shadow-[0_40px_150px_rgba(0,0,0,0.6)]">
        <aside className="flex w-[290px] shrink-0 flex-col border-r border-white/10 bg-black/15">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">Settings</div>
              <div className="mt-2 text-xl font-semibold text-white">{t('settings.title')}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center border border-white/10 bg-white/5 text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {nav.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onTabChange(item.key)}
                className={cn(
                  'flex w-full items-start gap-3 border px-4 py-4 text-left transition',
                  tab === item.key
                    ? 'border-cyan-400/30 bg-cyan-400/12 text-cyan-50 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.12)]'
                    : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.05]',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 items-center justify-center border bg-black/15',
                    tab === item.key ? 'border-cyan-300/30 bg-cyan-400/12 text-cyan-100' : 'border-white/10',
                  )}
                >
                  <item.icon className={cn('h-4 w-4', tab === item.key ? 'text-cyan-100' : 'text-cyan-200')} />
                </div>
                <div>
                  <div className={cn('text-sm font-medium', tab === item.key ? 'text-cyan-50' : 'text-white')}>
                    {item.title}
                  </div>
                  <div className={cn('mt-1 text-sm leading-6', tab === item.key ? 'text-cyan-100/75' : 'text-slate-400')}>
                    {item.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === 'general' ? (
            <Section
              title={t('settings.general.title')}
              icon={Settings2}
              desc={t('settings.general.desc')}
            >
              <div className="grid gap-4">
                <ToggleCard
                  checked={settings.closeToTray}
                  title={t('settings.general.closeToTrayTitle')}
                  body={t('settings.general.closeToTrayBody')}
                  disabled={busy === 'settings'}
                  onClick={onToggleCloseToTray}
                />
                <ToggleCard
                  checked={settings.launchOnStartup}
                  title={t('settings.general.launchOnStartupTitle')}
                  body={t('settings.general.launchOnStartupBody')}
                  disabled={busy === 'autostart'}
                  onClick={onToggleAutostart}
                />
                <div className="border border-white/8 bg-black/15 px-4 py-4">
                  <div className="text-sm font-medium text-white">{t('settings.general.languageTitle')}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-400">{t('settings.general.languageBody')}</div>
                  <div className="mt-4 grid grid-cols-2 border border-white/10 bg-white/5 p-1">
                    <Segment
                      selected={currentLanguage === 'zh-CN'}
                      label={t('settings.general.languageZh')}
                      onClick={() => onChangeLanguage('zh-CN')}
                    />
                    <Segment
                      selected={currentLanguage === 'en'}
                      label={t('settings.general.languageEn')}
                      onClick={() => onChangeLanguage('en')}
                    />
                  </div>
                </div>
              </div>
            </Section>
          ) : null}

          {tab === 'trust' ? (
            <Section
              title={t('settings.trust.title')}
              icon={BadgeCheck}
              desc={t('settings.trust.desc')}
            >
              <div className="space-y-3">
                {trustedHosts.length === 0 ? (
                  <EmptyHint text={t('settings.trust.empty')} />
                ) : (
                  trustedHosts.map((item) => (
                    <div key={item.key} className="border border-white/8 bg-black/15 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm text-cyan-100">
                            {item.host}:{item.port}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{item.algorithm}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {t('settings.trust.trustedAt')}: {formatTime(item.trustedAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => onRemoveTrustedHost(item.key)}
                          className="inline-flex h-8 w-8 items-center justify-center border border-rose-400/20 bg-rose-400/10 text-rose-200 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 break-all font-mono text-xs text-slate-400">{item.fingerprint}</div>
                      {item.note ? <div className="mt-3 text-sm text-slate-400">{item.note}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </Section>
          ) : null}

          {tab === 'logs' ? (
            <Section
              title={t('settings.logs.title')}
              icon={Cable}
              desc={t('settings.logs.desc')}
              action={
                <button
                  type="button"
                  disabled={busy === 'clear-logs'}
                  onClick={onClearLogs}
                  className="inline-flex h-10 items-center gap-2 border border-white/10 bg-white/5 px-4 text-sm text-slate-300 disabled:opacity-50"
                >
                  {t('settings.logs.clear')}
                </button>
              }
            >
              <div className="space-y-3">
                {logs.length === 0 ? (
                  <EmptyHint text={t('settings.logs.empty')} />
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="border border-white/8 bg-black/15 px-4 py-4">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className={cn('font-medium uppercase tracking-[0.12em]', logTone[log.level])}>
                          {log.level}
                        </div>
                        <div className="text-slate-500">{formatTime(log.timestamp)}</div>
                      </div>
                      <div className="mt-1 text-xs text-cyan-200/80">{log.scope}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">{log.message}</div>
                    </div>
                  ))
                )}
              </div>
            </Section>
          ) : null}

          {tab === 'transfer' ? (
            <Section
              title={t('settings.transfer.title')}
              icon={Import}
              desc={t('settings.transfer.desc')}
            >
              <div className="grid grid-cols-3 gap-4 max-[980px]:grid-cols-1">
                <ActionCard
                  icon={Download}
                  title={t('settings.transfer.exportTitle')}
                  body={t('settings.transfer.exportBody')}
                  onClick={onExport}
                />
                <ActionCard
                  icon={Upload}
                  title={t('settings.transfer.mergeTitle')}
                  body={t('settings.transfer.mergeBody')}
                  onClick={onImportMerge}
                />
                <ActionCard
                  icon={FolderCog}
                  title={t('settings.transfer.replaceTitle')}
                  body={t('settings.transfer.replaceBody')}
                  onClick={onImportReplace}
                  tone="danger"
                />
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 py-6 backdrop-blur-sm">
      <div className="w-full max-w-4xl overflow-hidden border border-white/10 bg-[#09111b] shadow-[0_40px_150px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">Help</div>
            <div className="mt-2 text-2xl font-semibold text-white">{t('help.title')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5 text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 max-[980px]:grid-cols-1">
          <Panel
            icon={ServerCog}
            title={t('help.dailyTitle')}
            body={t('help.dailyBody')}
          />
          <Panel
            icon={FolderKey}
            title={t('help.routeTitle')}
            body={t('help.routeBody')}
          />
          <Panel
            icon={ShieldAlert}
            title={t('help.advancedTitle')}
            body={t('help.advancedBody')}
          />
        </div>
      </div>
    </div>
  )
}

function UpdatePromptModal({
  result,
  onConfirm,
  onClose,
}: {
  result: UpdateCheckResult
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-6 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden border border-white/10 bg-[#09111b] shadow-[0_40px_150px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">Update</div>
            <div className="mt-2 text-2xl font-semibold text-white">{t('update.foundTitle')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5 text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-6">
          <div className="rounded-sm border border-cyan-400/15 bg-cyan-400/8 px-4 py-4 text-sm leading-7 text-slate-100">
            {t('update.foundBody', {
              latestVersion: result.latestVersion,
              currentVersion: result.currentVersion,
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            className="h-11 border border-white/10 bg-white/5 px-4 text-sm text-slate-300"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-11 items-center gap-2 border border-cyan-400/20 bg-cyan-400/10 px-5 text-sm font-medium text-cyan-100"
          >
            <Download className="h-4 w-4" />
            {t('update.openRelease')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Panel({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="border-r border-white/10 px-6 py-5 last:border-r-0 max-[980px]:border-b max-[980px]:last:border-b-0 max-[980px]:border-r-0">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center border border-white/10 bg-white/5">
          <Icon className="h-4 w-4 text-cyan-200" />
        </div>
        <div className="text-[15px] font-medium text-white">{title}</div>
      </div>
      <p className="mt-3 max-w-[44ch] text-sm leading-6 text-slate-400">{body}</p>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  desc,
  action,
  children,
}: {
  title: string
  icon: LucideIcon
  desc: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5">
            <Icon className="h-4 w-4 text-cyan-200" />
          </div>
          <div>
            <div className="text-xl font-semibold text-white">{title}</div>
            <div className="mt-2 max-w-[60ch] text-sm leading-6 text-slate-400">{desc}</div>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function ActionCard({
  icon: Icon,
  title,
  body,
  onClick,
  tone = 'neutral',
}: {
  icon: LucideIcon
  title: string
  body: string
  onClick: () => void
  tone?: 'neutral' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[164px] flex-col items-start gap-3 border px-4 py-4 text-left transition',
        tone === 'danger'
          ? 'border-rose-400/20 bg-rose-400/6 hover:bg-rose-400/10'
          : 'border-white/8 bg-black/15 hover:bg-white/[0.05]',
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center border border-white/10 bg-black/15">
        <Icon className="h-4 w-4 text-cyan-200" />
      </div>
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="text-sm leading-6 text-slate-400">{body}</div>
    </button>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <div className="border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500">{text}</div>
}

function TunnelModal({
  editing,
  form,
  notice,
  testResult,
  onChange,
  onClose,
  onSave,
  onTest,
  onTrust,
  disabled,
  saving,
  testing,
}: {
  editing: TunnelRecord | null
  form: TunnelForm
  notice: Notice | null
  testResult: TunnelTestResult | null
  onChange: (next: TunnelForm) => void
  onClose: () => void
  onSave: () => void
  onTest: () => void
  onTrust: () => void
  disabled: boolean
  saving: boolean
  testing: boolean
}) {
  const { t } = useTranslation()
  const authMethod: AuthMethod = form.authMethod
  const showTrust = testResult?.hostKeyStatus === 'unknown' || testResult?.hostKeyStatus === 'mismatch'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 py-6 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-48px)] w-full max-w-6xl flex-col overflow-hidden border border-white/10 bg-[#09111b] shadow-[0_40px_150px_rgba(0,0,0,0.6)]">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">
              {t('rule.tunnelEditor')}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {editing ? t('rule.editTitle') : t('rule.newTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || testing}
            className="inline-flex h-10 w-10 items-center justify-center border border-white/10 bg-white/5 text-slate-300 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid min-h-full grid-cols-[1.15fr,0.85fr] max-[1180px]:grid-cols-1">
            <div className="grid grid-cols-2 gap-x-8 gap-y-6 border-r border-white/10 px-6 py-6 max-[1180px]:border-r-0 max-[900px]:grid-cols-1">
              <Field label={t('rule.fields.name')} required hint={t('rule.hints.name')}>
                <input
                  value={form.name}
                  onChange={(e) => onChange({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.name')}
                />
              </Field>
              <Field label={t('rule.fields.note')} hint={t('rule.hints.note')}>
                <input
                  value={form.note ?? ''}
                  onChange={(e) => onChange({ ...form, note: e.target.value })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.note')}
                />
              </Field>
              <Field label={t('rule.fields.bindAddress')} required hint={t('rule.hints.bindAddress')}>
                <input
                  value={form.bindAddress}
                  onChange={(e) => onChange({ ...form, bindAddress: e.target.value })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.bindAddress')}
                />
              </Field>
              <Field label={t('rule.fields.localPort')} required hint={t('rule.hints.localPort')}>
                <input
                  value={form.localPort}
                  onChange={(e) => onChange({ ...form, localPort: parsePortInput(e.target.value) })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.localPort')}
                />
              </Field>
              <Field label={t('rule.fields.targetHost')} required hint={t('rule.hints.targetHost')}>
                <input
                  value={form.targetHost}
                  onChange={(e) => onChange({ ...form, targetHost: e.target.value })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.targetHost')}
                />
              </Field>
              <Field label={t('rule.fields.targetPort')} required hint={t('rule.hints.targetPort')}>
                <input
                  value={form.targetPort}
                  onChange={(e) => onChange({ ...form, targetPort: parsePortInput(e.target.value) })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.targetPort')}
                />
              </Field>
              <Field label={t('rule.fields.sshHost')} required hint={t('rule.hints.sshHost')}>
                <input
                  value={form.sshHost}
                  onChange={(e) => onChange({ ...form, sshHost: e.target.value })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.sshHost')}
                />
              </Field>
              <Field label={t('rule.fields.sshPort')} required hint={t('rule.hints.sshPort')}>
                <input
                  value={form.sshPort}
                  onChange={(e) => onChange({ ...form, sshPort: parsePortInput(e.target.value) })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.sshPort')}
                />
              </Field>
              <Field label={t('rule.fields.sshUser')} required hint={t('rule.hints.sshUser')}>
                <input
                  value={form.sshUser}
                  onChange={(e) => onChange({ ...form, sshUser: e.target.value })}
                  className={inputClass}
                  placeholder={t('rule.placeholders.sshUser')}
                />
              </Field>
              <Field label={t('rule.fields.authMethod')} required hint={t('rule.hints.authMethod')}>
                <div className="grid grid-cols-2 border border-white/10 bg-white/5 p-1">
                  <Segment
                    selected={authMethod === 'password'}
                    label={t('common.password')}
                    onClick={() => onChange({ ...form, authMethod: 'password' })}
                  />
                  <Segment
                    selected={authMethod === 'private_key'}
                    label={t('common.privateKey')}
                    onClick={() => onChange({ ...form, authMethod: 'private_key' })}
                  />
                </div>
              </Field>

              {authMethod === 'password' ? (
                <>
                  <Field label={t('rule.fields.sshPassword')} required hint={t('rule.hints.sshPassword')}>
                    <input
                      type="password"
                      value={form.password ?? ''}
                      onChange={(e) => onChange({ ...form, password: e.target.value })}
                      className={inputClass}
                      placeholder={t('rule.placeholders.sshPassword')}
                    />
                  </Field>
                  <Field label={t('test.desc')}>
                    <div className="border border-cyan-400/15 bg-cyan-400/8 px-4 py-3 text-sm leading-6 text-cyan-100">
                      {t('rule.cards.authTip')}
                    </div>
                  </Field>
                </>
              ) : (
                <>
                  <Field label={t('rule.fields.privateKeyPath')} required hint={t('rule.hints.privateKeyPath')}>
                    <input
                      value={form.privateKeyPath ?? ''}
                      onChange={(e) => onChange({ ...form, privateKeyPath: e.target.value })}
                      className={inputClass}
                      placeholder={t('rule.placeholders.privateKeyPath')}
                    />
                  </Field>
                  <Field label={t('rule.fields.privateKeyPassphrase')} hint={t('rule.hints.privateKeyPassphrase')}>
                    <input
                      type="password"
                      value={form.privateKeyPassphrase ?? ''}
                      onChange={(e) => onChange({ ...form, privateKeyPassphrase: e.target.value })}
                      className={inputClass}
                      placeholder={t('rule.placeholders.privateKeyPassphrase')}
                    />
                  </Field>
                </>
              )}

              <div className="col-span-2 grid grid-cols-2 gap-4 border border-white/8 bg-white/[0.025] p-4 max-[900px]:grid-cols-1">
                <ToggleCard
                  checked={form.autoStart}
                  title={t('rule.cards.autoStartTitle')}
                  body={t('rule.cards.autoStartBody')}
                  onClick={() => onChange({ ...form, autoStart: !form.autoStart })}
                />
                <ToggleCard
                  checked={form.skipHostKeyCheck}
                  title={t('rule.cards.skipHostTitle')}
                  body={t('rule.cards.skipHostBody')}
                  onClick={() => onChange({ ...form, skipHostKeyCheck: !form.skipHostKeyCheck })}
                />
              </div>
            </div>

            <div className="border-t border-white/10 px-6 py-6 min-[1181px]:border-t-0">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[12px] uppercase tracking-[0.18em] text-slate-400">{t('test.title')}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-400">{t('test.desc')}</div>
                </div>
                <button
                  type="button"
                  onClick={onTest}
                  disabled={disabled}
                  className="inline-flex h-11 items-center gap-2 border border-cyan-400/20 bg-cyan-400/10 px-4 text-sm font-medium text-cyan-100 disabled:opacity-50"
                >
                  <ScanSearch className="h-4 w-4" />
                  {testing ? t('test.running') : t('test.button')}
                </button>
              </div>

            <div className="mt-5 space-y-3">
              {notice ? <NoticeBar notice={notice} /> : null}
              <TestLine
                icon={BadgeCheck}
                label={t('test.localPort')}
                  good={testResult ? testResult.portAvailable : null}
                  body={testResult?.portMessage ?? t('test.notTested')}
                />
                <TestLine
                  icon={ShieldAlert}
                  label={t('test.hostKey')}
                  good={
                    testResult
                      ? testResult.hostKeyStatus === 'trusted' || testResult.hostKeyStatus === 'skipped'
                      : null
                  }
                  body={hostKeySummary(testResult)}
                />
                <TestLine
                  icon={Cable}
                  label={t('test.sshAuth')}
                  good={testResult ? testResult.authOk : null}
                  body={testResult?.message ?? t('test.notTested')}
                />
                <TestLine
                  icon={ServerCog}
                  label={t('test.targetPort')}
                  good={testResult ? testResult.targetReachable : null}
                  body={targetSummary(testResult)}
                />
              </div>

              {showTrust && testResult?.fingerprint && testResult.algorithm ? (
                <div className="mt-5 border border-amber-400/20 bg-amber-500/10 p-4">
                  <div className="text-sm font-medium text-amber-100">{t('test.hostTrustNeeded')}</div>
                  <div className="mt-2 text-sm text-amber-50/85">{t('test.algorithm', { algorithm: testResult.algorithm })}</div>
                  <div className="mt-1 break-all font-mono text-xs text-amber-100">{testResult.fingerprint}</div>
                  {testResult.expectedFingerprint ? (
                    <div className="mt-2 break-all font-mono text-xs text-amber-50/75">
                      {t('test.trustedOld', { fingerprint: testResult.expectedFingerprint })}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={onTrust}
                    disabled={disabled}
                    className="mt-4 inline-flex h-10 items-center gap-2 border border-amber-300/30 bg-amber-300/15 px-4 text-sm font-medium text-amber-100 disabled:opacity-50"
                  >
                    <BadgeCheck className="h-4 w-4" />
                    {t('test.trustAndRetry')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || testing}
              className="h-11 border border-white/10 bg-white/5 px-4 text-sm text-slate-300 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onSave}
              className="inline-flex h-11 items-center gap-2 border border-emerald-400/20 bg-emerald-400/10 px-5 text-sm font-medium text-emerald-200 disabled:opacity-50"
            >
              <Power className="h-4 w-4" />
              {saving ? t('rule.savingRule') : t('rule.saveRule')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TestLine({
  icon: Icon,
  label,
  good,
  body,
}: {
  icon: LucideIcon
  label: string
  good: boolean | null
  body: string
}) {
  return (
    <div className="border border-white/8 bg-black/15 px-4 py-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center border',
            good === null
              ? 'border-white/10 bg-white/5 text-slate-300'
              : good
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                : 'border-rose-400/20 bg-rose-400/10 text-rose-200',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="mt-1 text-sm leading-6 text-slate-400">{body}</div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string
  children: ReactNode
  required?: boolean
  hint?: string
}) {
  return (
    <label className="space-y-2">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-slate-400">
        <span>{label}</span>
        {required ? <span className="text-rose-300">*</span> : null}
        {hint ? <HintToggle text={hint} /> : null}
      </div>
      {children}
    </label>
  )
}

function HintToggle({ text }: { text: string }) {
  return (
    <div className="group relative normal-case tracking-normal">
      <button
        type="button"
        onClick={(event) => event.preventDefault()}
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full border text-slate-300 transition',
          'border-white/10 bg-white/5 hover:border-cyan-300/40 hover:bg-cyan-400/12 hover:text-cyan-100',
        )}
        aria-label={i18n.t('misc.fieldHint')}
      >
        <CircleAlert className="h-3 w-3" />
      </button>
      <div className="pointer-events-none absolute left-0 top-[calc(100%+8px)] z-20 hidden w-56 border border-white/10 bg-[#0b111a] p-3 text-[12px] leading-5 text-slate-300 shadow-[0_18px_60px_rgba(0,0,0,0.45)] group-hover:block">
        {text}
      </div>
    </div>
  )
}

function Segment({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('h-10 text-sm transition', selected ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-300 hover:bg-white/6')}
    >
      {label}
    </button>
  )
}

function ToggleCard({
  checked,
  title,
  body,
  onClick,
  disabled,
}: {
  checked: boolean
  title: string
  body: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start justify-between gap-4 border border-white/8 bg-black/15 px-4 py-4 text-left disabled:opacity-50"
    >
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-1 text-sm leading-6 text-slate-400">{body}</div>
      </div>
      <div
        className={cn(
          'mt-1 h-6 w-11 border transition',
          checked ? 'border-cyan-300/40 bg-cyan-400/25' : 'border-white/10 bg-white/5',
        )}
      >
        <div className={cn('mt-0.5 h-4 w-4 bg-white transition', checked ? 'ml-6' : 'ml-1')} />
      </div>
    </button>
  )
}

function statusLabel(status: TunnelStatus) {
  switch (status) {
    case 'running':
      return i18n.t('rule.status.running')
    case 'starting':
      return i18n.t('rule.status.starting')
    case 'stopping':
      return i18n.t('rule.status.stopping')
    case 'error':
      return i18n.t('rule.status.error')
    default:
      return i18n.t('rule.status.stopped')
  }
}

function nextPort(items: TunnelRecord[]) {
  const max = items.reduce((current, item) => Math.max(current, item.localPort), 40020)
  return max + 1
}

function parsePortInput(value: string) {
  if (value.trim() === '') return ''
  const digits = value.replace(/[^\d]/g, '')
  if (!digits) return ''
  const next = Number.parseInt(digits, 10)
  return Number.isFinite(next) ? next : ''
}

function normalizeTunnelForm(form: TunnelForm): TunnelPayload | null {
  const localPort = requirePort(form.localPort, '本地端口')
  const targetPort = requirePort(form.targetPort, '目标端口')
  const sshPort = requirePort(form.sshPort, 'SSH 端口')

  return {
    ...form,
    localPort,
    targetPort,
    sshPort,
  }
}

function requirePort(value: TunnelForm['localPort'], label: string) {
  if (value === '') {
    throw new Error(i18n.t('rule.requiredPort', { label }))
  }
  return value
}

function hostKeySummary(testResult: TunnelTestResult | null) {
  if (!testResult) return i18n.t('test.notTested')
  switch (testResult.hostKeyStatus) {
    case 'skipped':
      return i18n.t('test.hostKeySummary.skipped')
    case 'trusted':
      return testResult.fingerprint
        ? i18n.t('test.hostKeySummary.trustedWithFingerprint', { fingerprint: testResult.fingerprint })
        : i18n.t('test.hostKeySummary.trusted')
    case 'unknown':
      return i18n.t('test.hostKeySummary.unknown')
    case 'mismatch':
      return i18n.t('test.hostKeySummary.mismatch')
  }
}

function targetSummary(testResult: TunnelTestResult | null) {
  if (!testResult) return i18n.t('test.notTested')
  return testResult.targetReachable
    ? i18n.t('test.targetSummary.ok')
    : i18n.t('test.targetSummary.fail')
}

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleString(i18n.resolvedLanguage?.startsWith('en') ? 'en-US' : 'zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return value
  }
}

const inputClass =
  'h-11 w-full border border-white/10 bg-white/5 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/40 focus:bg-white/[0.07]'

export default App
