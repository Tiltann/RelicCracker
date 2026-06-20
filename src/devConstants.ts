// Mirror of src-tauri/src/template.rs + lib.rs constants — keep in sync.
export const TMPL_X = 380;
export const TMPL_Y = 62;
export const TMPL_W = 735;
export const TMPL_H = 60;
export const REF_W  = 2560;
export const REF_H  = 1440;
export const REWARD_THRESHOLD = 4_465_474;

// Bottom edge of the template header = top of the reward card region.
// This is the default OCR Y-min threshold (8.47 % from top).
export const DEFAULT_OCR_Y_MIN_PCT = ((TMPL_Y + TMPL_H) / REF_H) * 100;
