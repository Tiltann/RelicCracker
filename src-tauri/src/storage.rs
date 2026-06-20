use anyhow::Result;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardSession {
    pub session_at: String,
    pub relic_name: Option<String>,
    pub rewards_json: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRow {
    pub id: i64,
    pub session_at: String,
    pub relic_name: Option<String>,
    pub rewards_json: String,
    pub source: String,
}

#[derive(Clone)]
pub struct Storage {
    conn: Arc<Mutex<Option<Connection>>>,
}

impl Storage {
    pub fn new() -> Self {
        Self {
            conn: Arc::new(Mutex::new(None)),
        }
    }

    pub fn init(&self, db_path: &Path) -> Result<()> {
        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS reward_sessions (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_at  TEXT NOT NULL,
                 relic_name  TEXT,
                 rewards     TEXT NOT NULL,
                 source      TEXT NOT NULL DEFAULT 'log'
             );
             CREATE TABLE IF NOT EXISTS wanted_sets (
                 set_name    TEXT PRIMARY KEY
             );
             CREATE TABLE IF NOT EXISTS owned_components (
                 item_name   TEXT PRIMARY KEY
             );",
        )?;

        *self.conn.lock().unwrap() = Some(conn);
        log::info!("Storage initialized at {:?}", db_path);
        Ok(())
    }

    pub fn record_session(&self, session: &RewardSession) -> Result<i64> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;

        conn.execute(
            "INSERT INTO reward_sessions (session_at, relic_name, rewards, source)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session.session_at,
                session.relic_name,
                session.rewards_json,
                session.source,
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn get_wanted_sets(&self) -> Result<Vec<String>> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
        let mut stmt = conn.prepare("SELECT set_name FROM wanted_sets ORDER BY set_name")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn toggle_wanted_set(&self, name: &str) -> Result<bool> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM wanted_sets WHERE set_name = ?1",
            params![name],
            |r| r.get(0),
        )?;
        if count > 0 {
            conn.execute("DELETE FROM wanted_sets WHERE set_name = ?1", params![name])?;
            Ok(false)
        } else {
            conn.execute("INSERT INTO wanted_sets (set_name) VALUES (?1)", params![name])?;
            Ok(true)
        }
    }

    pub fn get_owned_components(&self) -> Result<Vec<String>> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
        let mut stmt = conn.prepare("SELECT item_name FROM owned_components ORDER BY item_name")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn toggle_owned_component(&self, name: &str) -> Result<bool> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM owned_components WHERE item_name = ?1",
            params![name],
            |r| r.get(0),
        )?;
        if count > 0 {
            conn.execute("DELETE FROM owned_components WHERE item_name = ?1", params![name])?;
            Ok(false)
        } else {
            conn.execute("INSERT INTO owned_components (item_name) VALUES (?1)", params![name])?;
            Ok(true)
        }
    }

    pub fn delete_session(&self, id: i64) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
        conn.execute("DELETE FROM reward_sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_history(&self) -> Result<()> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
        conn.execute("DELETE FROM reward_sessions", [])?;
        Ok(())
    }

    pub fn get_history(&self, limit: u32, offset: u32) -> Result<Vec<HistoryRow>> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;

        let mut stmt = conn.prepare(
            "SELECT id, session_at, relic_name, rewards, source
             FROM reward_sessions
             ORDER BY session_at DESC
             LIMIT ?1 OFFSET ?2",
        )?;

        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(HistoryRow {
                id: row.get(0)?,
                session_at: row.get(1)?,
                relic_name: row.get(2)?,
                rewards_json: row.get(3)?,
                source: row.get(4)?,
            })
        })?;

        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}
