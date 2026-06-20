use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

const WFM_BASE: &str = "https://api.warframe.market/v1";
const ITEMS_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const PRICE_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const TREND_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemMeta {
    pub url_name: String,
    pub thumb: String,
    pub tags: Vec<String>,
}

impl ItemMeta {
    pub fn is_vaulted(&self) -> bool {
        self.tags.iter().any(|t| t == "vaulted")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PriceTrend {
    Up,
    Down,
    Flat,
}

#[derive(Debug, Clone)]
struct CachedPrice {
    median_plat: Option<u32>,
    fetched_at: Instant,
}

#[derive(Debug, Clone)]
struct CachedTrend {
    trend: PriceTrend,
    fetched_at: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardData {
    pub item_name: String,
    pub url_name: String,
    pub median_plat: Option<u32>,
    pub trend: PriceTrend,
    pub ducats: u32,
    pub vaulted: bool,
    pub is_best: bool,
}

#[derive(Clone)]
pub struct MarketClient {
    client: reqwest::Client,
    items: Arc<RwLock<HashMap<String, ItemMeta>>>,
    price_cache: Arc<Mutex<HashMap<String, CachedPrice>>>,
    trend_cache: Arc<Mutex<HashMap<String, CachedTrend>>>,
}

// WFM API response shapes
#[derive(Deserialize)]
struct ItemsResponse {
    payload: ItemsPayload,
}
#[derive(Deserialize)]
struct ItemsPayload {
    items: Vec<WfmItem>,
}
#[derive(Deserialize)]
struct WfmItem {
    url_name: String,
    item_name: String,
    thumb: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct StatisticsResponse {
    payload: StatisticsPayload,
}
#[derive(Deserialize)]
struct StatisticsPayload {
    statistics_closed: ClosedStats,
}
#[derive(Deserialize)]
struct ClosedStats {
    #[serde(rename = "90days")]
    days90: Vec<StatPoint>,
    #[serde(rename = "48hours", default)]
    hours48: Vec<StatPoint>,
}
#[derive(Deserialize)]
struct StatPoint {
    datetime: String,
    avg_price: f64,
    #[serde(default)]
    median: f64,
}

impl MarketClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap(),
            items: Arc::new(RwLock::new(HashMap::new())),
            price_cache: Arc::new(Mutex::new(HashMap::new())),
            trend_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn load_items(&self, cache_dir: &Path) -> Result<()> {
        let cache_path = cache_dir.join("wfm_items.json");

        // Use disk cache if fresh enough
        if let Ok(meta) = std::fs::metadata(&cache_path) {
            if let Ok(modified) = meta.modified() {
                if modified.elapsed().unwrap_or(Duration::MAX) < ITEMS_CACHE_TTL {
                    if let Ok(data) = std::fs::read_to_string(&cache_path) {
                        if let Ok(map) = serde_json::from_str::<HashMap<String, ItemMeta>>(&data) {
                            *self.items.write().await = map;
                            log::info!(
                                "Loaded {} WFM items from cache",
                                self.items.read().await.len()
                            );
                            return Ok(());
                        }
                    }
                }
            }
        }

        let resp: ItemsResponse = self
            .client
            .get(format!("{WFM_BASE}/items"))
            .header("Language", "en")
            .send()
            .await?
            .json()
            .await?;

        let mut map = HashMap::new();
        for item in resp.payload.items {
            map.insert(
                canonical(&item.item_name),
                ItemMeta {
                    url_name: item.url_name,
                    thumb: item.thumb,
                    tags: item.tags,
                },
            );
        }

        if let Ok(json) = serde_json::to_string(&map) {
            let _ = std::fs::write(&cache_path, json);
        }

        let count = map.len();
        *self.items.write().await = map;
        log::info!("Loaded {} WFM items from API", count);
        Ok(())
    }

    pub async fn get_reward_data(
        &self,
        item_name: &str,
        ducats: u32,
        drops_vaulted: bool,
    ) -> RewardData {
        let items = self.items.read().await;
        let key = canonical(item_name);
        let meta = items.get(&key).cloned();
        drop(items);

        let (url_name, vaulted) = match &meta {
            Some(m) => (m.url_name.clone(), m.is_vaulted() || drops_vaulted),
            None => (slug(item_name), drops_vaulted),
        };

        let (median_plat, trend) = self.fetch_price_and_trend(&url_name).await;

        RewardData {
            item_name: item_name.to_string(),
            url_name,
            median_plat,
            trend,
            ducats,
            vaulted,
            is_best: false, // computed by caller
        }
    }

    // Single HTTP call per item returns (price, trend) together.
    async fn fetch_price_and_trend(&self, url_name: &str) -> (Option<u32>, PriceTrend) {
        // Check both caches first
        let cached_price = {
            let c = self.price_cache.lock().await;
            c.get(url_name)
                .filter(|e| e.fetched_at.elapsed() < PRICE_CACHE_TTL)
                .map(|e| e.median_plat)
        };
        let cached_trend = {
            let c = self.trend_cache.lock().await;
            c.get(url_name)
                .filter(|e| e.fetched_at.elapsed() < TREND_CACHE_TTL)
                .map(|e| e.trend.clone())
        };
        if let (Some(price), Some(trend)) = (cached_price, cached_trend) {
            return (price, trend);
        }

        match self.do_fetch_stats(url_name).await {
            Ok((price, trend)) => {
                self.price_cache.lock().await.insert(
                    url_name.to_string(),
                    CachedPrice {
                        median_plat: price,
                        fetched_at: Instant::now(),
                    },
                );
                self.trend_cache.lock().await.insert(
                    url_name.to_string(),
                    CachedTrend {
                        trend: trend.clone(),
                        fetched_at: Instant::now(),
                    },
                );
                (price, trend)
            }
            Err(e) => {
                log::warn!("WFM fetch failed for {url_name}: {e}");
                (None, PriceTrend::Flat)
            }
        }
    }

    async fn do_fetch_stats(&self, url_name: &str) -> Result<(Option<u32>, PriceTrend)> {
        let url = format!("{WFM_BASE}/items/{url_name}/statistics");
        let text = self
            .client
            .get(&url)
            .header("Accept", "application/json")
            .header("Language", "en")
            .send()
            .await?
            .text()
            .await?;

        let resp: StatisticsResponse = serde_json::from_str(&text).map_err(|e| {
            log::warn!(
                "WFM stats parse error for {url_name}: {e} body prefix: {}",
                &text[..text.len().min(120)]
            );
            e
        })?;

        // Price: prefer last 3 entries in 48h data, fall back to last 7 days
        let mut price_candidates: Vec<f64> = resp
            .payload
            .statistics_closed
            .hours48
            .iter()
            .rev()
            .take(3)
            .map(|p| {
                if p.median > 0.0 {
                    p.median
                } else {
                    p.avg_price
                }
            })
            .filter(|&v| v > 0.0)
            .collect();

        if price_candidates.is_empty() {
            price_candidates = resp
                .payload
                .statistics_closed
                .days90
                .iter()
                .rev()
                .take(7)
                .map(|p| {
                    if p.median > 0.0 {
                        p.median
                    } else {
                        p.avg_price
                    }
                })
                .filter(|&v| v > 0.0)
                .collect();
        }

        let price = if price_candidates.is_empty() {
            None
        } else {
            price_candidates.sort_by(|a, b| a.partial_cmp(b).unwrap());
            Some(price_candidates[price_candidates.len() / 2].round() as u32)
        };

        // Trend: compare recent 2 days vs 3-7 days ago from 90-day data
        let now = Utc::now();
        let mut recent: Vec<f64> = Vec::new();
        let mut older: Vec<f64> = Vec::new();
        for point in &resp.payload.statistics_closed.days90 {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&point.datetime) {
                let age = (now - dt.with_timezone(&Utc)).num_days();
                if age <= 2 {
                    recent.push(point.avg_price);
                } else if age <= 7 {
                    older.push(point.avg_price);
                }
            }
        }

        let trend = if recent.is_empty() || older.is_empty() {
            PriceTrend::Flat
        } else {
            let r = recent.iter().sum::<f64>() / recent.len() as f64;
            let o = older.iter().sum::<f64>() / older.len() as f64;
            if o == 0.0 {
                PriceTrend::Flat
            } else {
                let pct = (r - o) / o * 100.0;
                if pct > 5.0 {
                    PriceTrend::Up
                } else if pct < -5.0 {
                    PriceTrend::Down
                } else {
                    PriceTrend::Flat
                }
            }
        };

        Ok((price, trend))
    }
}

fn canonical(name: &str) -> String {
    name.to_lowercase()
}

fn slug(name: &str) -> String {
    name.to_lowercase()
        .replace(' ', "_")
        .replace(['(', ')', '\'', '.', ','], "")
}
