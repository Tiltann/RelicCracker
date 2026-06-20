use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WfStatComponent {
    name: String,
    #[serde(rename = "uniqueName")]
    unique_name: String,
    #[serde(default)]
    ducats: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WfStatItem {
    name: String,
    #[serde(rename = "uniqueName")]
    unique_name: String,
    #[serde(default)]
    ducats: u32,
    #[serde(default)]
    components: Vec<WfStatComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemInfo {
    pub name: String,
    pub ducats: u32,
}

#[derive(Clone)]
pub struct DropDatabase {
    by_unique: Arc<RwLock<HashMap<String, ItemInfo>>>,
    by_name: Arc<RwLock<HashMap<String, ItemInfo>>>,
    pub lang: Arc<RwLock<String>>,
}

impl DropDatabase {
    pub fn new() -> Self {
        Self {
            by_unique: Arc::new(RwLock::new(HashMap::new())),
            by_name: Arc::new(RwLock::new(HashMap::new())),
            lang: Arc::new(RwLock::new("en".to_string())),
        }
    }

    pub async fn load(&self, cache_dir: &Path, lang: &str) -> Result<()> {
        *self.lang.write().await = lang.to_string();

        let url = format!(
            "https://api.warframestat.us/items?only=name,uniqueName,ducats,components&language={lang}"
        );
        let cache_path = if lang == "en" {
            cache_dir.join("wfstat_items.json")
        } else {
            cache_dir.join(format!("wfstat_items_{lang}.json"))
        };

        let client = reqwest::Client::builder()
            .user_agent("RelicCracker/0.1.0")
            .timeout(Duration::from_secs(15))
            .build()?;

        let items: Vec<WfStatItem> = if let Some(cached) = load_cache::<Vec<WfStatItem>>(&cache_path) {
            log::info!("Loaded drop items from cache (lang={lang})");
            cached
        } else {
            log::info!("Fetching drop items from warframestat.us (lang={lang})...");
            let resp = client.get(&url).send().await?.json().await?;
            if let Ok(json) = serde_json::to_string(&resp) {
                let _ = std::fs::write(&cache_path, json);
            }
            resp
        };

        let mut by_unique = self.by_unique.write().await;
        let mut by_name   = self.by_name.write().await;
        by_unique.clear();
        by_name.clear();

        for item in items {
            let info = ItemInfo { name: item.name.clone(), ducats: item.ducats };
            by_unique.insert(item.unique_name.to_lowercase(), info.clone());
            by_name.insert(item.name.to_lowercase(), info);

            for comp in &item.components {
                let full_name = format!("{} {}", item.name, comp.name);
                let comp_info = ItemInfo { name: full_name.clone(), ducats: comp.ducats };
                by_unique.insert(comp.unique_name.to_lowercase(), comp_info.clone());
                by_name.insert(full_name.to_lowercase(), comp_info);
            }
        }

        log::info!("Drop database: {} entries loaded (lang={lang}, incl. components)", by_name.len());
        Ok(())
    }

    pub async fn translate(&self, path: &str) -> Option<ItemInfo> {
        let lower = path.to_lowercase();

        {
            let guard = self.by_unique.read().await;
            if let Some(info) = guard.get(&lower) {
                return Some(info.clone());
            }
        }

        let last = lower.split('/').last().unwrap_or(&lower);
        {
            let guard = self.by_unique.read().await;
            for (key, info) in guard.iter() {
                if key.ends_with(last) {
                    return Some(info.clone());
                }
            }
        }

        self.ocr_match(last).await
    }

    pub async fn ocr_match(&self, raw: &str) -> Option<ItemInfo> {
        let text = normalize_ocr(raw);
        let lang = self.lang.read().await.clone();

        if !is_relic_reward_line(&text, &lang) {
            return None;
        }

        self.match_normalized(&text).await
    }

    async fn match_normalized(&self, text: &str) -> Option<ItemInfo> {
        let by_name = self.by_name.read().await;

        if let Some(info) = by_name.get(text) {
            log::debug!("OCR exact: {:?}", info.name);
            return Some(info.clone());
        }

        // For short items allow 2 edits, longer allow 3. Never allow > 10% of length.
        let max_dist = if text.len() <= 20 { 1usize } else { 2 };
        let mut best_dist = usize::MAX;
        let mut best: Option<ItemInfo> = None;

        for (key, info) in by_name.iter() {
            if key.len().abs_diff(text.len()) > max_dist.min(best_dist) {
                continue;
            }
            let dist = edit_distance(text, key);
            if dist < best_dist {
                best_dist = dist;
                best = Some(info.clone());
            }
        }

        if best_dist <= max_dist {
            if let Some(ref info) = best {
                log::debug!("OCR levenshtein (d={}): {:?} -> {:?}", best_dist, text, info.name);
            }
            best
        } else {
            None
        }
    }

    /// Try matching each sliding window of words from a long OCR line.
    /// Windows OCR often concatenates all item names (left, center, right card) into
    /// a single line when they sit at the same vertical band on screen.
    pub async fn ocr_match_windows(&self, raw: &str) -> Vec<ItemInfo> {
        let text = normalize_ocr(raw);
        let lang = self.lang.read().await.clone();
        let words: Vec<&str> = text.split_whitespace().collect();
        let mut results: Vec<ItemInfo> = Vec::new();

        // Try every contiguous sub-sequence of 2..=6 words
        for len in 2..=6usize {
            for start in 0..words.len().saturating_sub(len - 1) {
                let window = words[start..start + len].join(" ");
                if !is_relic_reward_line(&window, &lang) {
                    continue;
                }
                if let Some(info) = self.match_normalized(&window).await {
                    if !results.iter().any(|r: &ItemInfo| r.name == info.name) {
                        results.push(info);
                    }
                }
            }
        }
        results
    }

    pub async fn fuzzy_match(&self, raw: &str) -> Option<ItemInfo> {
        self.ocr_match(raw).await
    }

    pub async fn item_count(&self) -> usize {
        self.by_name.read().await.len()
    }

    pub async fn get_by_name(&self, name: &str) -> Option<ItemInfo> {
        let by_name = self.by_name.read().await;
        by_name.get(&name.to_lowercase()).cloned()
    }

    pub async fn lookup_by_name(&self, name: &str) -> Option<ItemInfo> {
        if let Some(info) = self.get_by_name(name).await {
            return Some(info);
        }
        self.ocr_match(name).await
    }
}

fn normalize_ocr(raw: &str) -> String {
    let s = strip_qty_prefix(raw.trim());
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();

    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn blueprint_keyword(lang: &str) -> &'static str {
    match lang {
        "de" => "bauplan",
        "fr" => "sch\u{00e9}ma",
        "es" => "plano",
        "it" => "progetto",
        "pl" => "schemat",
        "pt" => "esquema",
        _ => "blueprint",
    }
}

fn is_relic_reward_line(s: &str, lang: &str) -> bool {
    // Must be at least two words and a reasonable length
    let word_count = s.split_whitespace().count();
    if word_count < 2 || word_count > 7 { return false; }
    if s.len() < 7 || s.len() > 55 { return false; }

    let bp = blueprint_keyword(lang);
    s.contains("prime")
        || s.contains("forma")
        || s.contains("blueprint")
        || s.contains(bp)
        || s.contains("reactor")
        || s.contains("catalyst")
        || s.contains("ayatan")
        || s.contains("riven")
}

fn strip_qty_prefix(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i > 0 {
        let rest = &s[i..];
        if let Some(item) = rest.strip_prefix(" X ").or_else(|| rest.strip_prefix(" x ")) {
            return item.trim();
        }
    }
    s
}

/// Levenshtein edit distance (O(m·n) time, O(n) space — rolling two-row DP).
fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (m, n) = (a.len(), b.len());
    if m == 0 { return n; }
    if n == 0 { return m; }

    let mut prev: Vec<usize> = (0..=n).collect();
    let mut curr = vec![0usize; n + 1];

    for i in 1..=m {
        curr[0] = i;
        for j in 1..=n {
            curr[j] = if a[i - 1] == b[j - 1] {
                prev[j - 1]
            } else {
                1 + prev[j - 1].min(prev[j]).min(curr[j - 1])
            };
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[n]
}

// ── Cache helpers ──────────────────────────────────────────────────────────────

fn load_cache<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    if modified.elapsed().ok()? > CACHE_TTL {
        return None;
    }
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a DropDatabase pre-populated with the given (name, ducats) pairs.
    async fn make_db(items: &[(&str, u32)]) -> DropDatabase {
        let db = DropDatabase::new();
        {
            let mut by_name   = db.by_name.write().await;
            let mut by_unique = db.by_unique.write().await;
            for &(name, ducats) in items {
                let info = ItemInfo { name: name.to_string(), ducats };
                by_name.insert(name.to_lowercase(), info.clone());
                by_unique.insert(name.to_lowercase(), info);
            }
        }
        db
    }

    const SCREENSHOT_ITEMS: &[(&str, u32)] = &[
        ("Okina Prime Blade",     45),
        ("Forma Blueprint",        0),
        ("Kavasa Prime Buckle",   65),
        ("Velox Prime Blueprint", 15),
    ];

    // ── normalize_ocr ─────────────────────────────────────────────────────────

    #[test]
    fn normalize_plain() {
        assert_eq!(normalize_ocr("Okina Prime Blade"), "okina prime blade");
    }

    #[test]
    fn normalize_strips_qty_prefix() {
        assert_eq!(normalize_ocr("2 X Forma Blueprint"),  "forma blueprint");
        assert_eq!(normalize_ocr("10 X Forma Blueprint"), "forma blueprint");
    }

    #[test]
    fn normalize_strips_special_chars() {
        assert_eq!(normalize_ocr("Gjrud::"),          "gjrud");
        assert_eq!(normalize_ocr("Ensorrr::"),        "ensorrr");
        assert_eq!(normalize_ocr("@ Owned"),          "owned");
        // Hyphens and underscores become spaces then collapse
        let n = normalize_ocr("SaK-0-_-KaRnAgEO");
        assert!(!n.contains('-'));
        assert!(!n.contains('_'));
    }

    #[test]
    fn normalize_collapses_whitespace() {
        assert_eq!(normalize_ocr("  Kavasa   Prime   Buckle  "), "kavasa prime buckle");
    }

    // ── is_relic_reward_line ──────────────────────────────────────────────────

    #[test]
    fn reward_line_accepts_prime_items() {
        assert!(is_relic_reward_line("okina prime blade", "en"));
        assert!(is_relic_reward_line("kavasa prime buckle", "en"));
        assert!(is_relic_reward_line("velox prime blueprint", "en"));
    }

    #[test]
    fn reward_line_accepts_forma() {
        assert!(is_relic_reward_line("forma blueprint", "en"));
    }

    #[test]
    fn reward_line_rejects_player_names() {
        assert!(!is_relic_reward_line("gjrud", "en"));
        assert!(!is_relic_reward_line("ensorrr", "en"));
        // After normalization sak-0-_-karnageo has no keywords
        assert!(!is_relic_reward_line("sak 0 karnageo", "en"));
    }

    #[test]
    fn reward_line_rejects_ui_text() {
        assert!(!is_relic_reward_line("owned", "en"));
        assert!(!is_relic_reward_line("21 crafted", "en"));
        // Too many words
        assert!(!is_relic_reward_line("endless bonus affinity booster 1 relic opened", "en"));
    }

    #[test]
    fn blueprint_keyword_de() {
        assert_eq!(blueprint_keyword("de"), "bauplan");
        assert!(is_relic_reward_line("okina prime bauplan", "de"));
    }

    // ── strip_qty_prefix ──────────────────────────────────────────────────────

    #[test]
    fn strip_qty_handles_single_digit() {
        assert_eq!(strip_qty_prefix("2 X Forma Blueprint"), "Forma Blueprint");
    }

    #[test]
    fn strip_qty_handles_double_digit() {
        assert_eq!(strip_qty_prefix("10 X Forma Blueprint"), "Forma Blueprint");
    }

    #[test]
    fn strip_qty_leaves_non_prefix_alone() {
        assert_eq!(strip_qty_prefix("Forma Blueprint"), "Forma Blueprint");
        // "21 Crafted" has digits but no " X "
        assert_eq!(strip_qty_prefix("21 Crafted"), "21 Crafted");
    }

    // ── edit_distance ─────────────────────────────────────────────────────────

    #[test]
    fn edit_distance_same() {
        assert_eq!(edit_distance("prime", "prime"), 0);
    }

    #[test]
    fn edit_distance_substitution() {
        // "0kina" vs "okina" — one substitution ('0' → 'o')
        assert_eq!(edit_distance("0kina", "okina"), 1);
        // "prirne" vs "prime" — substitute 'r'→'m' AND 'n'→'e' = 2 edits
        assert_eq!(edit_distance("prirne", "prime"), 2);
    }

    #[test]
    fn edit_distance_insertion_deletion() {
        assert_eq!(edit_distance("abc", "ab"), 1);
        assert_eq!(edit_distance("ab", "abc"), 1);
    }

    #[test]
    fn edit_distance_empty() {
        assert_eq!(edit_distance("", ""), 0);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("abc", ""), 3);
    }

    // ── ocr_match (integration) ───────────────────────────────────────────────

    #[tokio::test]
    async fn ocr_match_exact_screenshot_items() {
        let db = make_db(SCREENSHOT_ITEMS).await;
        for &(name, _) in SCREENSHOT_ITEMS {
            let result = db.ocr_match(name).await;
            assert_eq!(
                result.as_ref().map(|i| i.name.as_str()),
                Some(name),
                "Expected exact match for {:?}", name
            );
        }
    }

    #[tokio::test]
    async fn ocr_match_quantity_prefix() {
        let db = make_db(SCREENSHOT_ITEMS).await;
        let r = db.ocr_match("2 X Forma Blueprint").await;
        assert_eq!(r.map(|i| i.name), Some("Forma Blueprint".to_string()));
    }

    #[tokio::test]
    async fn ocr_match_rejects_player_names() {
        let db = make_db(SCREENSHOT_ITEMS).await;
        assert!(db.ocr_match("Gjrud::").await.is_none(),          "Gjrud:: should not match");
        assert!(db.ocr_match("SaK-0-_-KaRnAgEO").await.is_none(), "player name should not match");
        assert!(db.ocr_match("Ensorrr::").await.is_none(),         "Ensorrr:: should not match");
    }

    #[tokio::test]
    async fn ocr_match_rejects_ui_strings() {
        let db = make_db(SCREENSHOT_ITEMS).await;
        assert!(db.ocr_match("@ Owned").await.is_none());
        assert!(db.ocr_match("21 Crafted").await.is_none());
        assert!(db.ocr_match("Endless Bonus Affinity Booster | 1 Relic Opened").await.is_none());
    }

    #[tokio::test]
    async fn ocr_match_levenshtein_typo() {
        let db = make_db(SCREENSHOT_ITEMS).await;
        // "0kina" → 'O' misread as '0' (1 edit)
        let r = db.ocr_match("0kina Prime Blade").await;
        assert_eq!(r.map(|i| i.name), Some("Okina Prime Blade".to_string()),
            "Should correct single OCR substitution");
    }

    #[tokio::test]
    async fn ocr_match_full_screenshot_pipeline() {
        // Simulate exactly what scan_rewards does with the user's screenshot OCR output.
        let db = make_db(SCREENSHOT_ITEMS).await;
        let ocr_lines = vec![
            "@ Owned",
            "Okina Prime Blade",
            "21 Crafted",
            "2 X Forma Blueprint",
            "Kavasa Prime Buckle",
            "Gjrud::",
            "SaK-0-_-KaRnAgEO",
            "Ensorrr::",
            "Velox Prime Blueprint",
            "Endless Bonus Affinity Booster | 1 Relic Opened",
        ];

        let mut found: Vec<String> = Vec::new();
        for line in &ocr_lines {
            if let Some(info) = db.ocr_match(line).await {
                if !found.contains(&info.name) {
                    found.push(info.name);
                }
            }
        }

        assert_eq!(found.len(), 4, "Expected 4 items, got: {:?}", found);
        assert!(found.contains(&"Okina Prime Blade".to_string()));
        assert!(found.contains(&"Forma Blueprint".to_string()));
        assert!(found.contains(&"Kavasa Prime Buckle".to_string()));
        assert!(found.contains(&"Velox Prime Blueprint".to_string()));
    }

    /// End-to-end test: run actual Windows OCR on testimage.jpg and verify all 4 rewards match.
    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn scan_real_testimage() {
        let db = make_db(SCREENSHOT_ITEMS).await;
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/testimage.jpg");

        let (matched, raw) = crate::ocr::scan_image_file(&db, path, 0.0)
            .await
            .expect("scan_image_file failed — OCR engine error");

        println!("\n=== Raw OCR lines ({}) ===", raw.len());
        for line in &raw {
            println!("  {line:?}");
        }
        println!("=== Matched ({}) ===", matched.len());
        for item in &matched {
            println!("  {item:?}");
        }

        assert_eq!(matched.len(), 4,
            "Expected 4 items but got {:?}\nRaw lines: {:#?}", matched, raw);
        assert!(matched.contains(&"Okina Prime Blade".to_string()),    "Missing Okina Prime Blade");
        assert!(matched.contains(&"Forma Blueprint".to_string()),       "Missing Forma Blueprint");
        assert!(matched.contains(&"Kavasa Prime Buckle".to_string()),   "Missing Kavasa Prime Buckle");
        assert!(matched.contains(&"Velox Prime Blueprint".to_string()), "Missing Velox Prime Blueprint");
    }
}
