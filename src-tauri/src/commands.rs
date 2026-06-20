use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    market::{PriceTrend, RewardData},
    storage::{HistoryRow, RewardSession},
    AppState,
};


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardResult {
    pub item_name: String,
    pub url_name: String,
    pub rarity: String,
    pub median_plat: Option<u32>,
    pub trend: PriceTrend,
    pub ducats: u32,
    pub vaulted: bool,
    pub is_best: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayPayload {
    pub rewards: Vec<RewardResult>,
    pub source: String,
    pub dismiss_hotkey: String,
    pub auto_dismiss_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub scan_hotkey: String,
    pub dismiss_hotkey: String,
    pub auto_dismiss_secs: u32,
    #[serde(default)]
    pub scan_delay_ms: u32,
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u32,
    #[serde(default)]
    pub dev_mode: bool,
    #[serde(default = "default_game_language")]
    pub game_language: String,
    #[serde(default)]
    pub ee_log_path: Option<String>,
    #[serde(default = "default_true")]
    pub ee_log_enabled: bool,
}

fn default_poll_interval() -> u32 { 2 }
fn default_game_language() -> String { "en".to_string() }
fn default_true() -> bool { true }

impl Default for Settings {
    fn default() -> Self {
        Self {
            scan_hotkey: "F9".into(),
            dismiss_hotkey: "F10".into(),
            auto_dismiss_secs: 15,
            scan_delay_ms: 0,
            poll_interval_secs: 2,
            dev_mode: false,
            game_language: "en".to_string(),
            ee_log_path: None,
            ee_log_enabled: true,
        }
    }
}

#[tauri::command]
pub async fn trigger_overlay(
    items: Vec<String>,
    source: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    do_trigger_overlay(items, source.unwrap_or_else(|| "log".into()), &state, &app)
        .await
        .map_err(|e| e.to_string())
}

pub async fn do_trigger_overlay(
    items: Vec<String>,
    source: String,
    state: &AppState,
    app: &AppHandle,
) -> Result<()> {
    log::info!("Triggering overlay with {} items (source: {})", items.len(), source);

    let mut translated: Vec<(String, u32, bool)> = Vec::new();
    for path in &items {
        let info = state.drops.translate(path).await;
        let (name, ducats, vaulted) = match info {
            Some(i) => (i.name, i.ducats, false),
            None => {
                let name = path.split('/').last().unwrap_or(path.as_str()).to_string();
                (name, 0, false)
            }
        };
        translated.push((name, ducats, vaulted));
    }

    if translated.is_empty() {
        return Ok(());
    }

    let market = &state.market;
    let mut futures = Vec::new();
    for (name, ducats, vaulted) in &translated {
        let m = market.clone();
        let name = name.clone();
        let ducats = *ducats;
        let vaulted = *vaulted;
        futures.push(tokio::spawn(async move {
            m.get_reward_data(&name, ducats, vaulted).await
        }));
    }

    let mut reward_data: Vec<RewardData> = Vec::new();
    for fut in futures {
        match fut.await {
            Ok(data) => reward_data.push(data),
            Err(e) => log::error!("Price fetch task failed: {}", e),
        }
    }

    let best_idx = reward_data
        .iter()
        .enumerate()
        .max_by_key(|(_, r)| {
            let plat = r.median_plat.unwrap_or(0) as f64 * 10.0;
            let vaulted_bonus = if r.vaulted { 50.0 } else { 0.0 };
            let ducat_bonus = r.ducats as f64 * 0.5;
            (plat + vaulted_bonus + ducat_bonus) as i64
        })
        .map(|(i, _)| i);

    let results: Vec<RewardResult> = reward_data
        .into_iter()
        .enumerate()
        .map(|(i, data)| RewardResult {
            item_name: data.item_name,
            url_name: data.url_name,
            rarity: String::new(),
            median_plat: data.median_plat,
            trend: data.trend,
            ducats: data.ducats,
            vaulted: data.vaulted,
            is_best: Some(i) == best_idx,
        })
        .collect();

    let rewards_json = serde_json::to_string(&results).unwrap_or_default();
    let session = RewardSession {
        session_at: Utc::now().to_rfc3339(),
        relic_name: None,
        rewards_json,
        source: source.clone(),
    };
    if let Err(e) = state.storage.record_session(&session) {
        log::error!("Failed to record session: {}", e);
    }

    crate::overlay::show(app, results.len())?;

    let (dismiss_hotkey, auto_dismiss_secs) = {
        let p = crate::app_data_dir_from_handle(app).join("settings.json");
        std::fs::read_to_string(&p)
            .ok()
            .and_then(|d| serde_json::from_str::<Settings>(&d).ok())
            .map(|s| (s.dismiss_hotkey, s.auto_dismiss_secs))
            .unwrap_or_else(|| ("F10".into(), 15))
    };
    let payload = OverlayPayload { rewards: results, source, dismiss_hotkey, auto_dismiss_secs };
    if let Some(overlay_win) = app.get_webview_window("overlay") {
        overlay_win.emit("overlay-data", &payload)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn dismiss_overlay(app: AppHandle) -> Result<(), String> {
    crate::overlay::hide(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_via_ocr(
    _state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    do_ocr_scan(&app).await.map_err(|e| e.to_string())
}

pub async fn do_ocr_scan(app: &AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    let y_min = state.ocr_y_min.load(Ordering::Relaxed) as f32 / 10_000.0;
    let dev_mode = state.dev_mode.load(Ordering::Relaxed);
    let scan_start = std::time::Instant::now();

    let lang = state.game_language.read().await.clone();
    let (items, raw_lines) = match crate::ocr::scan_rewards(&state.drops, y_min, &lang).await {
        Ok(result) => result,
        Err(e) => {
            log::error!("OCR scan failed: {e}");
            if dev_mode {
                let _ = app.emit("dev-scan", crate::screen_watcher::DevScanData {
                    ts: crate::screen_watcher::now_ms(),
                    sad_score: None,
                    sad_threshold: crate::template::REWARD_THRESHOLD,
                    template_matched: true,
                    ocr_lines: vec![format!("OCR error: {e}")],
                    items_found: vec![],
                    duration_ms: scan_start.elapsed().as_millis() as u64,
                });
            }
            crate::overlay::show(app, 1)?;
            app.emit("overlay-no-results", ())?;
            return Ok(());
        }
    };

    if dev_mode {
        let _ = app.emit("dev-scan", crate::screen_watcher::DevScanData {
            ts: crate::screen_watcher::now_ms(),
            sad_score: None,
            sad_threshold: crate::template::REWARD_THRESHOLD,
            template_matched: true,
            ocr_lines: raw_lines,
            items_found: items.clone(),
            duration_ms: scan_start.elapsed().as_millis() as u64,
        });
    }

    if items.is_empty() {
        log::info!("OCR scan: no recognizable items");
        crate::overlay::show(app, 1)?;
        app.emit("overlay-no-results", ())?;
        return Ok(());
    }

    do_trigger_overlay(items, "ocr".into(), &state, app).await
}

#[tauri::command]
pub async fn get_history(
    limit: u32,
    offset: u32,
    state: State<'_, AppState>,
) -> Result<Vec<HistoryRow>, String> {
    state
        .storage
        .get_history(limit.min(100), offset)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_pick(
    _session_id: i64,
    _item_name: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn delete_session(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    state.storage.delete_session(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    state.storage.clear_history().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let path = crate::app_data_dir_from_handle(&app).join("settings.json");
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(s) = serde_json::from_str::<Settings>(&data) {
            return Ok(s);
        }
    }
    Ok(Settings::default())
}

#[tauri::command]
pub async fn save_settings(
    settings: Settings,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    state.dev_mode.store(settings.dev_mode, Ordering::Relaxed);
    state.scan_delay_ms.store(settings.scan_delay_ms, Ordering::Relaxed);
    state.poll_interval_secs.store(settings.poll_interval_secs, Ordering::Relaxed);

    // Reload drops DB when language changes
    let old_lang = state.game_language.read().await.clone();
    if settings.game_language != old_lang {
        *state.game_language.write().await = settings.game_language.clone();
        let drops = state.drops.clone();
        let cache_dir = crate::app_data_dir_from_handle(&app).join("cache");
        let new_lang = settings.game_language.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = drops.load(&cache_dir, &new_lang).await {
                log::error!("Failed to reload drops for language '{new_lang}': {e}");
            }
        });
    }

    let settings_path = crate::app_data_dir_from_handle(&app).join("settings.json");

    // Read old log settings before overwriting so we can detect changes
    let old_settings: Option<Settings> = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|d| serde_json::from_str::<Settings>(&d).ok());
    let old_log_path = old_settings.as_ref().and_then(|s| s.ee_log_path.clone());
    let old_log_enabled = old_settings.map(|s| s.ee_log_enabled).unwrap_or(true);

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, json).map_err(|e| e.to_string())?;

    // Restart log watcher if the path or enabled flag changed
    if settings.ee_log_path != old_log_path || settings.ee_log_enabled != old_log_enabled {
        let cancel = state.log_watcher_cancel.clone();
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            cancel.store(true, Ordering::Relaxed);
            tokio::time::sleep(Duration::from_millis(700)).await;
            cancel.store(false, Ordering::Relaxed);
            crate::log_watcher::start(app2, cancel);
        });
    }

    let _ = app.emit("dev-mode", settings.dev_mode);
    crate::hotkeys::update(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restart_watcher(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    state.watcher_cancel.store(true, Ordering::Relaxed);
    state.log_watcher_cancel.store(true, Ordering::Relaxed);

    tokio::time::sleep(Duration::from_millis(700)).await;

    state.watcher_cancel.store(false, Ordering::Relaxed);
    crate::screen_watcher::start(app.clone(), state.watcher_cancel.clone());

    state.log_watcher_cancel.store(false, Ordering::Relaxed);
    crate::log_watcher::start(app, state.log_watcher_cancel.clone());

    log::info!("Watchers restarted");
    Ok(())
}

#[tauri::command]
pub async fn get_watcher_status(_app: AppHandle) -> String {
    "Active — screen monitor running (2s OCR poll while Warframe is open)".to_string()
}

#[tauri::command]
pub async fn test_overlay(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let items = vec![
        "Nova Prime Neuroptics Blueprint".to_string(),
        "Volt Prime Chassis Blueprint".to_string(),
        "Paris Prime String".to_string(),
        "Forma Blueprint".to_string(),
    ];

    do_trigger_overlay(items, "test".into(), &state, &app)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_inventory(state: State<'_, AppState>) -> Result<Vec<crate::inventory::InventoryEntry>, String> {
    crate::inventory::fetch(&state.drops)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_warframe_status() -> bool {
    crate::screen_watcher::warframe_is_running()
}

#[tauri::command]
pub fn set_ocr_threshold(pct: f32, state: tauri::State<'_, AppState>) {
    let val = (pct / 100.0 * 10_000.0).round() as u32;
    state.ocr_y_min.store(val, Ordering::Relaxed);
    log::debug!("OCR y_min set to {:.2}% (raw={val})", pct);
}

#[tauri::command]
pub async fn debug_ocr(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let y_min = state.ocr_y_min.load(Ordering::Relaxed) as f32 / 10_000.0;
    crate::ocr::raw_ocr_lines(y_min)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct FileScanResult {
    pub raw_lines: Vec<String>,
    pub matched_items: Vec<String>,
    pub db_item_count: usize,
}

#[tauri::command]
pub async fn debug_scan_file(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<FileScanResult, String> {
    let y_min = state.ocr_y_min.load(Ordering::Relaxed) as f32 / 10_000.0;
    let db_item_count = state.drops.item_count().await;
    let (matched_items, raw_lines) = crate::ocr::scan_image_file(&state.drops, &path, y_min)
        .await
        .map_err(|e| e.to_string())?;
    Ok(FileScanResult { raw_lines, matched_items, db_item_count })
}

#[tauri::command]
pub async fn debug_overlay_from_file(
    path: String,
    state: tauri::State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let y_min = state.ocr_y_min.load(Ordering::Relaxed) as f32 / 10_000.0;
    let (items, _) = crate::ocr::scan_image_file(&state.drops, &path, y_min)
        .await
        .map_err(|e| e.to_string())?;

    if items.is_empty() {
        crate::overlay::show(&app, 1).map_err(|e| e.to_string())?;
        app.emit("overlay-no-results", ()).map_err(|e| e.to_string())?;
        return Ok(());
    }

    do_trigger_overlay(items, "test".into(), &state, &app)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemLookupResult {
    pub found_in_db: bool,
    pub display_name: String,
    pub ducats: u32,
    pub median_plat: Option<u32>,
    pub trend: PriceTrend,
    pub vaulted: bool,
    pub url_name: String,
}

#[tauri::command]
pub async fn lookup_item(
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<ItemLookupResult, String> {
    let db_info = state.drops.lookup_by_name(&name).await;
    let (display_name, ducats, found_in_db) = match db_info {
        Some(info) => (info.name, info.ducats, true),
        None => (name.clone(), 0, false),
    };

    let reward = state.market.get_reward_data(&display_name, ducats, false).await;

    Ok(ItemLookupResult {
        found_in_db,
        display_name,
        ducats: reward.ducats,
        median_plat: reward.median_plat,
        trend: reward.trend,
        vaulted: reward.vaulted,
        url_name: reward.url_name,
    })
}

/// Returns the latest release tag from GitHub if it's newer than the running version,
/// or None if we're up to date (or the check fails silently).
#[tauri::command]
pub async fn check_for_updates() -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("RelicCracker/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    let resp: serde_json::Value = client
        .get("https://api.github.com/repos/Tiltann/RelicCracker/releases/latest")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let tag = resp["tag_name"].as_str()?.to_string();
    let current = format!("v{}", env!("CARGO_PKG_VERSION"));

    if tag != current { Some(tag) } else { None }
}
