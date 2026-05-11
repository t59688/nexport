mod tunnel;

use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tunnel::{
    AppSettings, AppState, ImportMode, TrustHostPayload, TunnelDraft, TunnelManager,
    UpdateCheckResult,
};

const TRAY_SHOW: &str = "tray-show";
const TRAY_START_ALL: &str = "tray-start-all";
const TRAY_STOP_ALL: &str = "tray-stop-all";
const TRAY_QUIT: &str = "tray-quit";
const APP_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

#[tauri::command]
async fn bootstrap(state: tauri::State<'_, AppState>) -> Result<tunnel::AppSnapshot, String> {
    state.manager.snapshot().await
}

#[tauri::command]
async fn save_tunnel(
    state: tauri::State<'_, AppState>,
    payload: TunnelDraft,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.save_tunnel(payload).await
}

#[tauri::command]
async fn delete_tunnel(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.delete_tunnel(&id).await
}

#[tauri::command]
async fn start_tunnel(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.start_tunnel(&id).await
}

#[tauri::command]
async fn stop_tunnel(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.stop_tunnel(&id).await
}

#[tauri::command]
async fn start_all(state: tauri::State<'_, AppState>) -> Result<tunnel::AppSnapshot, String> {
    state.manager.start_all().await
}

#[tauri::command]
async fn stop_all(state: tauri::State<'_, AppState>) -> Result<tunnel::AppSnapshot, String> {
    state.manager.stop_all().await
}

#[tauri::command]
async fn update_settings(
    state: tauri::State<'_, AppState>,
    payload: AppSettings,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.update_settings(payload).await
}

#[tauri::command]
async fn clear_logs(state: tauri::State<'_, AppState>) -> Result<tunnel::AppSnapshot, String> {
    state.manager.clear_logs().await
}

#[tauri::command]
async fn test_tunnel(
    state: tauri::State<'_, AppState>,
    payload: TunnelDraft,
) -> Result<tunnel::TunnelTestResult, String> {
    state.manager.test_tunnel(payload).await
}

#[tauri::command]
async fn trust_host_key(
    state: tauri::State<'_, AppState>,
    payload: TrustHostPayload,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.trust_host_key(payload).await
}

#[tauri::command]
async fn remove_trusted_host(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.remove_trusted_host(&key).await
}

#[tauri::command]
async fn export_rules(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<tunnel::ExportResult, String> {
    state.manager.export_rules(&path).await
}

#[tauri::command]
async fn import_rules(
    state: tauri::State<'_, AppState>,
    path: String,
    mode: ImportMode,
) -> Result<tunnel::AppSnapshot, String> {
    state.manager.import_rules(&path, mode).await
}

#[tauri::command]
async fn check_for_updates(state: tauri::State<'_, AppState>) -> Result<UpdateCheckResult, String> {
    state.manager.check_for_updates().await
}

#[tauri::command]
fn get_update_state(state: tauri::State<'_, AppState>) -> UpdateCheckResult {
    state.manager.cached_update_state()
}

#[tauri::command]
async fn dismiss_update(
    state: tauri::State<'_, AppState>,
    version: String,
) -> Result<UpdateCheckResult, String> {
    state.manager.dismiss_update(version).await
}

#[tauri::command]
fn open_release_page(url: String) -> Result<(), String> {
    webbrowser::open(&url)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let (runtime, auto_ids) = TunnelManager::bootstrap(handle)?;
            app.manage(AppState {
                manager: Arc::new(runtime),
            });

            let window_icon = load_icon(APP_ICON_BYTES)?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(window_icon)?;
            }

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            app.handle().plugin(tauri_plugin_dialog::init())?;
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;

            setup_tray(app)?;

            if let Some(state) = app.try_state::<AppState>() {
                let manager = state.inner().manager.clone();
                tauri::async_runtime::spawn(async move {
                    for id in auto_ids {
                        let _ = manager.start_tunnel(&id).await;
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if state.manager.close_to_tray() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            save_tunnel,
            delete_tunnel,
            start_tunnel,
            stop_tunnel,
            start_all,
            stop_all,
            update_settings,
            clear_logs,
            test_tunnel,
            trust_host_key,
            remove_trusted_host,
            export_rules,
            import_rules,
            check_for_updates,
            get_update_state,
            dismiss_update,
            open_release_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW, "打开控制台", true, None::<&str>)?;
    let start_all_item = MenuItem::with_id(app, TRAY_START_ALL, "启动全部", true, None::<&str>)?;
    let stop_all_item = MenuItem::with_id(app, TRAY_STOP_ALL, "停止全部", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show_item, &start_all_item, &stop_all_item, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("NexPort");
    builder = builder.icon(load_icon(TRAY_ICON_BYTES)?);

    builder
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            TRAY_START_ALL => {
                if let Some(state) = app.try_state::<AppState>() {
                    let state = state.inner().manager.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = state.start_all().await;
                    });
                }
            }
            TRAY_STOP_ALL => {
                if let Some(state) = app.try_state::<AppState>() {
                    let state = state.inner().manager.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = state.stop_all().await;
                    });
                }
            }
            TRAY_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn load_icon(bytes: &[u8]) -> tauri::Result<Image<'static>> {
    let image = image::load_from_memory(bytes).map_err(anyhow::Error::new)?;
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), width, height))
}
