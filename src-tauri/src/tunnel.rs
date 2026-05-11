use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use reqwest::header::{ACCEPT, USER_AGENT};
use russh::keys::{self, key::PrivateKeyWithHashAlg, PublicKey};
use russh::{client, ChannelMsg, Disconnect};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::watch,
    task::JoinSet,
};
use uuid::Uuid;

const LOG_LIMIT: usize = 300;
const RELEASES_API_URL: &str = "https://api.github.com/repos/t59688/nexport/releases/latest";
const RELEASES_PAGE_URL: &str = "https://github.com/t59688/nexport/releases";
const SSH_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(15);
const SSH_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
const SSH_KEEPALIVE_MAX: usize = 3;
const SSH_HEALTHCHECK_INTERVAL: Duration = Duration::from_secs(5);
const RECONNECT_DELAY_MIN: Duration = Duration::from_secs(2);
const RECONNECT_DELAY_MAX: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<TunnelManager>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub close_to_tray: bool,
    pub launch_on_startup: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub tunnels: Vec<TunnelView>,
    pub settings: AppSettings,
    pub logs: Vec<LogEntry>,
    pub trusted_hosts: Vec<TrustedHost>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelView {
    pub id: String,
    pub name: String,
    pub bind_address: String,
    pub local_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub auth_method: AuthMethod,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub auto_start: bool,
    pub skip_host_key_check: bool,
    pub note: Option<String>,
    pub status: TunnelStatus,
    pub status_message: String,
    pub active_connections: u32,
    pub started_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelStatus {
    Stopped,
    Starting,
    Running,
    Error,
    Stopping,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostKeyStatus {
    Skipped,
    Trusted,
    Unknown,
    Mismatch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    Merge,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelDraft {
    pub id: Option<String>,
    pub name: String,
    pub bind_address: String,
    pub local_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub auth_method: AuthMethod,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub auto_start: bool,
    pub skip_host_key_check: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub level: LogLevel,
    pub scope: String,
    pub message: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHost {
    pub key: String,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub trusted_at: DateTime<Utc>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustHostPayload {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelTestResult {
    pub host_key_status: HostKeyStatus,
    pub port_available: bool,
    pub port_message: String,
    pub ssh_reachable: bool,
    pub auth_ok: bool,
    pub target_reachable: bool,
    pub message: String,
    pub fingerprint: Option<String>,
    pub expected_fingerprint: Option<String>,
    pub algorithm: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: String,
    pub published_at: Option<DateTime<Utc>>,
    pub has_update: bool,
    pub dismissed: bool,
    pub checked_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TunnelConfig {
    id: String,
    name: String,
    bind_address: String,
    local_port: u16,
    target_host: String,
    target_port: u16,
    ssh_host: String,
    ssh_port: u16,
    ssh_user: String,
    auth_method: AuthMethod,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    auto_start: bool,
    skip_host_key_check: bool,
    note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExportBundle {
    version: u8,
    exported_at: DateTime<Utc>,
    settings: AppSettings,
    tunnels: Vec<TunnelConfig>,
    trusted_hosts: Vec<TrustedHost>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpdateState {
    last_checked_at: Option<DateTime<Utc>>,
    latest_version: Option<String>,
    latest_release_url: Option<String>,
    latest_published_at: Option<DateTime<Utc>>,
    dismissed_version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubLatestRelease {
    tag_name: String,
    html_url: String,
    published_at: Option<DateTime<Utc>>,
}

impl TunnelConfig {
    fn from_draft(draft: TunnelDraft) -> Result<Self> {
        if draft.name.trim().is_empty() {
            return Err(anyhow!("瑙勫垯鍚嶇О涓嶈兘涓虹┖"));
        }
        if draft.target_host.trim().is_empty()
            || draft.ssh_host.trim().is_empty()
            || draft.ssh_user.trim().is_empty()
        {
            return Err(anyhow!("SSH host, SSH user, and target host are required"));
        }
        if draft.auth_method == AuthMethod::Password
            && draft.password.as_deref().unwrap_or("").is_empty()
        {
            return Err(anyhow!("Password authentication requires an SSH password"));
        }
        if draft.auth_method == AuthMethod::PrivateKey
            && draft.private_key_path.as_deref().unwrap_or("").is_empty()
        {
            return Err(anyhow!(
                "Private key authentication requires a private key path"
            ));
        }

        Ok(Self {
            id: draft.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: draft.name.trim().to_owned(),
            bind_address: draft.bind_address.trim().to_owned(),
            local_port: draft.local_port,
            target_host: draft.target_host.trim().to_owned(),
            target_port: draft.target_port,
            ssh_host: draft.ssh_host.trim().to_owned(),
            ssh_port: draft.ssh_port,
            ssh_user: draft.ssh_user.trim().to_owned(),
            auth_method: draft.auth_method,
            password: normalize_opt(draft.password),
            private_key_path: normalize_opt(draft.private_key_path),
            private_key_passphrase: normalize_opt(draft.private_key_passphrase),
            auto_start: draft.auto_start,
            skip_host_key_check: draft.skip_host_key_check,
            note: normalize_opt(draft.note),
        })
    }

    fn address(&self) -> String {
        format!("{}:{}", self.bind_address, self.local_port)
    }

    fn trusted_host_key(&self) -> String {
        trusted_host_key(&self.ssh_host, self.ssh_port)
    }
}

#[derive(Debug, Clone)]
struct RuntimeStatus {
    status: TunnelStatus,
    status_message: String,
    active_connections: u32,
    started_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
}

impl Default for RuntimeStatus {
    fn default() -> Self {
        Self {
            status: TunnelStatus::Stopped,
            status_message: "Idle".into(),
            active_connections: 0,
            started_at: None,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone)]
struct ObservedHostKey {
    algorithm: String,
    fingerprint: String,
}

struct ConnectOutcome {
    session: SshSession,
    observed: Option<ObservedHostKey>,
}

struct TunnelRuntime {
    shutdown_tx: watch::Sender<bool>,
    join_handle: tauri::async_runtime::JoinHandle<()>,
}

struct ManagerState {
    store_path: PathBuf,
    settings_path: PathBuf,
    trusted_hosts_path: PathBuf,
    update_state_path: PathBuf,
    configs: HashMap<String, TunnelConfig>,
    settings: AppSettings,
    trusted_hosts: HashMap<String, TrustedHost>,
    update_state: UpdateState,
    runtimes: HashMap<String, TunnelRuntime>,
    current_version: String,
}

pub struct TunnelManager {
    state: Mutex<ManagerState>,
    logs: Arc<Mutex<VecDeque<LogEntry>>>,
    runtime_status: Arc<Mutex<HashMap<String, RuntimeStatus>>>,
}

impl TunnelManager {
    pub fn bootstrap(app: AppHandle) -> Result<(Self, Vec<String>)> {
        let base_dir = app
            .path()
            .app_data_dir()
            .context("鏃犳硶瀹氫綅搴旂敤鏁版嵁鐩綍")?;
        std::fs::create_dir_all(&base_dir)?;

        let store_path = base_dir.join("tunnels.json");
        let settings_path = base_dir.join("settings.json");
        let trusted_hosts_path = base_dir.join("known_hosts.json");
        let update_state_path = base_dir.join("update-state.json");
        let configs = load_json_or_default_blocking::<Vec<TunnelConfig>>(&store_path)?;
        let settings = load_json_or_default_blocking::<AppSettings>(&settings_path)?;
        let trusted_hosts = load_json_or_default_blocking::<Vec<TrustedHost>>(&trusted_hosts_path)?;
        let update_state = load_json_or_default_blocking::<UpdateState>(&update_state_path)?;
        let logs = Arc::new(Mutex::new(VecDeque::new()));
        let runtime_status = Arc::new(Mutex::new(HashMap::new()));

        let config_map = configs
            .into_iter()
            .map(|item| (item.id.clone(), item))
            .collect::<HashMap<_, _>>();
        let auto_ids = config_map
            .values()
            .filter(|item| item.auto_start)
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();

        push_shared_log(
            &logs,
            LogLevel::Info,
            "system",
            "Application started and configuration loaded.",
        );

        Ok((
            Self {
                state: Mutex::new(ManagerState {
                    store_path,
                    settings_path,
                    trusted_hosts_path,
                    update_state_path,
                    configs: config_map,
                    settings,
                    trusted_hosts: trusted_hosts
                        .into_iter()
                        .map(|item| (item.key.clone(), item))
                        .collect(),
                    update_state,
                    runtimes: HashMap::new(),
                    current_version: app.package_info().version.to_string(),
                }),
                logs,
                runtime_status,
            },
            auto_ids,
        ))
    }

    pub async fn snapshot(&self) -> Result<AppSnapshot, String> {
        let (configs, settings, trusted_hosts) = {
            let state = lock(&self.state);
            (
                state.configs.values().cloned().collect::<Vec<_>>(),
                state.settings.clone(),
                state.trusted_hosts.values().cloned().collect::<Vec<_>>(),
            )
        };
        let runtime = lock(&self.runtime_status);
        let logs = lock(&self.logs);

        let mut tunnels = configs
            .iter()
            .map(|config| {
                let status = runtime.get(&config.id).cloned().unwrap_or_default();
                TunnelView {
                    id: config.id.clone(),
                    name: config.name.clone(),
                    bind_address: config.bind_address.clone(),
                    local_port: config.local_port,
                    target_host: config.target_host.clone(),
                    target_port: config.target_port,
                    ssh_host: config.ssh_host.clone(),
                    ssh_port: config.ssh_port,
                    ssh_user: config.ssh_user.clone(),
                    auth_method: config.auth_method,
                    password: config.password.clone(),
                    private_key_path: config.private_key_path.clone(),
                    private_key_passphrase: config.private_key_passphrase.clone(),
                    auto_start: config.auto_start,
                    skip_host_key_check: config.skip_host_key_check,
                    note: config.note.clone(),
                    status: status.status,
                    status_message: status.status_message,
                    active_connections: status.active_connections,
                    started_at: status.started_at,
                    last_error: status.last_error,
                }
            })
            .collect::<Vec<_>>();

        tunnels.sort_by(|a, b| {
            a.local_port
                .cmp(&b.local_port)
                .then_with(|| a.name.cmp(&b.name))
        });

        let mut trusted_hosts = trusted_hosts;
        trusted_hosts.sort_by(|a, b| a.host.cmp(&b.host).then_with(|| a.port.cmp(&b.port)));

        Ok(AppSnapshot {
            tunnels,
            settings,
            logs: logs.iter().cloned().collect(),
            trusted_hosts,
        })
    }

    pub async fn save_tunnel(&self, payload: TunnelDraft) -> Result<AppSnapshot, String> {
        let config = TunnelConfig::from_draft(payload).map_err(|err| err.to_string())?;
        let (should_restart, id, message, persist_path, persist_payload) = {
            let mut state = lock(&self.state);
            validate_unique_bind(&state.configs, &config).map_err(to_string)?;

            let should_restart = state.runtimes.contains_key(&config.id);
            let id = config.id.clone();
            let message = if state.configs.contains_key(&config.id) {
                format!("Rule '{}' updated.", config.name)
            } else {
                format!("Rule '{}' created.", config.name)
            };

            state.configs.insert(config.id.clone(), config);

            (
                should_restart,
                id,
                message,
                state.store_path.clone(),
                serialize_pretty(&state.configs.values().cloned().collect::<Vec<_>>())
                    .map_err(to_string)?,
            )
        };

        fs::write(persist_path, persist_payload)
            .await
            .map_err(to_string)?;
        self.push_log(LogLevel::Info, "rule", &message);

        if should_restart {
            self.stop_tunnel(&id).await?;
            self.start_tunnel(&id).await?;
        }

        self.snapshot().await
    }

    pub async fn delete_tunnel(&self, id: &str) -> Result<AppSnapshot, String> {
        if self.has_runtime(id) {
            self.stop_tunnel(id).await?;
        }

        let (removed_name, persist_path, persist_payload) = {
            let mut state = lock(&self.state);
            let removed_name = state.configs.remove(id).map(|item| item.name);
            (
                removed_name,
                state.store_path.clone(),
                serialize_pretty(&state.configs.values().cloned().collect::<Vec<_>>())
                    .map_err(to_string)?,
            )
        };
        lock(&self.runtime_status).remove(id);
        fs::write(persist_path, persist_payload)
            .await
            .map_err(to_string)?;

        if let Some(name) = removed_name {
            self.push_log(LogLevel::Info, "rule", &format!("Rule '{}' deleted.", name));
        }

        self.snapshot().await
    }

    pub async fn start_tunnel(&self, id: &str) -> Result<AppSnapshot, String> {
        if self.has_runtime(id) || self.is_tunnel_busy(id) {
            return self.snapshot().await;
        }

        let (config, trusted_hosts) = {
            let state = lock(&self.state);
            (
                state
                    .configs
                    .get(id)
                    .cloned()
                    .ok_or_else(|| "Tunnel rule not found".to_owned())?,
                state.trusted_hosts.clone(),
            )
        };

        // Mark startup before preflight so repeated clicks cannot create duplicate workers.
        self.set_status(
            id,
            RuntimeStatus {
                status: TunnelStatus::Starting,
                status_message: format!("Binding {}", config.address()),
                active_connections: 0,
                started_at: None,
                last_error: None,
            },
        );

        let preflight = self
            .test_config_with_hosts(&config, trusted_hosts.clone())
            .await;
        if !preflight.port_available
            || preflight.host_key_status == HostKeyStatus::Unknown
            || preflight.host_key_status == HostKeyStatus::Mismatch
            || !preflight.auth_ok
        {
            self.set_status(
                id,
                RuntimeStatus {
                    status: TunnelStatus::Error,
                    status_message: preflight.message.clone(),
                    active_connections: 0,
                    started_at: None,
                    last_error: Some(preflight.message.clone()),
                },
            );
            self.push_log(
                LogLevel::Warn,
                "tunnel",
                &format!(
                    "Rule '{}' failed preflight: {}",
                    config.name, preflight.message
                ),
            );
            return self.snapshot().await;
        }

        let status_map = Arc::clone(&self.runtime_status);
        let log_store = Arc::clone(&self.logs);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let join_handle = tauri::async_runtime::spawn(run_tunnel(
            config.clone(),
            status_map,
            log_store,
            trusted_hosts,
            shutdown_rx,
        ));

        {
            let mut state = lock(&self.state);
            if state.runtimes.contains_key(id) {
                let _ = shutdown_tx.send(true);
            } else {
                state.runtimes.insert(
                    id.to_owned(),
                    TunnelRuntime {
                        shutdown_tx,
                        join_handle,
                    },
                );
            }
        }

        self.push_log(
            LogLevel::Info,
            "tunnel",
            &format!("Rule '{}' entered startup flow.", config.name),
        );

        self.snapshot().await
    }

    pub async fn stop_tunnel(&self, id: &str) -> Result<AppSnapshot, String> {
        let runtime = {
            let mut state = lock(&self.state);
            state.runtimes.remove(id)
        };

        if let Some(runtime) = runtime {
            self.set_status(
                id,
                RuntimeStatus {
                    status: TunnelStatus::Stopping,
                    status_message: "Stopping listener".into(),
                    active_connections: 0,
                    started_at: None,
                    last_error: None,
                },
            );

            let _ = runtime.shutdown_tx.send(true);
            let _ = runtime.join_handle.await;
            self.set_status(id, RuntimeStatus::default());

            if let Some(config_name) = self.get_tunnel_name(id) {
                self.push_log(
                    LogLevel::Info,
                    "tunnel",
                    &format!("Rule '{}' stopped.", config_name),
                );
            }
        }

        self.snapshot().await
    }

    pub async fn start_all(&self) -> Result<AppSnapshot, String> {
        let ids = {
            let state = lock(&self.state);
            state.configs.keys().cloned().collect::<Vec<_>>()
        };
        for id in ids {
            let _ = self.start_tunnel(&id).await;
        }
        self.push_log(LogLevel::Info, "batch", "Started all rules.");
        self.snapshot().await
    }

    pub async fn stop_all(&self) -> Result<AppSnapshot, String> {
        let ids = {
            let state = lock(&self.state);
            state.runtimes.keys().cloned().collect::<Vec<_>>()
        };
        for id in ids {
            let _ = self.stop_tunnel(&id).await;
        }
        self.push_log(LogLevel::Info, "batch", "Stopped all rules.");
        self.snapshot().await
    }

    pub async fn update_settings(&self, payload: AppSettings) -> Result<AppSnapshot, String> {
        let (persist_path, persist_payload) = {
            let mut state = lock(&self.state);
            state.settings = payload;
            (
                state.settings_path.clone(),
                serialize_pretty(&state.settings).map_err(to_string)?,
            )
        };
        fs::write(persist_path, persist_payload)
            .await
            .map_err(to_string)?;
        self.push_log(LogLevel::Info, "settings", "Settings updated.");
        self.snapshot().await
    }

    pub async fn clear_logs(&self) -> Result<AppSnapshot, String> {
        lock(&self.logs).clear();
        self.push_log(LogLevel::Info, "log", "Logs cleared.");
        self.snapshot().await
    }

    pub async fn test_tunnel(&self, payload: TunnelDraft) -> Result<TunnelTestResult, String> {
        let config = TunnelConfig::from_draft(payload).map_err(|err| err.to_string())?;
        let trusted_hosts = {
            let state = lock(&self.state);
            state.trusted_hosts.clone()
        };
        let result = self.test_config_with_hosts(&config, trusted_hosts).await;
        self.push_log(
            match result.host_key_status {
                HostKeyStatus::Mismatch => LogLevel::Warn,
                _ if result.auth_ok && result.target_reachable => LogLevel::Info,
                _ => LogLevel::Warn,
            },
            "test",
            &format!("Tested rule '{}': {}", config.name, result.message),
        );
        Ok(result)
    }

    pub async fn trust_host_key(&self, payload: TrustHostPayload) -> Result<AppSnapshot, String> {
        let key = trusted_host_key(&payload.host, payload.port);
        let (persist_path, persist_payload) = {
            let mut state = lock(&self.state);
            state.trusted_hosts.insert(
                key.clone(),
                TrustedHost {
                    key,
                    host: payload.host,
                    port: payload.port,
                    algorithm: payload.algorithm,
                    fingerprint: payload.fingerprint,
                    trusted_at: Utc::now(),
                    note: normalize_opt(payload.note),
                },
            );
            (
                state.trusted_hosts_path.clone(),
                serialize_pretty(&state.trusted_hosts.values().cloned().collect::<Vec<_>>())
                    .map_err(to_string)?,
            )
        };
        fs::write(persist_path, persist_payload)
            .await
            .map_err(to_string)?;
        self.push_log(LogLevel::Info, "hostkey", "Trusted host fingerprint saved.");
        self.snapshot().await
    }

    pub async fn remove_trusted_host(&self, key: &str) -> Result<AppSnapshot, String> {
        let (persist_path, persist_payload) = {
            let mut state = lock(&self.state);
            state.trusted_hosts.remove(key);
            (
                state.trusted_hosts_path.clone(),
                serialize_pretty(&state.trusted_hosts.values().cloned().collect::<Vec<_>>())
                    .map_err(to_string)?,
            )
        };
        fs::write(persist_path, persist_payload)
            .await
            .map_err(to_string)?;
        self.push_log(
            LogLevel::Info,
            "hostkey",
            "Trusted host fingerprint removed.",
        );
        self.snapshot().await
    }

    pub async fn export_rules(&self, path: &str) -> Result<ExportResult, String> {
        let bundle = {
            let state = lock(&self.state);
            ExportBundle {
                version: 1,
                exported_at: Utc::now(),
                settings: state.settings.clone(),
                tunnels: state.configs.values().cloned().collect(),
                trusted_hosts: state.trusted_hosts.values().cloned().collect(),
            }
        };

        let payload = serialize_pretty(&bundle).map_err(to_string)?;
        fs::write(path, payload).await.map_err(to_string)?;
        self.push_log(
            LogLevel::Info,
            "io",
            &format!("Rules exported to {}.", path),
        );

        Ok(ExportResult {
            path: path.to_owned(),
        })
    }

    pub async fn import_rules(&self, path: &str, mode: ImportMode) -> Result<AppSnapshot, String> {
        let payload = fs::read(path).await.map_err(to_string)?;
        let bundle = serde_json::from_slice::<ExportBundle>(&payload).map_err(to_string)?;

        if matches!(mode, ImportMode::Replace) {
            let runtime_ids = {
                let state = lock(&self.state);
                state.runtimes.keys().cloned().collect::<Vec<_>>()
            };
            for id in runtime_ids {
                let _ = self.stop_tunnel(&id).await;
            }
        }

        let (
            config_path,
            config_payload,
            settings_path,
            settings_payload,
            trusted_path,
            trusted_payload,
        ) = {
            let mut state = lock(&self.state);

            if matches!(mode, ImportMode::Replace) {
                state.configs.clear();
                state.trusted_hosts.clear();
            }

            let mut merged_configs = state.configs.clone();
            for config in bundle.tunnels {
                validate_unique_bind(&merged_configs, &config).map_err(to_string)?;
                merged_configs.insert(config.id.clone(), config);
            }
            state.configs = merged_configs;

            for host in bundle.trusted_hosts {
                state.trusted_hosts.insert(host.key.clone(), host);
            }

            state.settings = bundle.settings;
            (
                state.store_path.clone(),
                serialize_pretty(&state.configs.values().cloned().collect::<Vec<_>>())
                    .map_err(to_string)?,
                state.settings_path.clone(),
                serialize_pretty(&state.settings).map_err(to_string)?,
                state.trusted_hosts_path.clone(),
                serialize_pretty(&state.trusted_hosts.values().cloned().collect::<Vec<_>>())
                    .map_err(to_string)?,
            )
        };
        fs::write(config_path, config_payload)
            .await
            .map_err(to_string)?;
        fs::write(settings_path, settings_payload)
            .await
            .map_err(to_string)?;
        fs::write(trusted_path, trusted_payload)
            .await
            .map_err(to_string)?;
        self.push_log(LogLevel::Info, "io", "Rules imported.");

        self.snapshot().await
    }

    pub fn close_to_tray(&self) -> bool {
        lock(&self.state).settings.close_to_tray
    }

    pub async fn check_for_updates(&self) -> Result<UpdateCheckResult, String> {
        let current_version = {
            let state = lock(&self.state);
            state.current_version.clone()
        };

        let client = reqwest::Client::builder().build().map_err(to_string)?;
        let response = client
            .get(RELEASES_API_URL)
            .header(USER_AGENT, format!("NexPort/{}", current_version))
            .header(ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(to_string)?;
        let response = response.error_for_status().map_err(to_string)?;
        let release = response
            .json::<GithubLatestRelease>()
            .await
            .map_err(to_string)?;

        let checked_at = Utc::now();
        let latest_version = normalize_version(&release.tag_name);
        let has_update = is_newer_version(&latest_version, &current_version);

        let (update_state_path, update_state_payload, dismissed) = {
            let mut state = lock(&self.state);
            state.update_state.last_checked_at = Some(checked_at);
            state.update_state.latest_version = Some(latest_version.clone());
            state.update_state.latest_release_url = Some(release.html_url.clone());
            state.update_state.latest_published_at = release.published_at;
            if state.update_state.dismissed_version.as_deref() == Some(latest_version.as_str())
                && !has_update
            {
                state.update_state.dismissed_version = None;
            }
            let dismissed = has_update
                && state.update_state.dismissed_version.as_deref() == Some(latest_version.as_str());
            (
                state.update_state_path.clone(),
                serialize_pretty(&state.update_state).map_err(to_string)?,
                dismissed,
            )
        };

        fs::write(update_state_path, update_state_payload)
            .await
            .map_err(to_string)?;

        if has_update {
            self.push_log(
                LogLevel::Info,
                "update",
                &format!(
                    "Update available: latest {}, current {}.",
                    latest_version, current_version
                ),
            );
        }

        Ok(UpdateCheckResult {
            current_version,
            latest_version: Some(latest_version),
            release_url: release.html_url,
            published_at: release.published_at,
            has_update,
            dismissed,
            checked_at,
        })
    }

    pub async fn dismiss_update(&self, version: String) -> Result<UpdateCheckResult, String> {
        let normalized = normalize_version(&version);
        let (update_state_path, update_state_payload, result) = {
            let mut state = lock(&self.state);
            state.update_state.dismissed_version = Some(normalized.clone());
            let result = update_result_from_state(&state, true);
            (
                state.update_state_path.clone(),
                serialize_pretty(&state.update_state).map_err(to_string)?,
                result,
            )
        };

        fs::write(update_state_path, update_state_payload)
            .await
            .map_err(to_string)?;
        self.push_log(
            LogLevel::Info,
            "update",
            &format!("Dismissed update reminder for version {}.", normalized),
        );
        Ok(result)
    }

    pub fn cached_update_state(&self) -> UpdateCheckResult {
        let state = lock(&self.state);
        update_result_from_state(&state, false)
    }

    async fn test_config_with_hosts(
        &self,
        config: &TunnelConfig,
        trusted_hosts: HashMap<String, TrustedHost>,
    ) -> TunnelTestResult {
        let port_available = check_bind_available(&config.bind_address, config.local_port)
            .await
            .is_ok();
        let port_message = if port_available {
            format!(
                "{}:{} is available for listening.",
                config.bind_address, config.local_port
            )
        } else {
            format!(
                "{}:{} is already in use or cannot be bound.",
                config.bind_address, config.local_port
            )
        };

        match SshSession::connect(config, trusted_hosts).await {
            Ok(mut outcome) => {
                let target_reachable = outcome
                    .session
                    .probe_target(&config.target_host, config.target_port)
                    .await
                    .is_ok();

                let observed = outcome.observed.take();
                let _ = outcome.session.close().await;

                TunnelTestResult {
                    host_key_status: if config.skip_host_key_check {
                        HostKeyStatus::Skipped
                    } else {
                        HostKeyStatus::Trusted
                    },
                    port_available,
                    port_message,
                    ssh_reachable: true,
                    auth_ok: true,
                    target_reachable,
                    message: if target_reachable {
                        "SSH reachable, authentication succeeded, and target is reachable.".into()
                    } else {
                        "SSH reachable and authentication succeeded, but target is unreachable."
                            .into()
                    },
                    fingerprint: observed.as_ref().map(|item| item.fingerprint.clone()),
                    expected_fingerprint: observed.as_ref().map(|item| item.fingerprint.clone()),
                    algorithm: observed.map(|item| item.algorithm),
                }
            }
            Err(error) => match parse_hostkey_error(&error.to_string()) {
                Some(host_error) => TunnelTestResult {
                    host_key_status: host_error.status,
                    port_available,
                    port_message,
                    ssh_reachable: true,
                    auth_ok: false,
                    target_reachable: false,
                    message: host_error.message,
                    fingerprint: Some(host_error.actual_fingerprint),
                    expected_fingerprint: host_error.expected_fingerprint,
                    algorithm: Some(host_error.algorithm),
                },
                None => TunnelTestResult {
                    host_key_status: if config.skip_host_key_check {
                        HostKeyStatus::Skipped
                    } else {
                        HostKeyStatus::Trusted
                    },
                    port_available,
                    port_message,
                    ssh_reachable: false,
                    auth_ok: false,
                    target_reachable: false,
                    message: error.to_string(),
                    fingerprint: None,
                    expected_fingerprint: None,
                    algorithm: None,
                },
            },
        }
    }

    fn has_runtime(&self, id: &str) -> bool {
        lock(&self.state).runtimes.contains_key(id)
    }

    fn is_tunnel_busy(&self, id: &str) -> bool {
        matches!(
            lock(&self.runtime_status)
                .get(id)
                .map(|status| status.status),
            Some(TunnelStatus::Starting | TunnelStatus::Running | TunnelStatus::Stopping)
        )
    }

    fn get_tunnel_name(&self, id: &str) -> Option<String> {
        lock(&self.state)
            .configs
            .get(id)
            .map(|config| config.name.clone())
    }

    fn set_status(&self, id: &str, next: RuntimeStatus) {
        lock(&self.runtime_status).insert(id.to_owned(), next);
    }

    pub fn push_log(&self, level: LogLevel, scope: &str, message: &str) {
        push_shared_log(&self.logs, level, scope, message);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn to_string<E: ToString>(error: E) -> String {
    error.to_string()
}

fn serialize_pretty<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec_pretty(value)?)
}

fn validate_unique_bind(
    configs: &HashMap<String, TunnelConfig>,
    next: &TunnelConfig,
) -> Result<()> {
    let conflict = configs.values().find(|item| {
        item.id != next.id
            && item.bind_address == next.bind_address
            && item.local_port == next.local_port
    });

    if let Some(item) = conflict {
        return Err(anyhow!(
            "Local listener {}:{} is already used by rule '{}'.",
            next.bind_address,
            next.local_port,
            item.name
        ));
    }

    Ok(())
}

fn load_json_or_default_blocking<T>(path: &Path) -> Result<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }

    let payload = std::fs::read(path)?;
    if payload.is_empty() {
        return Ok(T::default());
    }

    Ok(serde_json::from_slice(&payload)?)
}

fn push_shared_log(
    logs: &Arc<Mutex<VecDeque<LogEntry>>>,
    level: LogLevel,
    scope: &str,
    message: &str,
) {
    let mut guard = lock(logs);
    guard.push_front(LogEntry {
        id: Uuid::new_v4().to_string(),
        level,
        scope: scope.to_owned(),
        message: message.to_owned(),
        timestamp: Utc::now(),
    });
    while guard.len() > LOG_LIMIT {
        guard.pop_back();
    }
}

async fn check_bind_available(bind_address: &str, local_port: u16) -> Result<()> {
    let listener = TcpListener::bind((bind_address, local_port)).await?;
    drop(listener);
    Ok(())
}

async fn run_tunnel(
    config: TunnelConfig,
    statuses: Arc<Mutex<HashMap<String, RuntimeStatus>>>,
    logs: Arc<Mutex<VecDeque<LogEntry>>>,
    trusted_hosts: HashMap<String, TrustedHost>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let result = async {
        let listener = TcpListener::bind(config.address())
            .await
            .context("Failed to bind local listener")?;
        let mut reconnect_attempt = 0u32;

        push_shared_log(
            &logs,
            LogLevel::Info,
            "tunnel",
            &format!("Rule '{}' listener is ready.", config.name),
        );

        loop {
            if *shutdown_rx.borrow() {
                break;
            }

            update_reconnect_status(&statuses, &config, reconnect_attempt, None);

            let ssh = match SshSession::connect(&config, trusted_hosts.clone()).await {
                Ok(outcome) => {
                    reconnect_attempt = 0;
                    Arc::new(outcome.session)
                }
                Err(error) => {
                    let message = error.to_string();
                    let delay = reconnect_delay(reconnect_attempt);
                    update_reconnect_status(
                        &statuses,
                        &config,
                        reconnect_attempt,
                        Some(message.clone()),
                    );
                    push_shared_log(
                        &logs,
                        LogLevel::Warn,
                        "tunnel",
                        &format!(
                            "Rule '{}' failed to connect to SSH; retrying in {}: {}",
                            config.name,
                            format_duration(delay),
                            message
                        ),
                    );
                    reconnect_attempt = reconnect_attempt.saturating_add(1);
                    if wait_for_shutdown_or_timeout(&mut shutdown_rx, delay).await {
                        break;
                    }
                    continue;
                }
            };

            {
                let mut map = lock(&statuses);
                map.insert(
                    config.id.clone(),
                    RuntimeStatus {
                        status: TunnelStatus::Running,
                        status_message: format!(
                            "{} -> {}:{}",
                            config.address(),
                            config.target_host,
                            config.target_port
                        ),
                        active_connections: 0,
                        started_at: Some(Utc::now()),
                        last_error: None,
                    },
                );
            }

            push_shared_log(
                &logs,
                LogLevel::Info,
                "tunnel",
                &format!("Rule '{}' connected and is serving traffic.", config.name),
            );

            let mut connections = JoinSet::new();
            let mut healthcheck = tokio::time::interval(SSH_HEALTHCHECK_INTERVAL);
            healthcheck.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            let mut reconnect_reason = None::<String>;

            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_ok() && *shutdown_rx.borrow() {
                            break;
                        }
                    }
                    _ = healthcheck.tick() => {
                        if ssh.is_closed() {
                            reconnect_reason = Some("SSH session closed".to_owned());
                            break;
                        }
                    }
                    accept_result = listener.accept() => {
                        let (socket, remote_addr) = accept_result?;
                        bump_connections(&statuses, &config.id, 1);

                        let ssh = Arc::clone(&ssh);
                        let statuses = Arc::clone(&statuses);
                        let logs = Arc::clone(&logs);
                        let tunnel_id = config.id.clone();
                        let tunnel_name = config.name.clone();
                        let target_host = config.target_host.clone();
                        let target_port = config.target_port;

                        connections.spawn(async move {
                            let outcome = ssh.call(socket, remote_addr, &target_host, target_port).await;
                            if let Err(error) = outcome {
                                let mut map = lock(&statuses);
                                let entry = map.entry(tunnel_id.clone()).or_default();
                                entry.last_error = Some(error.to_string());
                                entry.status_message = "Latest connection failed".into();
                                drop(map);

                                push_shared_log(
                                    &logs,
                                    LogLevel::Warn,
                                    "proxy",
                                    &format!("Rule '{}' forwarding failed: {}", tunnel_name, error),
                                );
                            }
                            bump_connections(&statuses, &tunnel_id, -1);
                        });
                    }
                    joined = connections.join_next(), if !connections.is_empty() => {
                        if let Some(Err(join_error)) = joined {
                            push_shared_log(
                                &logs,
                                LogLevel::Warn,
                                "proxy",
                                &format!(
                                    "Rule '{}' connection task exited unexpectedly: {}",
                                    config.name,
                                    join_error
                                ),
                            );
                        }
                    }
                }
            }

            let _ = ssh.close().await;
            while let Some(joined) = connections.join_next().await {
                if let Err(join_error) = joined {
                    push_shared_log(
                        &logs,
                        LogLevel::Warn,
                        "proxy",
                        &format!(
                            "Rule '{}' connection task exited unexpectedly: {}",
                            config.name,
                            join_error
                        ),
                    );
                }
            }

            if *shutdown_rx.borrow() {
                break;
            }

            let reason = reconnect_reason.unwrap_or_else(|| "SSH session needs to be rebuilt".to_owned());
            let delay = reconnect_delay(reconnect_attempt);
            update_reconnect_status(
                &statuses,
                &config,
                reconnect_attempt,
                Some(reason.clone()),
            );
            push_shared_log(
                &logs,
                LogLevel::Warn,
                "tunnel",
                &format!(
                    "Rule '{}' disconnected; retrying in {}: {}",
                    config.name,
                    format_duration(delay),
                    reason
                ),
            );
            reconnect_attempt = reconnect_attempt.saturating_add(1);
            if wait_for_shutdown_or_timeout(&mut shutdown_rx, delay).await {
                break;
            }
        }

        Result::<()>::Ok(())
    }
    .await;

    if let Err(error) = result {
        let mut map = lock(&statuses);
        map.insert(
            config.id.clone(),
            RuntimeStatus {
                status: TunnelStatus::Error,
                status_message: "Tunnel stopped unexpectedly".into(),
                active_connections: 0,
                started_at: None,
                last_error: Some(error.to_string()),
            },
        );
        drop(map);

        push_shared_log(
            &logs,
            LogLevel::Error,
            "tunnel",
            &format!("Rule '{}' stopped unexpectedly: {}", config.name, error),
        );
    }
}

fn bump_connections(statuses: &Arc<Mutex<HashMap<String, RuntimeStatus>>>, id: &str, delta: i32) {
    let mut map = lock(statuses);
    let entry = map.entry(id.to_owned()).or_default();
    if delta.is_negative() {
        entry.active_connections = entry
            .active_connections
            .saturating_sub(delta.unsigned_abs());
    } else {
        entry.active_connections = entry.active_connections.saturating_add(delta as u32);
    }
}

fn update_reconnect_status(
    statuses: &Arc<Mutex<HashMap<String, RuntimeStatus>>>,
    config: &TunnelConfig,
    reconnect_attempt: u32,
    last_error: Option<String>,
) {
    let status_message = if reconnect_attempt == 0 {
        format!("Connecting to SSH {}", config.ssh_host)
    } else {
        format!(
            "SSH disconnected, reconnect attempt {} to {}",
            reconnect_attempt + 1,
            config.ssh_host
        )
    };

    lock(statuses).insert(
        config.id.clone(),
        RuntimeStatus {
            status: TunnelStatus::Starting,
            status_message,
            active_connections: 0,
            started_at: None,
            last_error,
        },
    );
}

fn reconnect_delay(attempt: u32) -> Duration {
    let shift = attempt.min(4);
    let factor = 1u64 << shift;
    let secs = (RECONNECT_DELAY_MIN.as_secs() * factor).min(RECONNECT_DELAY_MAX.as_secs());
    Duration::from_secs(secs)
}

fn format_duration(duration: Duration) -> String {
    if duration.as_secs() <= 1 {
        "1s".to_owned()
    } else {
        format!("{}s", duration.as_secs())
    }
}

async fn wait_for_shutdown_or_timeout(
    shutdown_rx: &mut watch::Receiver<bool>,
    delay: Duration,
) -> bool {
    tokio::select! {
        changed = shutdown_rx.changed() => changed.is_ok() && *shutdown_rx.borrow(),
        _ = tokio::time::sleep(delay) => false,
    }
}

struct SshSession {
    handle: client::Handle<ClientHandler>,
}

impl SshSession {
    async fn connect(
        config: &TunnelConfig,
        trusted_hosts: HashMap<String, TrustedHost>,
    ) -> Result<ConnectOutcome> {
        let observed = Arc::new(Mutex::new(None::<ObservedHostKey>));
        let client_config = Arc::new(client::Config {
            inactivity_timeout: Some(SSH_INACTIVITY_TIMEOUT),
            keepalive_interval: Some(SSH_KEEPALIVE_INTERVAL),
            keepalive_max: SSH_KEEPALIVE_MAX,
            nodelay: true,
            ..Default::default()
        });
        let trusted = trusted_hosts.get(&config.trusted_host_key()).cloned();
        let handler = ClientHandler {
            accept_any_host_key: config.skip_host_key_check,
            trusted_host: trusted,
            observed: Arc::clone(&observed),
        };

        let mut session = client::connect(
            client_config,
            (config.ssh_host.as_str(), config.ssh_port),
            handler,
        )
        .await
        .context("Failed to connect to SSH server")?;

        match config.auth_method {
            AuthMethod::Password => {
                let auth = session
                    .authenticate_password(
                        config.ssh_user.as_str(),
                        config.password.as_deref().unwrap_or_default(),
                    )
                    .await
                    .context("SSH password authentication failed")?;

                if !auth.success() {
                    return Err(anyhow!(
                        "SSH password authentication was rejected by the server"
                    ));
                }
            }
            AuthMethod::PrivateKey => {
                let path = expand_home(config.private_key_path.as_deref().unwrap_or_default());
                let key = keys::load_secret_key(&path, config.private_key_passphrase.as_deref())
                    .with_context(|| format!("Failed to read private key: {}", path.display()))?;

                let auth = session
                    .authenticate_publickey(
                        config.ssh_user.as_str(),
                        PrivateKeyWithHashAlg::new(
                            Arc::new(key),
                            session.best_supported_rsa_hash().await?.flatten(),
                        ),
                    )
                    .await
                    .context("SSH private key authentication failed")?;

                if !auth.success() {
                    return Err(anyhow!(
                        "SSH private key authentication was rejected by the server"
                    ));
                }
            }
        }

        let observed_host = lock(&observed).clone();
        Ok(ConnectOutcome {
            session: Self { handle: session },
            observed: observed_host,
        })
    }

    async fn call(
        &self,
        mut stream: TcpStream,
        originator_addr: SocketAddr,
        target_host: &str,
        target_port: u16,
    ) -> Result<()> {
        let mut channel = self
            .handle
            .channel_open_direct_tcpip(
                target_host.to_owned(),
                target_port.into(),
                originator_addr.ip().to_string(),
                originator_addr.port().into(),
            )
            .await
            .context("Failed to open SSH direct-tcpip channel")?;

        let mut stream_closed = false;
        let mut buf = vec![0u8; 65536];

        loop {
            tokio::select! {
              read = stream.read(&mut buf), if !stream_closed => {
                match read {
                  Ok(0) => {
                    stream_closed = true;
                    channel.eof().await?;
                  }
                  Ok(size) => channel.data(&buf[..size]).await?,
                  Err(error) => return Err(error.into()),
                }
              }
              maybe_msg = channel.wait() => {
                match maybe_msg {
                  Some(ChannelMsg::Data { data }) => stream.write_all(&data).await?,
                  Some(ChannelMsg::Eof) => {
                    if !stream_closed {
                      channel.eof().await?;
                    }
                    break;
                  }
                  Some(ChannelMsg::ExitStatus { .. } | ChannelMsg::WindowAdjusted { .. } | ChannelMsg::Success) => {}
                  Some(_) => {}
                  None => break,
                }
              }
            }
        }

        let _ = channel.close().await;
        Ok(())
    }

    async fn probe_target(&self, target_host: &str, target_port: u16) -> Result<()> {
        let channel = self
            .handle
            .channel_open_direct_tcpip(
                target_host.to_owned(),
                target_port.into(),
                "127.0.0.1".to_owned(),
                0,
            )
            .await
            .context("Target port is unreachable")?;
        let _ = channel.eof().await;
        let _ = channel.close().await;
        Ok(())
    }

    fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    async fn close(&self) -> Result<()> {
        self.handle
            .disconnect(Disconnect::ByApplication, "shutdown", "zh-CN")
            .await?;
        Ok(())
    }
}

#[derive(Clone)]
struct ClientHandler {
    accept_any_host_key: bool,
    trusted_host: Option<TrustedHost>,
    observed: Arc<Mutex<Option<ObservedHostKey>>>,
}

impl client::Handler for ClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let algorithm = server_public_key.algorithm().to_string();
        let fingerprint = server_public_key
            .fingerprint(Default::default())
            .to_string();
        *lock(&self.observed) = Some(ObservedHostKey {
            algorithm: algorithm.clone(),
            fingerprint: fingerprint.clone(),
        });

        if self.accept_any_host_key {
            return Ok(true);
        }

        match &self.trusted_host {
            Some(entry) if entry.fingerprint == fingerprint => Ok(true),
            Some(entry) => Err(anyhow!(
                "HOSTKEY|mismatch|{}|{}|{}",
                algorithm,
                fingerprint,
                entry.fingerprint
            )),
            None => Err(anyhow!("HOSTKEY|unknown|{}|{}|", algorithm, fingerprint)),
        }
    }
}

struct HostKeyError {
    status: HostKeyStatus,
    algorithm: String,
    actual_fingerprint: String,
    expected_fingerprint: Option<String>,
    message: String,
}

fn parse_hostkey_error(raw: &str) -> Option<HostKeyError> {
    let parts = raw.split('|').collect::<Vec<_>>();
    if parts.len() < 4 || parts.first().copied() != Some("HOSTKEY") {
        return None;
    }

    let status = match parts.get(1).copied()? {
        "unknown" => HostKeyStatus::Unknown,
        "mismatch" => HostKeyStatus::Mismatch,
        _ => return None,
    };

    let algorithm = parts.get(2)?.to_string();
    let actual_fingerprint = parts.get(3)?.to_string();
    let expected_fingerprint = parts
        .get(4)
        .map(|item| item.to_string())
        .filter(|item| !item.is_empty());

    let message = match status {
        HostKeyStatus::Unknown => {
            format!(
                "First time seeing this SSH host fingerprint. Please review and trust it first: {}",
                actual_fingerprint
            )
        }
        HostKeyStatus::Mismatch => {
            format!(
                "SSH host fingerprint does not match the trusted record. Current: {}, trusted: {}",
                actual_fingerprint,
                expected_fingerprint.clone().unwrap_or_default()
            )
        }
        _ => return None,
    };

    Some(HostKeyError {
        status,
        algorithm,
        actual_fingerprint,
        expected_fingerprint,
        message,
    })
}

fn normalize_opt(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

fn trusted_host_key(host: &str, port: u16) -> String {
    format!("{}:{}", host.trim().to_lowercase(), port)
}

fn expand_home(raw: &str) -> PathBuf {
    if let Some(stripped) = raw.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            return PathBuf::from(home).join(stripped);
        }
    }

    PathBuf::from(raw)
}

fn normalize_version(raw: &str) -> String {
    raw.trim().trim_start_matches(['v', 'V']).to_owned()
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let normalized_latest = normalize_version(latest);
    let normalized_current = normalize_version(current);
    let latest = Version::parse(&normalized_latest);
    let current = Version::parse(&normalized_current);
    match (latest, current) {
        (Ok(latest), Ok(current)) => latest > current,
        _ => normalized_latest != normalized_current,
    }
}

fn update_result_from_state(state: &ManagerState, dismissed_override: bool) -> UpdateCheckResult {
    let latest_version = state.update_state.latest_version.clone();
    let has_update = latest_version
        .as_deref()
        .map(|latest| is_newer_version(latest, &state.current_version))
        .unwrap_or(false);
    let dismissed = if dismissed_override {
        true
    } else {
        has_update
            && latest_version
                .as_deref()
                .zip(state.update_state.dismissed_version.as_deref())
                .map(|(latest, dismissed)| latest == dismissed)
                .unwrap_or(false)
    };

    UpdateCheckResult {
        current_version: state.current_version.clone(),
        latest_version,
        release_url: state
            .update_state
            .latest_release_url
            .clone()
            .unwrap_or_else(|| RELEASES_PAGE_URL.to_owned()),
        published_at: state.update_state.latest_published_at,
        has_update,
        dismissed,
        checked_at: state.update_state.last_checked_at.unwrap_or_else(Utc::now),
    }
}
