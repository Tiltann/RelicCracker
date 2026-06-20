pub mod commands;
pub mod drops;
pub mod hotkeys;
pub mod inventory;
pub mod log_watcher;
pub mod market;
pub mod ocr;
pub mod overlay;
pub mod screen_watcher;
pub mod storage;
pub mod template;

use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, AtomicU32, Ordering}, Arc, OnceLock};
use tauri::Manager;

pub const OCR_Y_MIN_DEFAULT: u32 =
    (template::TMPL_Y + template::TMPL_H) * 10_000 / template::REF_H;

pub struct AppState {
    pub market: market::MarketClient,
    pub drops: drops::DropDatabase,
    pub storage: storage::Storage,
    pub watcher_cancel: Arc<AtomicBool>,
    pub log_watcher_cancel: Arc<AtomicBool>,
    pub reward_template: Arc<OnceLock<template::RewardTemplate>>,
    pub dev_mode: Arc<AtomicBool>,
    pub ocr_y_min: Arc<AtomicU32>,
    pub scan_delay_ms: Arc<AtomicU32>,
    pub poll_interval_secs: Arc<AtomicU32>,
    pub game_language: Arc<tokio::sync::RwLock<String>>,
    /// Timestamp of the last auto-triggered overlay (log or ocr). Used to
    /// deduplicate when both sources fire for the same relic crack.
    pub last_auto_trigger: Arc<std::sync::Mutex<Option<std::time::Instant>>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            market: market::MarketClient::new(),
            drops: drops::DropDatabase::new(),
            storage: storage::Storage::new(),
            watcher_cancel: Arc::new(AtomicBool::new(false)),
            log_watcher_cancel: Arc::new(AtomicBool::new(false)),
            reward_template: Arc::new(OnceLock::new()),
            dev_mode: Arc::new(AtomicBool::new(false)),
            ocr_y_min: Arc::new(AtomicU32::new(OCR_Y_MIN_DEFAULT)),
            scan_delay_ms: Arc::new(AtomicU32::new(0)),
            poll_interval_secs: Arc::new(AtomicU32::new(2)),
            game_language: Arc::new(tokio::sync::RwLock::new("en".to_string())),
            last_auto_trigger: Arc::new(std::sync::Mutex::new(None)),
        }
    }
}

pub fn app_data_dir(app: &tauri::App) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn app_data_dir_from_handle(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn init_logging() {
    use simplelog::*;

    // Always write to a rotating log file next to the app data dir.
    // The file is overwritten each launch so it never grows unbounded.
    let log_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("RelicCracker");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("reliccracker.log");

    let level = if cfg!(debug_assertions) { LevelFilter::Debug } else { LevelFilter::Info };
    let config = ConfigBuilder::new()
        .set_time_format_rfc3339()
        .build();

    let file = std::fs::File::create(&log_path).ok();
    let mut loggers: Vec<Box<dyn SharedLogger>> = vec![
        TermLogger::new(level, config.clone(), TerminalMode::Mixed, ColorChoice::Auto),
    ];
    if let Some(f) = file {
        loggers.push(WriteLogger::new(level, config, f));
    }
    let _ = CombinedLogger::init(loggers);

    log::info!("RelicCracker starting — log: {}", log_path.display());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::trigger_overlay,
            commands::dismiss_overlay,
            commands::scan_via_ocr,
            commands::get_history,
            commands::delete_session,
            commands::clear_history,
            commands::record_pick,
            commands::get_settings,
            commands::save_settings,
            commands::restart_watcher,
            commands::get_watcher_status,
            commands::test_overlay,
            commands::get_inventory,
            commands::debug_ocr,
            commands::get_warframe_status,
            commands::set_ocr_threshold,
            commands::debug_scan_file,
            commands::debug_overlay_from_file,
            commands::lookup_item,
            commands::check_for_updates,
        ])
        .setup(|app| {
            let data_dir = app_data_dir(app);
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(data_dir.join("cache"))?;

            let db_path = data_dir.join("history.db");
            let state = app.state::<AppState>();
            state.storage.init(&db_path)?;

            let init_lang = if let Ok(data) = std::fs::read_to_string(data_dir.join("settings.json")) {
                if let Ok(s) = serde_json::from_str::<commands::Settings>(&data) {
                    state.dev_mode.store(s.dev_mode, Ordering::Relaxed);
                    state.scan_delay_ms.store(s.scan_delay_ms, Ordering::Relaxed);
                    state.poll_interval_secs.store(s.poll_interval_secs, Ordering::Relaxed);
                    s.game_language
                } else { "en".to_string() }
            } else { "en".to_string() };

            {
                let mut lang = state.game_language.blocking_write();
                *lang = init_lang.clone();
            }

            let market = state.market.clone();
            let drops = state.drops.clone();
            let cache_dir = data_dir.join("cache");
            let tmpl_slot = state.reward_template.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = drops.load(&cache_dir, &init_lang).await {
                    log::error!("Failed to load drop database: {e}");
                }
                if let Err(e) = market.load_items(&cache_dir).await {
                    log::error!("Failed to load market items: {e}");
                }
                let tmpl_path = cache_dir.join("reward_template.png");
                match template::ensure(&tmpl_path).await {
                    Ok(()) => match template::load(&tmpl_path) {
                        Ok(t) => { let _ = tmpl_slot.set(t); log::info!("Reward template loaded"); }
                        Err(e) => log::error!("Template load: {e}"),
                    },
                    Err(e) => log::error!("Template download: {e}"),
                }
            });

            let app_handle = app.handle().clone();
            let cancel = state.watcher_cancel.clone();
            screen_watcher::start(app_handle.clone(), cancel);

            let log_cancel = state.log_watcher_cancel.clone();
            log_watcher::start(app_handle, log_cancel);

            hotkeys::register(app.handle())?;
            setup_tray(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &mut tauri::App) -> anyhow::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let scan_key = {
        let p = app_data_dir(app).join("settings.json");
        std::fs::read_to_string(&p)
            .ok()
            .and_then(|d| serde_json::from_str::<commands::Settings>(&d).ok())
            .map(|s| s.scan_hotkey)
            .unwrap_or_else(|| "F9".into())
    };
    let scan_item = MenuItem::with_id(app, "scan", format!("Scan Now ({})", scan_key), true, None::<&str>)?;
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Show Dashboard", true, None::<&str>)?;
    let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit RelicCracker", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&scan_item, &dashboard_item, &sep, &quit_item])?;

    let mut builder = TrayIconBuilder::new().menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let _tray = builder
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "scan" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = commands::do_ocr_scan(&app).await {
                        log::error!("Tray scan failed: {}", e);
                    }
                });
            }
            "dashboard" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}
