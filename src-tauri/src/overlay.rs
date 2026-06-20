use anyhow::Result;
use tauri::{AppHandle, LogicalPosition, Manager};

pub fn show(app: &AppHandle, rewards_count: usize) -> Result<()> {
    let win = app
        .get_webview_window("overlay")
        .ok_or_else(|| anyhow::anyhow!("Overlay window not found"))?;

    let (x, y, w) = compute_position(app, rewards_count);
    win.set_position(LogicalPosition::new(x, y))?;
    let _ = win.set_size(tauri::LogicalSize::new(w, 110.0));
    win.show()?;

    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("overlay") {
        win.hide()?;
    }
    Ok(())
}

fn compute_position(app: &AppHandle, rewards_count: usize) -> (f64, f64, f64) {
    let overlay_w = (rewards_count as f64 * 165.0).max(340.0);

    #[cfg(target_os = "windows")]
    {
        if let Some((gx, gy, gw, gh)) = find_warframe_rect() {
            let x = gx as f64 + (gw as f64 - overlay_w) / 2.0;
            let y = gy as f64 + gh as f64 * 0.78;
            return (x, y, overlay_w);
        }
    }

    // Fallback: center on primary monitor, near the top
    if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let size = monitor.size();
        let x = (size.width as f64 - overlay_w) / 2.0;
        return (x, 8.0, overlay_w);
    }

    (100.0, 600.0, overlay_w)
}

#[cfg(target_os = "windows")]
fn find_warframe_rect() -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect};
    use windows::core::w;

    for title in [w!("Warframe"), w!("WARFRAME")] {
        if let Ok(hwnd) = unsafe { FindWindowW(None, title) } {
            let mut rect = RECT::default();
            let _ = unsafe { GetWindowRect(hwnd, &mut rect) };
            let gw = rect.right - rect.left;
            let gh = rect.bottom - rect.top;
            if gw > 100 && gh > 100 {
                return Some((rect.left, rect.top, gw, gh));
            }
        }
    }
    None
}
