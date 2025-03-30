use serde::{Serialize, Deserialize};
use std::{collections::HashMap, sync::OnceLock};
use tauri::Manager;

const INPUT_RANGE: usize = 257;
const DEFAULTS: [(&str, f64); 5] = [
    ("min_sens", 0.6),
    ("max_sens", 3.0),
    ("range", 40.0),
    ("growth_base", 1.05),
    ("offset", 8.0),
];

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings { pub values: HashMap<String, f64> }

impl Default for Settings {
    fn default() -> Self {
        Settings { values: DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect() }
    }
}

static DEFAULT_SETTINGS: OnceLock<Settings> = OnceLock::new();

#[tauri::command]
fn get_default_settings() -> Settings {
    DEFAULT_SETTINGS.get_or_init(Settings::default).clone()
}

fn generate_sensitivity_curve(n: usize, growth_base: f64, range: f64, min_sens: f64, max_sens: f64, offset: f64, plateau: bool) -> Vec<f64> {
    if n == 0 || range <= 0.0 { return vec![0.0; n]; }
    
    let mut result = Vec::with_capacity(n);
    let offset_points = (offset.ceil() as usize).min(n);
    result.extend(vec![min_sens; offset_points]);
    
    if offset_points >= n { return result; }
    
    let remaining = n - offset_points;
    let range_size = range.ceil() as usize;
    let expo_len = if plateau && remaining > range_size { range_size } else { remaining };
    
    let curve: Vec<f64> = if growth_base <= 1.0 {
        let sens_diff = max_sens - min_sens;
        let inv_range = range.recip();
        (0..expo_len).map(|i| {
            let t = (i as f64 * inv_range).min(1.0);
            let t2 = t * t;
            min_sens + sens_diff * (t2 * (3.0 - 2.0 * t))
        }).collect()
    } else {
        let base_factor = (growth_base.powf(range) - 1.0).recip();
        let sens_diff = max_sens - min_sens;
        let inv_range = range.recip();
        (0..expo_len).map(|i| {
            let t = ((growth_base.powf(i as f64 * inv_range * range) - 1.0) * base_factor).min(1.0);
            min_sens + sens_diff * t
        }).collect()
    };
    
    result.extend(curve);
    if plateau && remaining > expo_len {
        result.extend(vec![max_sens; remaining - expo_len]);
    }
    result
}

#[tauri::command]
fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
    let get_val = |key: &str| settings.values.get(key).copied()
        .unwrap_or_else(|| DEFAULTS.iter().find(|(k, _)| *k == key).map(|(_, v)| *v).unwrap_or(0.0));
    
    let range = get_val("range");
    let offset = get_val("offset");
    let limit = ((range + offset + 10.0).ceil() as usize).min(INPUT_RANGE);
    
    let curve = generate_sensitivity_curve(
        INPUT_RANGE,
        get_val("growth_base"),
        range,
        get_val("min_sens"),
        get_val("max_sens"),
        offset,
        true
    );
    
    (0..limit).map(|i| (i as f64, curve[i])).collect()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            window_vibrancy::apply_acrylic(&app.get_webview_window("main").unwrap(), Some((18, 18, 18, 125)))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_default_settings, calculate_curve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
