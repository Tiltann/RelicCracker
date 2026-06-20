export type PriceTrend = "Up" | "Down" | "Flat";

export interface RewardResult {
  item_name: string;
  url_name: string;
  rarity: string;
  median_plat: number | null;
  trend: PriceTrend;
  ducats: number;
  vaulted: boolean;
  is_best: boolean;
}

export interface OverlayPayload {
  rewards: RewardResult[];
  source: "log" | "ocr" | "manual" | "test";
  dismiss_hotkey: string;
  auto_dismiss_secs: number;
  needed_items: string[];
}

export interface LogEntry {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface PrimeSetInfo {
  name: string;
  components: string[];
}

export interface CompletionData {
  prime_sets: PrimeSetInfo[];
  wanted_sets: string[];
  owned_components: string[];
}

export interface HistoryRow {
  id: number;
  session_at: string;
  relic_name: string | null;
  rewards_json: string;
  source: string;
}

export interface Settings {
  scan_hotkey: string;
  dismiss_hotkey: string;
  auto_dismiss_secs: number;
  scan_delay_ms: number;
  poll_interval_secs: number;
  dev_mode: boolean;
  game_language: string;
  ee_log_path: string | null;
  ee_log_enabled: boolean;
  completions_enabled: boolean;
}

export interface InventoryEntry {
  name: string;
  item_type: string;
  count: number;
  ducats: number;
  category: string; // "Warframe Part" | "Weapon Part" | "Blueprint" | "Other"
  image_url: string | null;
}

export interface FileScanResult {
  raw_lines: string[];
  matched_items: string[];
  db_item_count: number;
}

export interface ItemLookupResult {
  found_in_db: boolean;
  display_name: string;
  ducats: number;
  median_plat: number | null;
  trend: PriceTrend;
  vaulted: boolean;
  url_name: string;
}

export interface DevScanEvent {
  ts: number;
  sad_score: number | null;
  sad_threshold: number;
  template_matched: boolean;
  ocr_lines: string[];
  items_found: string[];
  duration_ms: number;
}
