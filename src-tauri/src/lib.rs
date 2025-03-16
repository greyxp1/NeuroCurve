use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use tauri;

const INPUT_RANGE: usize = 257;
const DEFAULT_SETTINGS: [(&str, f64); 4] = [("min_vel", 0.2), ("max_vel", 2.0), ("range", 60.0), ("growth_base", 1.06)];

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings { pub values: HashMap<String, f64> }

impl Default for Settings {
    fn default() -> Self { Settings { values: DEFAULT_SETTINGS.iter().map(|(k, v)| (k.to_string(), *v)).collect() } }
}

#[inline(always)]
pub fn get_default_settings() -> Settings { Settings::default() }

fn generate_velocity_curve(n: usize, base: f64, range: f64, start_vel: f64, end_vel: f64, plateau: bool) -> Vec<f64> {
    if n == 0 || base <= 1.0 || range <= 0.0 { return vec![0.0; n]; }
    let range_usize = range.ceil() as usize;
    let expo_len = if plateau && n > range_usize { range_usize } else { n };
    let base_factor = 1.0 / (base.powf(range) - 1.0);
    let vel_diff = end_vel - start_vel;
    let mut result: Vec<f64> = (0..expo_len)
        .map(|i| (i as f64 * (start_vel + vel_diff * (base.powf(i as f64) - 1.0).max(0.0) * base_factor)).max(0.0))
        .collect();
    if plateau && n > expo_len && expo_len > 0 {
        let velocity_ratio = if expo_len > 1 { result[expo_len - 1] / ((expo_len - 1) as f64) } else { result[expo_len - 1] };
        result.extend((expo_len..n).map(|i| (i as f64 * velocity_ratio).max(0.0)));
    }
    result
}

pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
    let get_val = |key, default| settings.values.get(key).copied().unwrap_or(default);
    let display_limit = (get_val("range", 60.0).ceil() as usize).min(INPUT_RANGE);
    let segment = generate_velocity_curve(INPUT_RANGE, get_val("growth_base", 1.06), 
        get_val("range", 60.0), get_val("min_vel", 0.2), get_val("max_vel", 2.0), true);
    (0..display_limit).map(|i| (i as f64, segment[i])).collect()
}

mod commands {
    use super::*;
    #[tauri::command] pub fn get_default_settings() -> Settings { super::get_default_settings() }
    #[tauri::command] pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> { super::calculate_curve(settings) }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::get_default_settings, commands::calculate_curve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}