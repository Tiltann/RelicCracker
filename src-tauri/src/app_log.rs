use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct LogEntry {
    pub ts: u64,
    pub level: String, // "info" | "warn" | "error"
    pub msg: String,
}

pub fn info(app: &AppHandle, msg: impl Into<String>) {
    send(app, "info", msg.into());
}

pub fn warn(app: &AppHandle, msg: impl Into<String>) {
    send(app, "warn", msg.into());
}

pub fn error(app: &AppHandle, msg: impl Into<String>) {
    send(app, "error", msg.into());
}

fn send(app: &AppHandle, level: &str, msg: String) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    match level {
        "warn"  => log::warn!("{}", msg),
        "error" => log::error!("{}", msg),
        _       => log::info!("{}", msg),
    }
    let _ = app.emit("app-log", LogEntry { ts, level: level.to_string(), msg });
}
