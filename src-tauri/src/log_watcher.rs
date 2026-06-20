use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct DevLogEvent {
    ts: u64,
    kind: &'static str,
    text: String,
}

fn emit_dev_event(app: &AppHandle, kind: &'static str, text: impl Into<String>) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let _ = app.emit(
        "log-watcher-event",
        DevLogEvent {
            ts,
            kind,
            text: text.into(),
        },
    );
}

const TRIGGER_PATTERN: &str = "OpenVoidProjectionRewardScreenRMI";
const REWARD_PATTERN: &str = "gets reward /Lotus";
const COLLECT_TIMEOUT: Duration = Duration::from_millis(2000);
const DEBOUNCE_SECS: Duration = Duration::from_secs(30);
const POLL_TIMEOUT: Duration = Duration::from_millis(500);

struct WatcherState {
    collecting: bool,
    rewards: Vec<String>,
    collect_start: Option<Instant>,
    last_trigger: Option<Instant>,
}

impl WatcherState {
    fn new() -> Self {
        Self {
            collecting: false,
            rewards: Vec::new(),
            collect_start: None,
            last_trigger: None,
        }
    }

    fn reset(&mut self) {
        self.collecting = false;
        self.rewards.clear();
        self.collect_start = None;
    }
}

pub fn start(app: AppHandle, cancel: Arc<AtomicBool>) {
    cancel.store(false, Ordering::Relaxed);
    std::thread::spawn(move || {
        if let Err(e) = run_watcher(app, cancel) {
            log::error!("EE.log watcher stopped: {}", e);
        }
    });
}

fn run_watcher(app: AppHandle, cancel: Arc<AtomicBool>) -> anyhow::Result<()> {
    let enabled = {
        let p = crate::app_data_dir_from_handle(&app).join("settings.json");
        std::fs::read_to_string(&p)
            .ok()
            .and_then(|d| serde_json::from_str::<crate::commands::Settings>(&d).ok())
            .map(|s| s.ee_log_enabled)
            .unwrap_or(true)
    };
    if !enabled {
        emit_dev_event(&app, "state", "EE.log watcher disabled in settings");
        log::info!("EE.log watcher disabled in settings");
        return Ok(());
    }

    let log_path = ee_log_path(&app);

    if !log_path.exists() {
        emit_dev_event(
            &app,
            "state",
            format!("File not found: {}", log_path.display()),
        );
        log::warn!(
            "EE.log not found at {}. Watcher disabled; use Ctrl+Shift+Space or fix path in Settings.",
            log_path.display()
        );
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let _ = tx.send(res);
        },
        Config::default(),
    )?;
    watcher.watch(&log_path, RecursiveMode::NonRecursive)?;

    // Start at end of file don't replay old data
    let mut read_pos: u64 = {
        let mut f = std::fs::File::open(&log_path)?;
        f.seek(SeekFrom::End(0))?
    };

    let mut state = WatcherState::new();
    log::info!("EE.log watcher started: {}", log_path.display());
    emit_dev_event(&app, "state", format!("Watching: {}", log_path.display()));

    loop {
        if cancel.load(Ordering::Relaxed) {
            log::info!("EE.log watcher cancelled");
            break;
        }

        match rx.recv_timeout(POLL_TIMEOUT) {
            Ok(Ok(_event)) => {
                if let Some(lines) = read_new_lines(&log_path, &mut read_pos, &app) {
                    process_lines(&lines, &mut state, &app);
                }
            }
            Ok(Err(e)) => log::warn!("Watch event error: {:?}", e),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                flush_if_timed_out(&mut state, &app);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        flush_if_timed_out(&mut state, &app);
    }

    Ok(())
}

fn read_new_lines(path: &PathBuf, pos: &mut u64, app: &AppHandle) -> Option<Vec<String>> {
    let file = std::fs::File::open(path).ok()?;
    let file_size = file.metadata().ok()?.len();

    if file_size < *pos {
        *pos = 0; // file was truncated (new session)
        emit_dev_event(app, "state", "File reset new Warframe session");
    }

    if file_size == *pos {
        return None;
    }

    let mut reader = BufReader::new(file);
    reader.seek(SeekFrom::Start(*pos)).ok()?;

    let mut lines = Vec::new();
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end().to_string();
                if !trimmed.is_empty() {
                    lines.push(trimmed);
                }
            }
            Err(_) => break,
        }
    }

    *pos = reader.stream_position().unwrap_or(*pos);

    if lines.is_empty() {
        None
    } else {
        Some(lines)
    }
}

