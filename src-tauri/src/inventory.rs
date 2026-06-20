use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

const AUTHZ_PATTERN: &[u8] = b"?accountId=";
const ACCOUNT_ID_LEN: usize = 24;
const NONCE_PREFIX: &[u8] = b"&nonce=";
const AUTHZ_CONFIDENCE: usize = 3;
const INVENTORY_URL: &str = "https://mobile.warframe.com/api/inventory.php";
const CHUNK_SIZE: usize = 1 << 20; // 1 MiB

#[derive(Deserialize)]
struct RawItem {
    #[serde(rename = "ItemType")]
    item_type: String,
    #[serde(rename = "ItemCount", default = "default_one")]
    item_count: u32,
}

fn default_one() -> u32 { 1 }

#[derive(Deserialize)]
struct RawInventory {
    #[serde(rename = "MiscItems", default)]
    misc_items: Vec<RawItem>,
    #[serde(rename = "Recipes", default)]
    recipes: Vec<RawItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryEntry {
    pub name: String,
    pub item_type: String,
    pub count: u32,
    pub ducats: u32,
    pub category: String, // "Part" | "Blueprint" | "Other"
    pub image_url: Option<String>,
}

pub async fn fetch(drops: &crate::drops::DropDatabase) -> Result<Vec<InventoryEntry>> {
    let pid = find_warframe()?;
    let authz = scan_authz(pid)?;

    let url = format!("{}{}", INVENTORY_URL, authz);
    let resp = reqwest::Client::builder()
        .user_agent("RelicCracker/0.1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()?
        .get(&url)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(anyhow!("Inventory API returned {}", resp.status()));
    }

    let raw: RawInventory = resp.json().await?;

    let mut entries: Vec<InventoryEntry> = Vec::new();

    for item in raw.misc_items.iter() {
        if let Some(entry) = resolve(drops, &item.item_type, item.item_count, false).await {
            entries.push(entry);
        }
    }
    for item in raw.recipes.iter() {
        if let Some(entry) = resolve(drops, &item.item_type, item.item_count, true).await {
            entries.push(entry);
        }
    }

    // Sort: ducats desc, then name asc
    entries.sort_by(|a, b| b.ducats.cmp(&a.ducats).then(a.name.cmp(&b.name)));
    Ok(entries)
}

fn cdn_image_url(unique_name: &str) -> Option<String> {
    let seg = unique_name.split('/').filter(|s| !s.is_empty()).last()?;
    let mut chars = seg.chars();
    let first = chars.next()?.to_lowercase().to_string();
    let rest: String = chars.collect();
    Some(format!("https://cdn.warframestat.us/img/{}{}.png", first, rest))
}

fn derive_category(name: &str, is_recipe: bool) -> String {
    if is_recipe {
        return "Blueprint".into();
    }
    let n = name.to_ascii_lowercase();
    const WF_PARTS: &[&str] = &[
        "neuroptics", "chassis", "systems", "carapace", "wings",
        "cerebrum", "harness", "helmet",
    ];
    const WEAPON_PARTS: &[&str] = &[
        "blade", "barrel", "stock", "receiver", "handle", "hilt",
        "string", "grip", "guard", "link", "plate", "gauntlet",
        "boot", "ornament", "heatsink", "bracket", "disc",
    ];
    if WF_PARTS.iter().any(|kw| n.contains(kw)) {
        return "Warframe Part".into();
    }
    if WEAPON_PARTS.iter().any(|kw| n.contains(kw)) {
        return "Weapon Part".into();
    }
    "Other".into()
}

async fn resolve(
    drops: &crate::drops::DropDatabase,
    item_type: &str,
    count: u32,
    is_recipe: bool,
) -> Option<InventoryEntry> {
    let info = drops.translate(item_type).await?;
    let category = derive_category(&info.name, is_recipe);
    Some(InventoryEntry {
        name: info.name,
        image_url: cdn_image_url(item_type),
        item_type: item_type.to_string(),
        count,
        ducats: info.ducats,
        category,
    })
}

// ─── Windows-specific memory scanning ─────────────────────────────────────────

#[cfg(target_os = "windows")]
fn find_warframe() -> Result<u32> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
        PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|e| anyhow!("Snapshot failed: {e}"))?;

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let target = "Warframe.x64.exe";

    unsafe {
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let name = String::from_utf16_lossy(
                    &entry.szExeFile[..entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len())],
                );
                if name.eq_ignore_ascii_case(target) {
                    let _ = windows::Win32::Foundation::CloseHandle(snap);
                    return Ok(entry.th32ProcessID);
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snap);
    }

    Err(anyhow!("Warframe.x64.exe not found. Is Warframe running?"))
}

#[cfg(not(target_os = "windows"))]
fn find_warframe() -> Result<u32> {
    Err(anyhow!("Inventory scan is only supported on Windows"))
}

