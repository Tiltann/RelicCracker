use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const TRIGGER_COOLDOWN_MS: u64 = 25_000;

#[derive(Clone, Serialize)]
pub struct DevScanData {
    pub ts: u64,
    pub sad_score: Option<u64>,
    pub sad_threshold: u64,
    pub template_matched: bool,
    pub ocr_lines: Vec<String>,
    pub items_found: Vec<String>,
    pub duration_ms: u64,
}

pub fn start(app: AppHandle, cancel: Arc<AtomicBool>) {
    cancel.store(false, Ordering::Relaxed);
    std::thread::spawn(move || run(app, cancel));
}

pub fn warframe_is_running() -> bool {
    warframe_running_impl()
}

fn run(app: AppHandle, cancel: Arc<AtomicBool>) {
    let last_trigger_ms: Arc<AtomicU64> = Arc::new(AtomicU64::new(0));
    let scanning: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    let mut wf_was_running: Option<bool> = None;

    log::info!("Screen watcher started");

    loop {
        let interval_secs = {
            use tauri::Manager;
            app.state::<crate::AppState>()
                .poll_interval_secs
                .load(Ordering::Relaxed)
        };
        // interval=0 means manual-only; still sleep 1s to check cancel/warframe status
        std::thread::sleep(Duration::from_secs(if interval_secs == 0 {
            1
        } else {
            interval_secs as u64
        }));

        if cancel.load(Ordering::Relaxed) {
            log::info!("Screen watcher stopped");
            break;
        }

        let wf_running = warframe_running_impl();

        if wf_was_running != Some(wf_running) {
            let _ = app.emit("warframe-status", wf_running);
            log::info!("Warframe running: {wf_running}");
            wf_was_running = Some(wf_running);
        }

        if !wf_running {
            continue;
        }

        let last = last_trigger_ms.load(Ordering::Relaxed);
        if last > 0 && now_ms().saturating_sub(last) < TRIGGER_COOLDOWN_MS {
            continue;
        }

        if scanning.load(Ordering::Relaxed) {
            continue;
        }

        // ── Template SAD check ─────────────────────────────────────────────────
        use tauri::Manager;
        let state = app.state::<crate::AppState>();
        let dev_mode = state.dev_mode.load(Ordering::Relaxed);

        if interval_secs == 0 {
            continue; // manual-only mode
        }
        let tick_start = Instant::now();

        let (sad_score, template_matched) = {
            match state.reward_template.get() {
                Some(tmpl) => {
                    let score = crate::ocr::reward_template_score(tmpl);
                    let matched = score
                        .map(|s| s < crate::template::REWARD_THRESHOLD)
                        .unwrap_or(false);
                    (score, matched)
                }
                None => (None, true), // template not yet loaded let OCR attempt
            }
        };

        if !template_matched {
            if dev_mode {
                let _ = app.emit(
                    "dev-scan",
                    DevScanData {
                        ts: now_ms(),
                        sad_score,
                        sad_threshold: crate::template::REWARD_THRESHOLD,
                        template_matched: false,
                        ocr_lines: vec![],
                        items_found: vec![],
                        duration_ms: tick_start.elapsed().as_millis() as u64,
                    },
                );
            }
            continue;
        }

        crate::app_log::info(
            &app,
            format!("Template matched (SAD={sad_score:?}), running OCR"),
        );
        scanning.store(true, Ordering::Relaxed);

        let app2 = app.clone();
        let scanning2 = scanning.clone();
        let last_trigger2 = last_trigger_ms.clone();

        tauri::async_runtime::spawn(async move {
            let state = app2.state::<crate::AppState>();

            let delay_ms = state.scan_delay_ms.load(Ordering::Relaxed);
            if delay_ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms as u64)).await;
            }

            let ocr_start = Instant::now();
            let y_min = state.ocr_y_min.load(Ordering::Relaxed) as f32 / 10_000.0;
            let lang = state.game_language.read().await.clone();
            match crate::ocr::scan_rewards(&state.drops, y_min, &lang).await {
                Ok((items, raw_lines)) => {
                    if dev_mode {
                        let _ = app2.emit(
                            "dev-scan",
                            DevScanData {
                                ts: now_ms(),
                                sad_score,
                                sad_threshold: crate::template::REWARD_THRESHOLD,
                                template_matched: true,
                                ocr_lines: raw_lines,
                                items_found: items.clone(),
                                duration_ms: ocr_start.elapsed().as_millis() as u64,
                            },
                        );
                    }
                    if items.len() >= 2 {
                        crate::app_log::info(
                            &app2,
                            format!("Screen OCR: {} items {}", items.len(), items.join(", ")),
                        );
                        if let Err(e) = crate::commands::do_trigger_overlay(
                            items,
                            "screen".into(),
                            &state,
                            &app2,
                        )
                        .await
                        {
                            log::error!("Overlay trigger failed: {e}");
                        }
                        last_trigger2.store(now_ms(), Ordering::Relaxed);
                    }
                }
                Err(e) => {
                    log::debug!("OCR: {e}");
                    if dev_mode {
                        let _ = app2.emit(
                            "dev-scan",
                            DevScanData {
                                ts: now_ms(),
                                sad_score,
                                sad_threshold: crate::template::REWARD_THRESHOLD,
                                template_matched: true,
                                ocr_lines: vec![format!("OCR error: {e}")],
                                items_found: vec![],
                                duration_ms: ocr_start.elapsed().as_millis() as u64,
                            },
                        );
                    }
                }
            }

            scanning2.store(false, Ordering::Relaxed);
        });
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(target_os = "windows")]
fn warframe_running_impl() -> bool {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
    for title in [w!("Warframe"), w!("WARFRAME")] {
        if unsafe { FindWindowW(None, title) }.is_ok() {
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn warframe_running_impl() -> bool {
    if cfg!(target_os = "linux") {
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let comm = entry.path().join("comm");
                if let Ok(name) = std::fs::read_to_string(comm) {
                    if name.trim().starts_with("Warframe") {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    true
}