fn process_lines(lines: &[String], state: &mut WatcherState, app: &AppHandle) {
    for line in lines {
        // Surface any potentially relevant line to the dev monitor
        if line.contains(TRIGGER_PATTERN)
            || line.contains("VoidProjections")
            || line.contains("ProjectionRewardChoice")
        {
            emit_dev_event(app, "line", line.trim());
        }

        if line.contains(TRIGGER_PATTERN) {
            if let Some(last) = state.last_trigger {
                if last.elapsed() < DEBOUNCE_SECS {
                    emit_dev_event(
                        app,
                        "debounce",
                        format!(
                            "Debounced ({:.0}s since last need {}s gap)",
                            last.elapsed().as_secs_f32(),
                            DEBOUNCE_SECS.as_secs()
                        ),
                    );
                    continue;
                }
            }
            emit_dev_event(app, "trigger", "Trigger matched starting collection");
            crate::app_log::info(app, "EE.log: reward screen detected");
            state.last_trigger = Some(Instant::now());
            state.collecting = true;
            state.rewards.clear();
            state.collect_start = Some(Instant::now());
            continue;
        }

        if !state.collecting {
            continue;
        }

        if let Some(start) = state.collect_start {
            if start.elapsed() > COLLECT_TIMEOUT {
                if !state.rewards.is_empty() {
                    emit_rewards(state, app);
                }
                state.reset();
                continue;
            }
        }

        if let Some(path) = extract_reward_path(line) {
            emit_dev_event(app, "reward", &path);
            state.rewards.push(path);
            if state.rewards.len() >= 4 {
                emit_rewards(state, app);
                state.reset();
            }
        }
    }
}

fn flush_if_timed_out(state: &mut WatcherState, app: &AppHandle) {
    if state.collecting {
        if let Some(start) = state.collect_start {
            if start.elapsed() > COLLECT_TIMEOUT && !state.rewards.is_empty() {
                emit_rewards(state, app);
                state.reset();
            }
        }
    }
}

fn extract_reward_path(line: &str) -> Option<String> {
    // Format: "VoidProjections: {id} gets reward /Lotus/StoreItems/..."
    let after = line.split_once("gets reward ")?.1;
    let path = after.split_whitespace().next()?;
    if path.starts_with('/') {
        Some(path.to_string())
    } else {
        None
    }
}

fn emit_rewards(state: &WatcherState, app: &AppHandle) {
    emit_dev_event(
        app,
        "flush",
        format!("Flushed {} reward(s) → overlay", state.rewards.len()),
    );
    let rewards = state.rewards.clone();
    crate::app_log::info(app, format!("EE.log: {} rewards found", rewards.len()));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        let app_state = app.state::<crate::AppState>();
        if let Err(e) =
            crate::commands::do_trigger_overlay(rewards, "log".into(), &app_state, &app).await
        {
            log::error!("Overlay trigger failed: {}", e);
        }
    });
}

/// Returns the EE.log path: settings override → auto-detect via Windows API.
pub fn ee_log_path(app: &AppHandle) -> PathBuf {
    if std::env::var("RELICCRACKER_TEST_LOG").as_deref() == Ok("1") {
        return PathBuf::from("test_ee.log");
    }

    // Check saved settings for a user-provided path
    let settings_path = crate::app_data_dir_from_handle(app).join("settings.json");
    if let Ok(data) = std::fs::read_to_string(&settings_path) {
        if let Ok(s) = serde_json::from_str::<crate::commands::Settings>(&data) {
            if let Some(p) = s.ee_log_path.filter(|p| !p.is_empty()) {
                return PathBuf::from(p);
            }
        }
    }

    default_ee_log_path()
}

pub fn default_ee_log_path() -> PathBuf {
    default_ee_log_path_impl()
}

#[cfg(target_os = "windows")]
fn default_ee_log_path_impl() -> PathBuf {
    let local = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("C:/Users/Public/AppData/Local"));
    // Current Warframe: %LOCALAPPDATA%\Warframe\EE.log
    // Older installs used: %LOCALAPPDATA%\Temp\Warframe\EE.log
    let primary = local.join("Warframe/EE.log");
    if primary.exists() {
        return primary;
    }
    let legacy = local.join("Temp/Warframe/EE.log");
    if legacy.exists() {
        return legacy;
    }
    primary
}

#[cfg(target_os = "linux")]
fn default_ee_log_path_impl() -> PathBuf {
    // Warframe on Linux runs through Steam/Proton. The EE.log lives inside the
    // Proton prefix for app ID 230410.
    const WARFRAME_ID: &str = "230410";
    const PROTON_SUFFIX: &str = "pfx/drive_c/users/steamuser/AppData/Local/Temp/Warframe/EE.log";

    if let Some(home) = dirs::home_dir() {
        for steam_root in [
            home.join(".local/share/Steam"),
            home.join(".steam/steam"),
            home.join(".steam/root"),
        ] {
            let p = steam_root
                .join("steamapps/compatdata")
                .join(WARFRAME_ID)
                .join(PROTON_SUFFIX);
            if p.exists() {
                return p;
            }
        }
        // Not found return the most common path as a placeholder so the user
        // knows where to look.
        return home
            .join(".local/share/Steam/steamapps/compatdata")
            .join(WARFRAME_ID)
            .join(PROTON_SUFFIX);
    }
    PathBuf::from(format!(
        "/home/user/.local/share/Steam/steamapps/compatdata/{WARFRAME_ID}/{PROTON_SUFFIX}"
    ))
}

#[cfg(target_os = "macos")]
fn default_ee_log_path_impl() -> PathBuf {
    // Warframe doesn't officially support macOS. Crossover/Wine users need to
    // set this path manually.
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/Users/user"))
        .join("Library/Application Support/CrossOver/Bottles/Steam/drive_c/users/crossover/AppData/Local/Temp/Warframe/EE.log")
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn default_ee_log_path_impl() -> PathBuf {
    PathBuf::from("EE.log")
}
