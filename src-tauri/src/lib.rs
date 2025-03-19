use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use tauri;

const INPUT_RANGE: usize = 257;
const DEFAULT_SETTINGS: [(&str, f64); 5] = [
    ("min_sens", 0.2),
    ("max_sens", 2.0),
    ("range", 50.0),
    ("growth_base", 1.07),
    ("offset", 10.0)
];

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings { pub values: HashMap<String, f64> }

impl Default for Settings {
    fn default() -> Self { Settings { values: DEFAULT_SETTINGS.iter().map(|(k, v)| (k.to_string(), *v)).collect() } }
}

#[inline(always)]
pub fn get_default_settings() -> Settings { Settings::default() }

fn generate_sensitivity_curve(n: usize, growth_base: f64, range: f64, min_sens: f64, max_sens: f64, offset: f64, plateau: bool) -> Vec<f64> {
    if n == 0 || range <= 0.0 { return vec![0.0; n]; }
    
    let mut result = Vec::with_capacity(n);
    
    let offset_points = (offset.ceil() as usize).min(n);
    result.extend(std::iter::repeat(min_sens).take(offset_points));
    
    if offset_points >= n {
        return result;
    }
    
    let remaining_points = n - offset_points;
    
    if growth_base <= 1.0 {
        let range_usize = range.ceil() as usize;
        let expo_len = if plateau && remaining_points > range_usize { 
            range_usize 
        } else { 
            remaining_points 
        };
        
        let sens_diff = max_sens - min_sens;
        let curve: Vec<f64> = (0..expo_len)
            .map(|i| min_sens + (sens_diff * (i as f64 / range)).max(0.0))
            .collect();
        
        result.extend(curve);
        
        if plateau && remaining_points > expo_len {
            result.extend(std::iter::repeat(max_sens).take(remaining_points - expo_len));
        }
        
        return result;
    }

    let range_usize = range.ceil() as usize;
    let expo_len = if plateau && remaining_points > range_usize { 
        range_usize 
    } else { 
        remaining_points 
    };
    
    let base_factor = 1.0 / (growth_base.powf(range) - 1.0);
    let sens_diff = max_sens - min_sens;
    let curve: Vec<f64> = (0..expo_len)
        .map(|i| min_sens + (sens_diff * (growth_base.powf(i as f64) - 1.0).max(0.0) * base_factor))
        .collect();
    
    result.extend(curve);
    
    if plateau && remaining_points > expo_len {
        result.extend(std::iter::repeat(max_sens).take(remaining_points - expo_len));
    }
    
    result
}

pub fn calculate_curve(settings: Settings) -> Vec<(f64, f64)> {
    let get_val = |key, default| settings.values.get(key).copied().unwrap_or(default);
    let range = get_val("range", 60.0);
    let offset = get_val("offset", 0.0);
    let display_limit = ((range + offset + 10.0).ceil() as usize).min(INPUT_RANGE);
    
    let segment = generate_sensitivity_curve(
        INPUT_RANGE,
        get_val("growth_base", 1.07),
        range,
        get_val("min_sens", 0.8),
        get_val("max_sens", 2.0),
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
        .invoke_handler(tauri::generate_handler![commands::get_default_settings, commands::calculate_curve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
