use serde::{Serialize, Deserialize};
use std::{collections::HashMap, sync::OnceLock, fs, path::Path, process::Command};
use tauri::Manager;
use serde_json::{json, to_string_pretty, from_str};

const INPUT_RANGE: usize = 257;

pub const DEFAULT_MIN_SENS: f64 = 0.6;
pub const DEFAULT_MAX_SENS: f64 = 7.0;
pub const DEFAULT_RANGE: f64 = 40.0;
pub const DEFAULT_GROWTH_BASE: f64 = 1.05;
pub const DEFAULT_OFFSET: f64 = 0.0;
pub const DEFAULT_DPI: f64 = 1600.0;
pub const DEFAULT_POLLING_RATE: f64 = 4000.0;
pub const DEFAULT_SENS_MULTIPLIER: f64 = 1.0;
pub const DEFAULT_Y_X_RATIO: f64 = 1.0;
pub const DEFAULT_ROTATION: f64 = 0.0;
pub const DEFAULT_ANGLE_SNAPPING: f64 = 10.0;
#[derive(Serialize, Deserialize, Clone)]
pub struct SettingConstraint { pub label: String, pub min: f64, pub max: f64, pub step: f64, pub default: f64 }

#[derive(Serialize, Deserialize, Clone)]
pub struct DefaultSettings { pub curve_settings: HashMap<String, SettingConstraint>, pub raw_accel_settings: HashMap<String, SettingConstraint> }

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings { pub values: HashMap<String, f64> }

impl Default for Settings {
    fn default() -> Self {
        let mut values = HashMap::new();
        values.insert("min_sens".to_string(), DEFAULT_MIN_SENS);
        values.insert("max_sens".to_string(), DEFAULT_MAX_SENS);
        values.insert("range".to_string(), DEFAULT_RANGE);
        values.insert("growth_base".to_string(), DEFAULT_GROWTH_BASE);
        values.insert("offset".to_string(), DEFAULT_OFFSET);
        Settings { values }
    }
}

static DEFAULT_SETTINGS: OnceLock<Settings> = OnceLock::new();

#[tauri::command]
fn get_default_settings() -> Settings { DEFAULT_SETTINGS.get_or_init(Settings::default).clone() }

impl Default for DefaultSettings {
    fn default() -> Self {
        let mut curve_settings = HashMap::new();
        let mut raw_accel_settings = HashMap::new();

        let settings = [
            ("curve", "min_sens", "Base Sens", 0.1, 2.0, 0.05, DEFAULT_MIN_SENS),
            ("curve", "max_sens", "Max Sens", 0.1, 10.0, 0.05, DEFAULT_MAX_SENS),
            ("curve", "offset", "Offset", 0.0, 50.0, 1.0, DEFAULT_OFFSET),
            ("curve", "range", "Accel Range", 10.0, 200.0, 1.0, DEFAULT_RANGE),
            ("curve", "growth_base", "Accel Rate", 1.0, 1.5, 0.001, DEFAULT_GROWTH_BASE),
            ("raw", "dpi", "DPI", 0.0, 64000.0, 1.0, DEFAULT_DPI),
            ("raw", "polling_rate", "Polling Rate", 0.0, 8000.0, 125.0, DEFAULT_POLLING_RATE),
            ("raw", "sens_multiplier", "Sens Multiplier", 0.01, 10.0, 0.01, DEFAULT_SENS_MULTIPLIER),
            ("raw", "y_x_ratio", "Y/X Ratio", 0.01, 10.0, 0.01, DEFAULT_Y_X_RATIO),
            ("raw", "rotation", "Rotation", -180.0, 180.0, 1.0, DEFAULT_ROTATION),
            ("raw", "angle_snapping", "Angle Snap", 0.0, 45.0, 1.0, DEFAULT_ANGLE_SNAPPING),
        ];

        for (category, key, label, min, max, step, default) in settings {
            let constraint = SettingConstraint {
                label: label.to_string(),
                min, max, step, default
            };

            match category {
                "curve" => { curve_settings.insert(key.to_string(), constraint); },
                "raw" => { raw_accel_settings.insert(key.to_string(), constraint); },
                _ => {}
            }
        }

        DefaultSettings { curve_settings, raw_accel_settings }
    }
}

