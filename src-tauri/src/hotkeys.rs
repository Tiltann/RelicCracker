use anyhow::Result;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register(app: &AppHandle) -> Result<()> {
    let (scan_key, dismiss_key) = load_keys(app);

    app.global_shortcut()
        .on_shortcut(scan_key.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = crate::commands::do_ocr_scan(&app).await {
                        log::error!("OCR scan failed: {}", e);
                    }
                });
            }
        })?;

    app.global_shortcut()
        .on_shortcut(dismiss_key.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Err(e) = crate::overlay::hide(app) {
                    log::error!("Failed to hide overlay: {}", e);
                }
            }
        })?;

    log::info!("Global shortcuts: {} (scan), {} (dismiss)", scan_key, dismiss_key);
    Ok(())
}

/// Unregister all shortcuts then re-register from current settings.
pub fn update(app: &AppHandle) -> Result<()> {
    let _ = app.global_shortcut().unregister_all();
    register(app)
}

fn load_keys(app: &AppHandle) -> (String, String) {
    let settings_path = crate::app_data_dir_from_handle(app).join("settings.json");
    if let Ok(data) = std::fs::read_to_string(&settings_path) {
        if let Ok(s) = serde_json::from_str::<crate::commands::Settings>(&data) {
            return (s.scan_hotkey, s.dismiss_hotkey);
        }
    }
    ("F9".into(), "F10".into())
}
