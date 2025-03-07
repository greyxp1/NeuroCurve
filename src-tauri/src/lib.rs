use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use tauri;

const INPUT_RANGE: usize = 257;

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub common: HashMap<String, f64>,
    pub micro: HashMap<String, f64>,
    pub tracking: HashMap<String, f64>,
    pub flicking: HashMap<String, f64>,
}

impl Default for Settings {
    fn default() -> Self {
        let mut settings = Settings {
            common: HashMap::new(),
            micro: HashMap::new(),
            tracking: HashMap::new(),
            flicking: HashMap::new(),
        };

        // Common settings
        settings.common.insert("dpi".to_string(), 1600.0);
        settings.common.insert("min_sens".to_string(), 0.150);

        // Micro settings
        settings.micro.insert("range".to_string(), 20.0);
        settings.micro.insert("growth_base".to_string(), 1.5);
        settings.micro.insert("max_sens".to_string(), 0.4);

        // Tracking settings
        settings.tracking.insert("range".to_string(), 40.0);
        settings.tracking.insert("growth_base".to_string(), 1.012);
        settings.tracking.insert("max_sens".to_string(), 1.2);

        // Flicking settings
        settings.flicking.insert("range".to_string(), 30.0);
        settings.flicking.insert("growth_base".to_string(), 1.023);
        settings.flicking.insert("max_sens".to_string(), 2.5);

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
    let mut full = Vec::with_capacity(total);

    let n_micro = settings.micro.get("range").unwrap_or(&20.0).round() as usize;
    let micro = generate_segment(
        n_micro.min(total),
        *settings.micro.get("growth_base").unwrap_or(&1.5),
        *settings.micro.get("range").unwrap_or(&20.0),
        min_sens,
        *settings.micro.get("max_sens").unwrap_or(&0.4),
        false
    );
    
    let mut last_value = micro.last().copied().unwrap_or(min_sens);
    full.extend(micro);

    let remaining = total.saturating_sub(n_micro);
    let n_tracking = settings.tracking.get("range").unwrap_or(&40.0).round() as usize;

    let segments = [(&settings.tracking, false), (&settings.flicking, true)];
    for (settings_map, plateau) in segments {
        let n = if !plateau { 
            n_tracking.min(remaining)
        } else { 
            remaining.saturating_sub(n_tracking)
        };
        
        if n > 0 {
            let segment = generate_segment(
                n + 1,
                *settings_map.get("growth_base").unwrap_or(&1.012),
                *settings_map.get("range").unwrap_or(&40.0),
                last_value,
                *settings_map.get("max_sens").unwrap_or(&1.2),
                plateau
            );
            
            if segment.len() > 1 {
                full.extend(&segment[1..]);
                last_value = *segment.last().unwrap_or(&last_value);
            }
        }
    }

    full.truncate(total);
    (0..full.len())
        .map(|i| (i as f64 * dpi_scale, full[i] * dpi_scale))
        .collect()
}

// Define the commands in a separate module
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

    #[tauri::command]
    pub fn reset_settings() -> Settings {
        Settings::default()
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // We don't need to apply any window-level effects
            // The CSS backdrop-filter will handle the acrylic effect for panels
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_default_settings,
            commands::calculate_curve,
            commands::reset_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
