use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use tauri;

const INPUT_RANGE: usize = 257;

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub common: HashMap<String, f64>,
    pub flicking: HashMap<String, f64>,
}

impl Default for Settings {
    fn default() -> Self {
        let mut settings = Settings {
            common: HashMap::new(),
            flicking: HashMap::new(),
        };

        settings.common.insert("dpi".to_string(), 1600.0);
        settings.common.insert("min_sens".to_string(), 0.2);
        settings.flicking.insert("max_sens".to_string(), 1.8);
        settings.flicking.insert("range".to_string(), 60.0);
        settings.flicking.insert("growth_base".to_string(), 1.06);
        settings
    }
}

fn generate_segment(n: usize, base: f64, range: f64, start: f64, end: f64, plateau: bool) -> Vec<f64> {
    if n == 0 { return Vec::new(); }
    
    let plateau_len = (plateau && (n as f64) > range)
        .then_some(n.saturating_sub(range as usize))
        .unwrap_or(0);
    let expo_len = n.saturating_sub(plateau_len);
    
    let mut result = Vec::with_capacity(n);
    let base_factor = 1.0 / (base.powf(range) - 1.0);
    result.extend((0..expo_len).map(|i| {
        start + (end - start) * (base.powf(i as f64) - 1.0) * base_factor
    }));
    result.extend(std::iter::repeat(end).take(plateau_len));
    result
}

pub fn get_default_settings() -> Settings {
    Settings::default()
}

pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
    let total = INPUT_RANGE;
    let dpi_scale = *settings.common.get("dpi").unwrap_or(&1600.0) / 1600.0;
    let min_sens = *settings.common.get("min_sens").unwrap_or(&0.15);
    let range = *settings.flicking.get("range").unwrap_or(&60.0);
    
    let mut full = Vec::with_capacity(total);

    let segment = generate_segment(
        total,
        *settings.flicking.get("growth_base").unwrap_or(&1.05),
        range,
        min_sens,
        *settings.flicking.get("max_sens").unwrap_or(&2.0),
        true
    );
    
    full.extend(segment);
    full.truncate(total);

    let display_limit = ((range as usize) + 10).min(total);
    (0..display_limit)
        .map(|i| (i as f64 * dpi_scale, full[i] * dpi_scale))
        .collect()
}

mod commands {
    use super::*;

    #[tauri::command]
    pub fn get_default_settings() -> Settings {
        super::get_default_settings()
    }

    #[tauri::command]
    pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
        super::calculate_curve(settings)
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_default_settings,
            commands::calculate_curve,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}