use anyhow::{anyhow, Result};
use image::RgbaImage;

fn capture_warframe_or_screen() -> Result<RgbaImage> {
    if let Ok(windows) = xcap::Window::all() {
        for w in windows {
            let title = w.title().to_lowercase();
            if title.contains("warframe") {
                if let Ok(img) = w.capture_image() {
                    let (wd, ht) = (img.width(), img.height());
                    let raw: Vec<u8> = img.into_raw();
                    if let Some(rgba) = RgbaImage::from_raw(wd, ht, raw) {
                        log::debug!("Captured Warframe window ({}×{})", wd, ht);
                        return Ok(rgba);
                    }
                }
                break;
            }
        }
    }
    capture_screen()
}

fn capture_screen() -> Result<RgbaImage> {
    let monitors = xcap::Monitor::all().map_err(|e| anyhow!("Monitor list failed: {e}"))?;
    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| anyhow!("No primary monitor found"))?;
    let img = primary
        .capture_image()
        .map_err(|e| anyhow!("Screen capture failed: {e}"))?;
    let (w, h) = (img.width(), img.height());
    let raw: Vec<u8> = img.into_raw();
    RgbaImage::from_raw(w, h, raw).ok_or_else(|| anyhow!("Image buffer size mismatch"))
}

pub fn reward_template_score(tmpl: &crate::template::RewardTemplate) -> Option<u64> {
    let img = capture_warframe_or_screen().ok()?;
    let sampled = crate::template::sample_from_rgba(img.as_raw(), img.width(), img.height());
    let score = crate::template::sad(&sampled, tmpl);
    log::debug!("Template SAD={score}");
    Some(score)
}

pub fn check_reward_template(tmpl: &crate::template::RewardTemplate) -> bool {
    reward_template_score(tmpl)
        .map(|s| s < crate::template::REWARD_THRESHOLD)
        .unwrap_or(false)
}

pub async fn raw_ocr_lines(y_min_frac: f32) -> Result<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        let img = capture_warframe_or_screen()?;
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<String>>>();
        std::thread::spawn(move || { let _ = tx.send(ocr_rgba_image(img, y_min_frac, 1.0, "en")); });
        return rx.await?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = y_min_frac;
        Err(anyhow!("OCR requires Windows (Windows.Media.Ocr)"))
    }
}

pub async fn scan_rewards(
    drops: &crate::drops::DropDatabase,
    y_min_frac: f32,
    lang: &str,
) -> Result<(Vec<String>, Vec<String>)> {
    let img = capture_warframe_or_screen()?;
    scan_rgba_image(drops, img, y_min_frac, 0.85, lang).await
}

pub async fn scan_image_file(
    drops: &crate::drops::DropDatabase,
    path: &str,
    y_min_frac: f32,
) -> Result<(Vec<String>, Vec<String>)> {
    let img = image::open(path)
        .map_err(|e| anyhow!("Cannot open image '{path}': {e}"))?
        .to_rgba8();
    scan_rgba_image(drops, img, y_min_frac, 1.0, "en").await
}

async fn scan_rgba_image(
    drops: &crate::drops::DropDatabase,
    img: RgbaImage,
    y_min_frac: f32,
    y_max_frac: f32,
    lang: &str,
) -> Result<(Vec<String>, Vec<String>)> {
    #[cfg(target_os = "windows")]
    {
        let lang_owned = lang.to_string();
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<String>>>();
        std::thread::spawn(move || {
            let _ = tx.send(ocr_rgba_image(img, y_min_frac, y_max_frac, &lang_owned));
        });
        let raw_lines = rx.await??;

        let mut found: Vec<String> = Vec::new();

        for text in &raw_lines {
            // Short enough to match normally
            if let Some(info) = drops.ocr_match(text).await {
                if !found.contains(&info.name) {
                    found.push(info.name.clone());
                }
            } else {
                // Long lines: OCR likely concatenated multiple item names (same horizontal
                // band). Extract all matching word-windows from the single line.
                for info in drops.ocr_match_windows(text).await {
                    if !found.contains(&info.name) {
                        found.push(info.name.clone());
                    }
                }
            }
            if found.len() >= 4 { break; }
        }

        // Also try joining adjacent line pairs in case a single name was split across lines.
        let mut i = 0;
        while i + 1 < raw_lines.len() && found.len() < 4 {
            let joined = format!("{} {}", raw_lines[i], raw_lines[i + 1]);
            if let Some(info) = drops.ocr_match(&joined).await {
                if !found.contains(&info.name) {
                    found.push(info.name.clone());
                }
            }
            i += 1;
        }

        log::info!("OCR scan: {} raw lines, {} items found: {:?}", raw_lines.len(), found.len(), found);
        return Ok((found, raw_lines));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (img, y_min_frac, y_max_frac, lang);
        Err(anyhow!("OCR requires Windows"))
    }
}

fn lang_to_bcp47(lang: &str) -> &'static str {
    match lang {
        "de" => "de-DE",
        "fr" => "fr-FR",
        "es" => "es-ES",
        "it" => "it-IT",
        "pl" => "pl-PL",
        "pt" => "pt-BR",
        "ru" => "ru-RU",
        "ko" => "ko-KR",
        "zh" => "zh-CN",
        "tc" => "zh-TW",
        "ja" => "ja-JP",
        _ => "en-US",
    }
}

#[cfg(target_os = "windows")]
fn create_ocr_engine(bcp47: &str) -> windows::core::Result<windows::Media::Ocr::OcrEngine> {
    use windows::Globalization::Language;
    use windows::core::HSTRING;
    let lang = Language::CreateLanguage(&HSTRING::from(bcp47))?;
    windows::Media::Ocr::OcrEngine::TryCreateFromLanguage(&lang)
}

#[cfg(target_os = "windows")]
fn ocr_rgba_image(img: RgbaImage, y_min_frac: f32, y_max_frac: f32, lang: &str) -> Result<Vec<String>> {
    use windows::{
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::{OcrEngine, OcrLine},
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    let img_h = img.height() as f32;

    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;

    let stream = InMemoryRandomAccessStream::new()?;
    {
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&png)?;
        writer.StoreAsync()?.get()?;
        writer.FlushAsync()?.get()?;
        writer.DetachStream()?;
    }
    stream.Seek(0)?;

    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let bitmap  = decoder.GetSoftwareBitmapAsync()?.get()?;

    let bcp47 = lang_to_bcp47(lang);
    let engine = create_ocr_engine(bcp47)
        .or_else(|_| OcrEngine::TryCreateFromUserProfileLanguages())?;

    let result  = engine.RecognizeAsync(&bitmap)?.get()?;

    let ocr_lines_raw = result.Lines()?;
    let mut lines: Vec<String> = Vec::new();
    for i in 0..ocr_lines_raw.Size()? {
        let line: OcrLine = ocr_lines_raw.GetAt(i)?;
        let words = line.Words()?;
        if words.Size()? == 0 { continue; }
        let rect   = words.GetAt(0)?.BoundingRect()?;
        let y_frac = rect.Y / img_h;
        if y_frac < y_min_frac || y_frac > y_max_frac { continue; }
        let text = line.Text()?.to_string();
        let text = text.trim().to_string();
        if !text.is_empty() { lines.push(text); }
    }

    log::debug!("OCR: {} lines in Y [{:.0}%–{:.0}%] (lang={})", lines.len(), y_min_frac * 100.0, y_max_frac * 100.0, lang);
    Ok(lines)
}