#[tauri::command]
fn get_all_default_settings() -> DefaultSettings {
    DefaultSettings::default()
}

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
    let get = |k: &str| settings.values.get(k).copied().unwrap_or_else(|| match k {
        "min_sens" => DEFAULT_MIN_SENS,
        "max_sens" => DEFAULT_MAX_SENS,
        "range" => DEFAULT_RANGE,
        "growth_base" => DEFAULT_GROWTH_BASE,
        "offset" => DEFAULT_OFFSET,
        _ => 0.0
    });

    let [range, offset, min_sens, max_sens, growth_base] =
        ["range", "offset", "min_sens", "max_sens", "growth_base"].map(get);

    let limit = ((range + offset + 10.0).ceil() as usize).min(INPUT_RANGE);
    let curve = generate_sensitivity_curve(limit, growth_base, range, min_sens, max_sens, offset, true);
    (0..limit).map(|i| (i as f64, curve[i])).collect()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RawAccelSettings {
    pub dpi: f64, pub polling_rate: f64, pub sens_multiplier: f64,
    pub y_x_ratio: f64, pub rotation: f64, pub angle_snapping: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub curve_settings: Settings, pub raw_accel_settings: RawAccelSettings, pub raw_accel_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            curve_settings: Settings::default(),
            raw_accel_settings: RawAccelSettings {
                dpi: DEFAULT_DPI,
                polling_rate: DEFAULT_POLLING_RATE,
                sens_multiplier: DEFAULT_SENS_MULTIPLIER,
                y_x_ratio: DEFAULT_Y_X_RATIO,
                rotation: DEFAULT_ROTATION,
                angle_snapping: DEFAULT_ANGLE_SNAPPING,
            },
            raw_accel_path: String::new(),
        }
    }
}

#[tauri::command]
#[allow(non_snake_case)]
fn apply_to_raw_accel(settings: Settings, rawAccelPath: String, rawAccelSettings: RawAccelSettings) -> Result<(), String> {
    if rawAccelPath.is_empty() { return Err("Raw Accel path is empty".to_string()); }

    let points = calculate_curve(settings);
    let formatted_points: Vec<f64> = points.iter()
        .skip(1).flat_map(|(x, y)| [*x, *y]).collect();

    let settings_path = Path::new(&rawAccelPath).join("settings.json");
    let writer_path = Path::new(&rawAccelPath).join("writer.exe");
    if !writer_path.exists() {
        return Err(format!("Writer executable not found at: {}", writer_path.display()));
    }

    let raw_accel_json = json!({
        "version": "1.6.1",
        "defaultDeviceConfig": {
            "disable": false,
            "DPI (normalizes sens to 1000dpi and converts input speed unit: counts/ms -> in/s)": rawAccelSettings.dpi as i64,
            "Polling rate Hz (keep at 0 for automatic adjustment)": rawAccelSettings.polling_rate as i64
        },
        "profiles": [{
            "name": "NeuroCurve",
            "Whole/combined accel (set false for 'by component' mode)": true,
            "lpNorm": 2.0,
            "Stretches domain for horizontal vs vertical inputs": {"x": 1.0, "y": 1.0},
            "Stretches accel range for horizontal vs vertical inputs": {"x": 1.0, "y": 1.0},
            "Whole or horizontal accel parameters": {
                "mode": "lut", "Gain / Velocity": false,
                "inputOffset": 0.0, "outputOffset": 0.0,
                "acceleration": 0.005, "decayRate": 0.1, "growthRate": 1.0,
                "motivity": 1.5, "exponentClassic": 2.0, "scale": 1.0,
                "exponentPower": 0.05, "limit": 1.5, "midpoint": 5.0, "smooth": 0.5,
                "Cap / Jump": {"x": 15.0, "y": 1.5}, "Cap mode": "output",
                "data": formatted_points
            },
            "Vertical accel parameters": {
                "mode": "noaccel", "Gain / Velocity": true, "data": []
            },
            "Sensitivity multiplier": rawAccelSettings.sens_multiplier,
            "Y/X sensitivity ratio (vertical sens multiplier)": rawAccelSettings.y_x_ratio,
            "L/R sensitivity ratio (left sens multiplier)": 1.0,
            "U/D sensitivity ratio (up sens multiplier)": 1.0,
            "Degrees of rotation": rawAccelSettings.rotation,
            "Degrees of angle snapping": rawAccelSettings.angle_snapping,
            "Input Speed Cap": 0.0
        }],
        "devices": []
    });

    fs::write(&settings_path, to_string_pretty(&raw_accel_json)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;

    Command::new(writer_path).arg("settings.json").current_dir(rawAccelPath)
        .spawn().map_err(|e| format!("Failed to execute Raw Accel writer: {}", e))?;

    Ok(())
}

#[tauri::command]
fn save_app_settings(app_settings: AppSettings, app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_handle.path().app_config_dir()
        .map_err(|e| format!("Failed to get app config directory: {}", e))?;
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let settings_path = app_dir.join("settings.json");
    fs::write(&settings_path, to_string_pretty(&app_settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn load_app_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    let settings_path = app_handle.path().app_config_dir()
        .map_err(|e| format!("Failed to get app config directory: {}", e))?
        .join("settings.json");

    if !settings_path.exists() { return Ok(AppSettings::default()); }

    from_str(&fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings file: {}", e))?)
        .map_err(|e| format!("Failed to parse settings file: {}", e))
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
        .invoke_handler(tauri::generate_handler![
            get_default_settings, get_all_default_settings, calculate_curve,
            apply_to_raw_accel, save_app_settings, load_app_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
