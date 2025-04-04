use serde::{Serialize, Deserialize};
use std::{collections::HashMap, sync::OnceLock, fs, path::Path, process::Command};
use tauri::Manager;
use serde_json::{json, to_string_pretty};

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
    result.resize(offset_points, min_sens);
    if offset_points >= n { return result; }

    let remaining = n - offset_points;
    let range_size = range.ceil() as usize;
    let expo_len = if plateau && remaining > range_size { range_size } else { remaining };
    let sens_diff = max_sens - min_sens;
    let inv_range = 1.0 / range;

    result.reserve(expo_len);
    if growth_base <= 1.0 {
        for i in 0..expo_len {
            let t = (i as f64 * inv_range).min(1.0);
            let t2 = t * t;
            result.push(min_sens + sens_diff * (t2 * (3.0 - 2.0 * t)));
        }
    } else {
        let base_factor = 1.0 / (growth_base.powf(range) - 1.0);
        for i in 0..expo_len {
            let t = ((growth_base.powf(i as f64 * inv_range * range) - 1.0) * base_factor).min(1.0);
            result.push(min_sens + sens_diff * t);
        }
    }

    if plateau && remaining > expo_len {
        result.resize(n, max_sens);
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

#[tauri::command]
#[allow(non_snake_case)]
fn apply_to_raw_accel(settings: Settings, rawAccelPath: String) -> Result<(), String> {
    if rawAccelPath.is_empty() {
        return Err("Raw Accel path is empty".to_string());
    }

    // Calculate the curve points
    let points = calculate_curve(settings);
    let formatted_points: Vec<f64> = points.iter()
        .skip(1) // Skip the first point (0,0)
        .flat_map(|(x, y)| [*x, *y]) // More efficient than vec!
        .collect();

    // Create settings file path
    let settings_path = Path::new(&rawAccelPath).join("settings.json");
    let writer_path = Path::new(&rawAccelPath).join("writer.exe");

    // Check if writer exists
    if !writer_path.exists() {
        return Err(format!("Writer executable not found at: {}", writer_path.display()));
    }

    // Create Raw Accel settings JSON
    let raw_accel_json = json!({
        "version": "1.6.1",
        "defaultDeviceConfig": {
            "disable": false,
            "DPI (normalizes sens to 1000dpi and converts input speed unit: counts/ms -> in/s)": 0,
            "Polling rate Hz (keep at 0 for automatic adjustment)": 0
        },
        "profiles": [{
            "name": "NeuroCurve",
            "Whole/combined accel (set false for 'by component' mode)": true,
            "lpNorm": 2.0,
            "Stretches domain for horizontal vs vertical inputs": {"x": 1.0, "y": 1.0},
            "Stretches accel range for horizontal vs vertical inputs": {"x": 1.0, "y": 1.0},
            "Whole or horizontal accel parameters": {
                "mode": "lut",
                "Gain / Velocity": false,
                "inputOffset": 0.0,
                "outputOffset": 0.0,
                "acceleration": 0.005,
                "decayRate": 0.1,
                "growthRate": 1.0,
                "motivity": 1.5,
                "exponentClassic": 2.0,
                "scale": 1.0,
                "exponentPower": 0.05,
                "limit": 1.5,
                "midpoint": 5.0,
                "smooth": 0.5,
                "Cap / Jump": {"x": 15.0, "y": 1.5},
                "Cap mode": "output",
                "data": formatted_points
            },
            "Vertical accel parameters": {
                "mode": "noaccel",
                "Gain / Velocity": true,
                "data": []
            },
            "Sensitivity multiplier": 1.0,
            "Y/X sensitivity ratio (vertical sens multiplier)": 1.0,
            "L/R sensitivity ratio (left sens multiplier)": 1.0,
            "U/D sensitivity ratio (up sens multiplier)": 1.0,
            "Degrees of rotation": 0.0,
            "Degrees of angle snapping": 10.0,
            "Input Speed Cap": 0.0
        }],
        "devices": []
    });

    // Write settings file
    fs::write(&settings_path, to_string_pretty(&raw_accel_json)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;

    // Run writer.exe
    Command::new(writer_path)
        .arg("settings.json")
        .current_dir(rawAccelPath)
        .spawn()
        .map_err(|e| format!("Failed to execute Raw Accel writer: {}", e))?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window_vibrancy::apply_acrylic(&window, Some((10, 10, 10, 80)))?;
                window.set_decorations(false)?;
                window.set_theme(Some(tauri::Theme::Dark))?;
                window.set_shadow(true)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_default_settings, calculate_curve, apply_to_raw_accel])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
