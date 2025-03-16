use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use tauri;

const INPUT_RANGE: usize = 257;
const DEFAULT_DPI: f64 = 1600.0;
const DEFAULT_SETTINGS: [(&str, f64); 5] = [
    ("dpi", 1600.0),
    ("min_vel", 0.2),
    ("max_vel", 2.0),
    ("range", 60.0),
    ("growth_base", 1.06),
];

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings { pub values: HashMap<String, f64> }

impl Default for Settings {
    fn default() -> Self {
        let mut settings = Settings { values: HashMap::with_capacity(5) };
        for (key, value) in DEFAULT_SETTINGS.iter() {
            settings.values.insert(key.to_string(), *value);
        }
        settings
    }
}

#[inline(always)]
pub fn get_default_settings() -> Settings { Settings::default() }

fn generate_velocity_curve(n: usize, base: f64, range: f64, start_vel: f64, end_vel: f64, plateau: bool) -> Vec<f64> {
    if n == 0 { return Vec::new(); }
    let range_usize = range.ceil() as usize;
    let expo_len = if plateau && n > range_usize { range_usize } else { n };
    let mut result = Vec::with_capacity(n);
    if base <= 1.0 || range <= 0.0 { return vec![0.0; n]; }
    let base_factor = 1.0 / (base.powf(range) - 1.0);
    let vel_diff = end_vel - start_vel;
    for i in 0..expo_len {
        let input_speed = i as f64;
        let exp_term = (base.powf(input_speed) - 1.0).max(0.0);
        let velocity_multiplier = start_vel + vel_diff * exp_term * base_factor;
        result.push((input_speed * velocity_multiplier).max(0.0));
    }
    if plateau && n > expo_len && expo_len > 0 {
        let last_velocity = result[expo_len - 1];
        let velocity_ratio = if expo_len > 1 { last_velocity / ((expo_len - 1) as f64) } else { last_velocity };
        result.extend((expo_len..n).map(|i| (i as f64 * velocity_ratio).max(0.0)));
    }
    result
}

pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
    let dpi_scale = settings.values.get("dpi").copied().unwrap_or(DEFAULT_DPI) / DEFAULT_DPI;
    let min_vel = settings.values.get("min_vel").copied().unwrap_or(0.2);
    let max_vel = settings.values.get("max_vel").copied().unwrap_or(2.0);
    let range = settings.values.get("range").copied().unwrap_or(60.0);
    let growth_base = settings.values.get("growth_base").copied().unwrap_or(1.06);
    let display_limit = (range.ceil() as usize).min(INPUT_RANGE);
    let segment = generate_velocity_curve(INPUT_RANGE, growth_base, range, min_vel, max_vel, true);
    Vec::from_iter((0..display_limit).map(|i| (i as f64 * dpi_scale, segment[i])))
}

mod commands {
    use super::*;
    #[tauri::command] 
    pub fn get_default_settings() -> Settings { super::get_default_settings() }
    #[tauri::command] 
    pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> { super::calculate_curve(settings) }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::get_default_settings, commands::calculate_curve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}