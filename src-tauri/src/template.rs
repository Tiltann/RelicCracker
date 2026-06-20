use anyhow::Result;
use std::path::Path;

const TEMPLATE_URL: &str =
    "https://raw.githubusercontent.com/gjrud/warframe-helper/main/assets/reward_template.png";

pub const TMPL_W: u32 = 735;
pub const TMPL_H: u32 = 60;
pub const REF_W:  u32 = 2560;
pub const REF_H:  u32 = 1440;
pub const TMPL_X: u32 = 380;
pub const TMPL_Y: u32 = 62;
pub const REWARD_THRESHOLD: u64 = 4_465_474;

pub struct RewardTemplate {
    pub rgb:  Vec<u8>,         // TMPL_W * TMPL_H * 3 bytes, row-major RGB
    pub mask: Option<Vec<u8>>, // per-pixel alpha (0 = skip in SAD), None if fully opaque
}

pub async fn ensure(path: &Path) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    log::info!("Downloading reward_template.png…");
    let bytes = reqwest::get(TEMPLATE_URL).await?.bytes().await?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, &bytes)?;
    log::info!("reward_template.png cached");
    Ok(())
}

pub fn load(path: &Path) -> Result<RewardTemplate> {
    let img = image::open(path)?.to_rgba8();
    let n = (img.width() * img.height()) as usize;
    let mut rgb = vec![0u8; n * 3];
    let mut mask_buf = vec![0u8; n];
    let mut has_mask = false;

    for (i, p) in img.pixels().enumerate() {
        rgb[i * 3]     = p[0];
        rgb[i * 3 + 1] = p[1];
        rgb[i * 3 + 2] = p[2];
        mask_buf[i] = p[3];
        if p[3] < 255 {
            has_mask = true;
        }
    }

    Ok(RewardTemplate {
        rgb,
        mask: if has_mask { Some(mask_buf) } else { None },
    })
}

/// SAD between `screen_rgb` (TMPL_W*TMPL_H*3 bytes sampled proportionally from
/// the screen) and the template. Mirrors the Go implementation exactly.
pub fn sad(screen_rgb: &[u8], tmpl: &RewardTemplate) -> u64 {
    let n = (TMPL_W * TMPL_H) as usize;
    match &tmpl.mask {
        None => {
            let mut sum: u64 = 0;
            for i in 0..n * 3 {
                let d = screen_rgb[i] as i32 - tmpl.rgb[i] as i32;
                sum += d.unsigned_abs() as u64;
            }
            sum
        }
        Some(mask) => {
            let mut sum: u64 = 0;
            let mut cnt: u64 = 0;
            for i in 0..n {
                if mask[i] == 0 {
                    continue;
                }
                for c in 0..3 {
                    let d = screen_rgb[i * 3 + c] as i32 - tmpl.rgb[i * 3 + c] as i32;
                    sum += d.unsigned_abs() as u64;
                }
                cnt += 1;
            }
            if cnt == 0 {
                return u64::MAX;
            }
            // Normalise the same way as the Go code: multiply by total pixel count / masked count
            sum * n as u64 / cnt
        }
    }
}

/// Sample TMPL_W×TMPL_H RGB pixels from a raw RGBA screen capture proportionally
/// to match what the template was captured at (2560×1440 reference resolution).
/// `rgba` is width×height pixels in R,G,B,A byte order (xcap / image crate native).
pub fn sample_from_rgba(rgba: &[u8], screen_w: u32, screen_h: u32) -> Vec<u8> {
    let mut rgb = vec![0u8; (TMPL_W * TMPL_H * 3) as usize];
    let mut out = 0usize;

    for dy in 0..TMPL_H {
        let sy = ((TMPL_Y + dy) * screen_h / REF_H) as usize;
        for dx in 0..TMPL_W {
            let sx = ((TMPL_X + dx) * screen_w / REF_W) as usize;
            let idx = (sy * screen_w as usize + sx) * 4;
            if idx + 2 < rgba.len() {
                rgb[out]     = rgba[idx];     // R
                rgb[out + 1] = rgba[idx + 1]; // G
                rgb[out + 2] = rgba[idx + 2]; // B
            }
            out += 3;
        }
    }
    rgb
}
