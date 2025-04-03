use serde::{Serialize, Deserialize};
use std::{collections::HashMap, sync::OnceLock};
use tauri::Manager;

const INPUT_RANGE: usize = 257;
const DEFAULTS: [(&str, f64); 5] = [("min_sens", 0.6), ("max_sens", 3.0), ("range", 40.0), ("growth_base", 1.05), ("offset", 8.0)];

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings { pub values: HashMap<String, f64> }

impl Default for Settings {
    fn default() -> Self { Settings { values: DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect() } }
}

static DEFAULT_SETTINGS: OnceLock<Settings> = OnceLock::new();

#[tauri::command]
fn get_default_settings() -> Settings { DEFAULT_SETTINGS.get_or_init(Settings::default).clone() }

fn generate_sensitivity_curve(n: usize, growth_base: f64, range: f64, min_sens: f64, max_sens: f64, offset: f64, plateau: bool) -> Vec<f64> {
    if n == 0 || range <= 0.0 { return vec![0.0; n]; }

    let mut result = Vec::with_capacity(n);
    let offset_points = (offset.ceil() as usize).min(n);
    result.extend(std::iter::repeat(min_sens).take(offset_points));
    if offset_points >= n { return result; }

    let remaining = n - offset_points;
    let range_size = range.ceil() as usize;
    let expo_len = if plateau && remaining > range_size { range_size } else { remaining };
    let sens_diff = max_sens - min_sens;
    let inv_range = range.recip();

    if growth_base <= 1.0 {
        for i in 0..expo_len {
            let t = (i as f64 * inv_range).min(1.0);
            let t2 = t * t;
            result.push(min_sens + sens_diff * (t2 * (3.0 - 2.0 * t)));
        }
    } else {
        let base_factor = (growth_base.powf(range) - 1.0).recip();
        for i in 0..expo_len {
            let t = ((growth_base.powf(i as f64 * inv_range * range) - 1.0) * base_factor).min(1.0);
            result.push(min_sens + sens_diff * t);
        }
    }

    if plateau && remaining > expo_len {
        result.extend(std::iter::repeat(max_sens).take(remaining - expo_len));
    }

    result
}

#[tauri::command]
fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
    let get = |k: &str| settings.values.get(k).copied()
        .unwrap_or_else(|| DEFAULTS.iter().find(|(key, _)| *key == k).map(|(_, v)| *v).unwrap_or(0.0));

    let params = ["range", "offset", "min_sens", "max_sens", "growth_base"]
        .map(|k| get(k));

    let limit = ((params[0] + params[1] + 10.0).ceil() as usize).min(INPUT_RANGE);
    let curve = generate_sensitivity_curve(limit, params[4], params[0], params[2], params[3], params[1], true);

    (0..limit).map(|i| (i as f64, curve[i])).collect()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window_vibrancy::apply_acrylic(&window, Some((10, 10, 10, 80)))?;
                window.set_decorations(false)?;
                let _ = window.set_theme(Some(tauri::Theme::Dark));
                window.set_shadow(true)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_default_settings, calculate_curve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
