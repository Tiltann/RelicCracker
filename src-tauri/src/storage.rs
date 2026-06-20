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
             );",
        )?;

        *self.conn.lock().unwrap() = Some(conn);
        log::info!("Storage initialized at {:?}", db_path);
        Ok(())
    }

    pub fn record_session(&self, session: &RewardSession) -> Result<()> {
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

        Ok(())
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
