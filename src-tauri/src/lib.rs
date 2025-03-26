use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use tauri;
use tauri::Manager;
use window_vibrancy::apply_acrylic;

const INPUT_RANGE: usize = 257;

struct Defaults;
impl Defaults {
    const MIN_SENS: f64 = 0.385;
    const MAX_SENS: f64 = 3.0;
    const RANGE: f64 = 40.0;
    const GROWTH_BASE: f64 = 1.05;
    const OFFSET: f64 = 8.0;
    
    const ALL: [(&'static str, f64); 5] = [
        ("min_sens", Self::MIN_SENS),
        ("max_sens", Self::MAX_SENS),
        ("range", Self::RANGE),
        ("growth_base", Self::GROWTH_BASE),
        ("offset", Self::OFFSET),
    ];
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings { pub values: HashMap<String, f64> }

impl Default for Settings {
    fn default() -> Self { 
        Settings { 
            values: Defaults::ALL
                .iter()
                .map(|(k, v)| (k.to_string(), *v))
                .collect() 
        } 
    }
}

#[inline(always)]
pub fn get_default_settings() -> Settings { Settings::default() }

fn generate_sensitivity_curve(n: usize, growth_base: f64, range: f64, min_sens: f64, max_sens: f64, offset: f64, plateau: bool) -> Vec<f64> {
    if n == 0 || range <= 0.0 { return vec![0.0; n]; }
    let mut result = Vec::with_capacity(n);
    let offset_points = (offset.ceil() as usize).min(n);
    result.extend(std::iter::repeat(min_sens).take(offset_points));
    if offset_points >= n { return result; }
    
    let remaining_points = n - offset_points;
    let range_usize = range.ceil() as usize;
    let expo_len = if plateau && remaining_points > range_usize { range_usize } else { remaining_points };
    
    let curve: Vec<f64> = if growth_base <= 1.0 {
        (0..expo_len).map(|i| {
            let t = (i as f64 / range).min(1.0);
            min_sens + (max_sens - min_sens) * (t * t * (3.0 - 2.0 * t))
        }).collect()
    } else {
        let base_factor = 1.0 / (growth_base.powf(range) - 1.0);
        (0..expo_len).map(|i| {
            let t = ((growth_base.powf(i as f64 / range * range) - 1.0) * base_factor).min(1.0);
            min_sens + (max_sens - min_sens) * t
        }).collect()
    };
    
    result.extend(curve);
    if plateau && remaining_points > expo_len {
        result.extend(std::iter::repeat(max_sens).take(remaining_points - expo_len));
    }
    result
}

pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
    let get_val = |key| settings.values.get(key).copied().unwrap_or_else(|| {
        Defaults::ALL.iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| *v)
            .unwrap_or(0.0)
    });

    let range = get_val("range");
    let offset = get_val("offset");
    let display_limit = ((range + offset + 10.0).ceil() as usize).min(INPUT_RANGE);
    
    let segment = generate_sensitivity_curve(
        INPUT_RANGE,
        get_val("growth_base"),
        range,
        get_val("min_sens"),
        get_val("max_sens"),
        offset,
        true
    );
    
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
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            #[cfg(target_os = "windows")]
            apply_acrylic(&window, Some((18, 18, 18, 125)))
                .expect("Failed to apply acrylic effect");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::get_default_settings, commands::calculate_curve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