#[cfg(target_os = "windows")]
fn scan_authz(pid: u32) -> Result<String> {
    use windows::Win32::System::{
        Diagnostics::Debug::ReadProcessMemory,
        Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, PAGE_GUARD, PAGE_NOACCESS},
        Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    };

    let handle = unsafe {
        OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid)
            .map_err(|e| anyhow!("OpenProcess failed: {e}"))?
    };

    let mut candidates: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut addr: usize = 0;

    loop {
        let mut mbi = MEMORY_BASIC_INFORMATION::default();
        let ret = unsafe {
            VirtualQueryEx(
                handle,
                Some(addr as *const _),
                &mut mbi,
                std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        if ret == 0 {
            break;
        }

        let region_size = mbi.RegionSize;

        if mbi.State == MEM_COMMIT
            && (mbi.Protect & PAGE_NOACCESS).0 == 0
            && (mbi.Protect & PAGE_GUARD).0 == 0
        {
            let mut offset = 0usize;
            let mut carry: Vec<u8> = Vec::new();

            while offset < region_size {
                let chunk_size = CHUNK_SIZE.min(region_size - offset);
                let mut buf = vec![0u8; chunk_size];
                let mut n_read: usize = 0;

                let ok = unsafe {
                    ReadProcessMemory(
                        handle,
                        (addr + offset) as *const _,
                        buf.as_mut_ptr().cast(),
                        chunk_size,
                        Some(&mut n_read),
                    )
                };

                if ok.is_ok() && n_read > 0 {
                    let combined: Vec<u8> =
                        carry.iter().chain(buf[..n_read].iter()).copied().collect();
                    carry =
                        scan_chunk(&combined, &mut candidates, offset + n_read >= region_size);
                }

                offset += chunk_size;
            }

            if let Some(authz) = find_confident(&candidates) {
                unsafe { let _ = windows::Win32::Foundation::CloseHandle(handle); }
                return Ok(authz);
            }
        }

        addr = addr.wrapping_add(region_size);
        if addr == 0 {
            break;
        }
    }

    unsafe { let _ = windows::Win32::Foundation::CloseHandle(handle); }
    Err(anyhow!("Authorization string not found in Warframe memory"))
}

#[cfg(not(target_os = "windows"))]
fn scan_authz(_pid: u32) -> Result<String> {
    Err(anyhow!("Not supported on this platform"))
}

fn scan_chunk(buf: &[u8], candidates: &mut std::collections::HashMap<String, usize>, _final: bool) -> Vec<u8> {
    let mut start = 0;
    let mut carry_start: Option<usize> = None;

    while start < buf.len() {
        let slice = &buf[start..];
        let Some(idx) = slice.windows(AUTHZ_PATTERN.len()).position(|w| w == AUTHZ_PATTERN) else {
            break;
        };
        let abs = start + idx;

        match extract_authz(&buf[abs..]) {
            Some(authz) => {
                *candidates.entry(authz).or_default() += 1;
                start = abs + AUTHZ_PATTERN.len();
            }
            None => {
                // Incomplete — carry tail for next chunk
                carry_start = Some(abs);
                break;
            }
        }
    }

    if let Some(cs) = carry_start {
        buf[cs..].to_vec()
    } else {
        let tail = AUTHZ_PATTERN.len().saturating_sub(1);
        let tail_start = buf.len().saturating_sub(tail);
        buf[tail_start..].to_vec()
    }
}

fn extract_authz(buf: &[u8]) -> Option<String> {
    let need = AUTHZ_PATTERN.len() + ACCOUNT_ID_LEN + NONCE_PREFIX.len();
    if buf.len() < need {
        return None;
    }
    let off = AUTHZ_PATTERN.len();
    let account_id = std::str::from_utf8(&buf[off..off + ACCOUNT_ID_LEN]).ok()?;
    let off2 = off + ACCOUNT_ID_LEN;
    if !buf[off2..].starts_with(NONCE_PREFIX) {
        return None;
    }
    let digit_start = off2 + NONCE_PREFIX.len();
    let digit_end = buf[digit_start..]
        .iter()
        .position(|c| !c.is_ascii_digit())
        .map(|p| digit_start + p)
        .unwrap_or(buf.len());
    if digit_end == digit_start {
        return None;
    }
    let nonce = std::str::from_utf8(&buf[digit_start..digit_end]).ok()?;

    let authz = format!(
        "{}{}{}{}",
        std::str::from_utf8(AUTHZ_PATTERN).unwrap(),
        account_id,
        std::str::from_utf8(NONCE_PREFIX).unwrap(),
        nonce
    );
    Some(authz)
}

fn find_confident(candidates: &std::collections::HashMap<String, usize>) -> Option<String> {
    candidates
        .iter()
        .find(|(_, &count)| count >= AUTHZ_CONFIDENCE)
        .map(|(k, _)| k.clone())
}
