#![windows_subsystem = "windows"]

use eframe::{App, Frame, NativeOptions};
use eframe::egui;
use egui_extras::install_image_loaders;
use egui_plot::{Line, Plot, PlotPoints, GridMark};  // Remove GridInput
use std::collections::HashMap;
use winreg::enums::*;
use winreg::RegKey;
use clipboard::{ClipboardProvider, ClipboardContext};

pub const INPUT_RANGE: usize = 257;

pub struct GuidelineConstants {
    pub corner_radius: f32,
    pub margin: f32,
    pub padding: f32,
    pub widget_height: f32,
    pub slider_width: f32,
    pub label_width: f32,
    pub value_width: f32,
    pub button_height: f32,
}

impl GuidelineConstants {
    pub fn label_frame(&self) -> egui::Frame {
        egui::Frame::new()
            .fill(AppConfig::default().colors.bg_primary)
            .stroke(egui::Stroke::new(1.0, AppConfig::default().colors.border))
            .inner_margin(egui::vec2(self.padding, 1.0))
            .corner_radius(4.0)
    }

    pub fn value_frame(&self) -> egui::Frame {
        self.label_frame()
    }
}

pub struct ColorScheme {
    pub bg_primary: egui::Color32,
    pub text_primary: egui::Color32,
    pub text_secondary: egui::Color32,
    pub primary: egui::Color32,
    pub error: egui::Color32,
    pub border: egui::Color32,
    pub tab_micro: egui::Color32,
    pub tab_tracking: egui::Color32,
    pub tab_flicking: egui::Color32,
}

pub struct SettingDefaults {
    pub common: &'static [(&'static str, f64)],
    pub micro: &'static [(&'static str, f64)],
    pub tracking: &'static [(&'static str, f64)],
    pub flicking: &'static [(&'static str, f64)],
}

pub struct AppConfig {
    pub window: WindowConfig,
    pub guidelines: GuidelineConstants,
    pub colors: ColorScheme,
    pub defaults: SettingDefaults,
}

pub struct WindowConfig {
    pub size: [f32; 2],
    pub min_size: [f32; 2],
    pub resizable: bool,
    pub decorations: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            window: WindowConfig {
                size: [800.0, 360.0],
                min_size: [800.0, 360.0],
                resizable: false,
                decorations: false,
            },
            guidelines: GuidelineConstants {
                corner_radius: 8.0,
                margin: 16.0,
                padding: 4.0,
                widget_height: 16.0,
                slider_width: 160.0,
                label_width: 45.0,
                value_width: 50.0,
                button_height: 36.0,
            },
            colors: ColorScheme {
                bg_primary: egui::Color32::from_black_alpha(0),
                text_primary: egui::Color32::from_rgb(200, 200, 200),
                text_secondary: egui::Color32::WHITE,
                primary: egui::Color32::from_rgb(61, 139, 255),
                error: egui::Color32::from_rgb(220, 80, 80),
                border: egui::Color32::from_gray(70),
                tab_micro: egui::Color32::from_rgb(61, 139, 255),
                tab_tracking: egui::Color32::from_rgb(255, 153, 0),
                tab_flicking: egui::Color32::from_rgb(51, 204, 51),
            },
            defaults: SettingDefaults {
                common: &[
                    ("dpi", 1600.0),
                    ("min_sens", 0.150),
                ],
                micro: &[
                    ("range", 20.0),
                    ("growth_base", 1.5),
                    ("max_sens", 0.4),
                ],
                tracking: &[
                    ("range", 40.0),
                    ("growth_base", 1.012),
                    ("max_sens", 1.2),
                ],
                flicking: &[
                    ("range", 30.0),
                    ("growth_base", 1.023),
                    ("max_sens", 2.5),
                ],
            },
        }
    }
}

type Settings = HashMap<String, f64>;

#[derive(Default)]
struct NeuroAccelApp {
    common_settings: Settings,
    micro_settings: Settings,
    tracking_settings: Settings,
    flicking_settings: Settings,
    active_tab: String,
    settings_modified: bool,
    reset_plot: bool,
}

// UI helper functions
fn get_config() -> AppConfig { AppConfig::default() }

fn get_tab_data() -> [(&'static str, egui::Color32); 3] {
    let config = get_config();
    [
        ("Micro", config.colors.tab_micro),
        ("Tracking", config.colors.tab_tracking),
        ("Flicking", config.colors.tab_flicking),
    ]
}

// Main implementation
impl NeuroAccelApp {
    fn new() -> Self {
        let config = AppConfig::default();
        let mut app = Self {
            active_tab: "Micro".to_string(),
            reset_plot: false,
            ..Default::default()
        };
        app.reset_to_defaults_with_config(&config.defaults);
        app.load_settings();
        app
    }

    fn reset_to_defaults_with_config(&mut self, defaults: &SettingDefaults) {
        self.common_settings = defaults.common
            .iter()
            .map(|&(name, value)| (name.to_string(), value))
            .collect();

        self.micro_settings = defaults.micro
            .iter()
            .map(|&(name, value)| (name.to_string(), value))
            .collect();

        self.tracking_settings = defaults.tracking
            .iter()
            .map(|&(name, value)| (name.to_string(), value))
            .collect();

        self.flicking_settings = defaults.flicking
            .iter()
            .map(|&(name, value)| (name.to_string(), value))
            .collect();

        self.settings_modified = true;
        self.reset_plot = true;
    }

    fn generate_segment(&self, n: usize, base: f64, range: f64, 
                       start: f64, end: f64, plateau: bool) -> Vec<f64> {
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

    fn generate_full_curve(&self) -> (Vec<f64>, Vec<f64>) {
        let total = INPUT_RANGE;
        let dpi_scale = self.common_settings["dpi"] / 1600.0;
        let min_sens = self.common_settings["min_sens"];
        let mut full = Vec::with_capacity(total);

        let n_micro = self.micro_settings["range"] as usize;
        let micro = self.generate_segment(
            n_micro.min(total),
            self.micro_settings["growth_base"],
            self.micro_settings["range"],
            min_sens,
            self.micro_settings["max_sens"],
            false
        );
        
        let mut last_value = micro.last().copied().unwrap_or(0.0);
        full.extend(micro);

        let remaining = total.saturating_sub(n_micro);
        let n_tracking = (self.tracking_settings["range"] as usize).min(remaining);

        const SEGMENTS: [(usize, bool); 2] = [(0, false), (1, true)];
        let settings = [&self.tracking_settings, &self.flicking_settings];

        for (idx, plateau) in SEGMENTS.iter() {
            let n = if *idx == 0 { n_tracking } else { remaining - n_tracking };
            if n > 0 {
                let segment = self.generate_segment(
                    n + 1,
                    settings[*idx]["growth_base"],
                    settings[*idx]["range"],
                    last_value,
                    settings[*idx]["max_sens"],
                    *plateau
                );
                full.extend(&segment[1..]);
                last_value = segment.last().copied().unwrap_or(last_value);
            }
        }

        full.truncate(total);
        (
            (0..full.len()).map(|i| i as f64 * dpi_scale).collect(),
            full.iter().map(|v| v * dpi_scale).collect()
        )
    }

    fn save_settings(&self) {
        if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey_with_flags("SOFTWARE\\NeuroAccel", KEY_WRITE | KEY_WOW64_64KEY) 
        {
            [(&self.common_settings, ""),
             (&self.micro_settings, "micro_"),
             (&self.tracking_settings, "tracking_"),
             (&self.flicking_settings, "flicking_")]
                .iter()
                .for_each(|(settings, prefix)| {
                    settings.iter().for_each(|(name, value)| {
                        let _ = key.set_value(
                            &format!("{}{}", prefix, name),
                            &value.to_string()
                        );
                    });
                });
        }
    }

    fn load_settings(&mut self) {
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("SOFTWARE\\NeuroAccel") 
        {
            [(&mut self.common_settings, ""),
             (&mut self.micro_settings, "micro_"),
             (&mut self.tracking_settings, "tracking_"),
             (&mut self.flicking_settings, "flicking_")]
                .iter_mut()
                .for_each(|(settings, prefix)| {
                    settings.keys().cloned().collect::<Vec<_>>()
                        .iter()
                        .for_each(|name| {
                            if let Ok(value_str) = key.get_value::<String, _>(
                                &format!("{}{}", prefix, name)
                            ) {
                                if let Ok(num) = value_str.parse::<f64>() {
                                    settings.insert(name.clone(), num);
                                }
                            }
                        });
                });
        }
        self.settings_modified = false;
    }

    fn export_lut_to_clipboard(&self) {
        let (x, y) = self.generate_full_curve();
        let lut = x.iter().zip(y.iter())
            .skip(1)
            .map(|(x, y)| format!("{},{:.4}", x, y))
            .collect::<Vec<_>>()
            .join(";\n");
        
        if let Ok(mut clipboard) = ClipboardContext::new() {
            let _ = clipboard.set_contents(lut);
        }
    }

    fn draw_settings_panel(&mut self, ui: &mut egui::Ui) {
        let config = get_config();
        let frame = egui::Frame {
            corner_radius: config.guidelines.corner_radius.into(),
            fill: ui.style().visuals.widgets.noninteractive.bg_fill,
            stroke: egui::Stroke::new(2.0, config.colors.border), // Add border stroke
            inner_margin: egui::epaint::Margin { left: 8, right: 8, top: 2, bottom: 2 },
            outer_margin: (0.0).into(),
            ..Default::default()
        };

        frame.show(ui, |ui| {
            ui.add_space(-4.0);
            self.draw_window_controls(ui);
            ui.add_space(4.0);
            self.draw_header(ui);
            self.draw_dpi_settings(ui);
            self.draw_tabs(ui);
            self.draw_settings_section(ui);
            self.draw_action_buttons(ui);
        });
    }

    fn draw_main_plot(&mut self, ui: &mut egui::Ui) {
        let config = get_config();
        let (x, y) = self.generate_full_curve();
        let max_velocity = INPUT_RANGE;
        let dpi_scale = *self.common_settings.get("dpi").unwrap_or(&1600.0) / 1600.0;

        if x.len() != y.len() || x.is_empty() { return; }
        
        let n_micro = (*self.micro_settings.get("range").unwrap_or(&0.0) as usize).min(max_velocity);
        let n_tracking = (*self.tracking_settings.get("range").unwrap_or(&0.0) as usize)
            .min(if max_velocity > n_micro { max_velocity - n_micro } else { 0 });

        let micro_end = n_micro.min(x.len() - 1);
        let tracking_end = (micro_end + n_tracking).min(x.len() - 1);
        let display_end = max_velocity.min(x.len());

        if micro_end >= x.len() || tracking_end >= x.len() || display_end > x.len() { return; }

        let max_y = y[..display_end].iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let total_threshold = n_micro + n_tracking + 
            (*self.flicking_settings.get("range").unwrap_or(&0.0) as usize);

        let base_display = 100.0 * dpi_scale;
        let display_x = base_display.max(
            base_display * (total_threshold as f64 / 90.0)
        );

        let plot_frame = egui::Frame {
            corner_radius: config.guidelines.corner_radius.into(),
            fill: ui.style().visuals.widgets.noninteractive.bg_fill,
            stroke: egui::Stroke::new(2.0, config.colors.border), // Add border stroke
            inner_margin: egui::epaint::Margin { left: 8, right: 8, top: 2, bottom: 2 },
            outer_margin: (0.0).into(),
            ..Default::default()
        };

        plot_frame.show(ui, |ui| {
            self.draw_plot_header(ui); // Move header inside the frame
            let mut plot = Plot::new("sensitivity_curve")
                .show_grid(true)
                .legend(egui_plot::Legend::default().position(egui_plot::Corner::LeftTop))
                .x_axis_label("Input Velocity (counts/ms)")
                .y_axis_label("Sensitivity Multiplier")
                .auto_bounds([false, true])
                .y_axis_min_width(40.0)
                .label_formatter(|name, value| {
                    if name.is_empty() { format!("({:.1}, {:.2})", value.x, value.y) } 
                    else { format!("{}: ({:.1}, {:.2})", name, value.x, value.y) }
                })
                .y_axis_formatter(|value, _| {
                    if value.value == 0.0 { 
                        "".to_string() 
                    } else if value.value < 1.0 {
                        format!("{:.1}", value.value)
                    } else if value.value < 10.0 {
                        format!("{:.1}", value.value)
                    } else {
                        format!("{:.0}", value.value)
                    }
                })
                .x_grid_spacer(|grid_input| {
                    let mut spacings = Vec::new();
                    
                    // Rest of the x_grid_spacer implementation
                    // Small intervals (10)
                    if grid_input.bounds.0 < 100.0 {
                        for v in (0..).map(|i| i as f64 * 10.0).take_while(|v| *v <= grid_input.bounds.1) {
                            spacings.push(GridMark { value: v, step_size: 10.0 });
                        }
                    }
                    
                    // Medium intervals (50)
                    if grid_input.bounds.0 < 1000.0 {
                        for v in (0..).map(|i| i as f64 * 50.0).take_while(|v| *v <= grid_input.bounds.1) {
                            spacings.push(GridMark { value: v, step_size: 50.0 });
                        }
                    }
                    
                    // Large intervals (100)
                    for v in (0..).map(|i| i as f64 * 100.0).take_while(|v| *v <= grid_input.bounds.1) {
                        spacings.push(GridMark { value: v, step_size: 100.0 });
                    }
                    
                    spacings
                })
                .y_grid_spacer(|grid_input| {
                    let mut spacings = Vec::new();
                    
                    // Rest of the y_grid_spacer implementation
                    // Small intervals (0.1)
                    if grid_input.bounds.0 < 1.0 {
                        for v in (0..).map(|i| i as f64 * 0.1).take_while(|v| *v <= grid_input.bounds.1) {
                            spacings.push(GridMark { value: v, step_size: 0.1 });
                        }
                    }
                    
                    // Medium intervals (0.5)
                    if grid_input.bounds.0 < 5.0 {
                        for v in (0..).map(|i| i as f64 * 0.5).take_while(|v| *v <= grid_input.bounds.1) {
                            spacings.push(GridMark { value: v, step_size: 0.5 });
                        }
                    }
                    
                    // Large intervals (1.0)
                    for v in (0..).map(|i| i as f64).take_while(|v| *v <= grid_input.bounds.1) {
                        spacings.push(GridMark { value: v, step_size: 1.0 });
                    }
                    
                    spacings
                })
                .allow_drag(false)
                .allow_zoom(false)
                .allow_scroll(false)
                .allow_boxed_zoom(false)
                .allow_double_click_reset(false)
                .include_x(0.0)
                .include_x(display_x)
                .include_y(0.0)
                .include_y(max_y * 1.15)
                .height(ui.available_height() - 20.0);

            if self.reset_plot { 
                plot = plot.reset();
                self.reset_plot = false;
            }

            plot.show(ui, |plot_ui| {
                plot_ui.set_plot_bounds(egui_plot::PlotBounds::from_min_max(
                    [0.0, 0.0],
                    [display_x, max_y * 1.15]
                ));

                let colors = [
                    (config.colors.tab_micro, "Micro", 0, micro_end),
                    (config.colors.tab_tracking, "Tracking", micro_end, tracking_end),
                    (config.colors.tab_flicking, "Flicking", tracking_end, display_end - 1),
                ];
                
                for (color, name, start, end) in colors {
                    if start < x.len() && end < x.len() {
                        let points = PlotPoints::from_iter(
                            (start..=end).map(|i| [x[i], y[i]])
                        );
                        plot_ui.line(Line::new(points).name(name).color(color).width(2.5));
                    }
                }
            });
        });
    }

    fn draw_window_controls(&mut self, ui: &mut egui::Ui) {
        let circle_size = 12.0;
        let spacing = 19.0;
        let top_margin = 16.0;
        let right_margin = 6.0;

        let window_rect = ui.ctx().screen_rect();
        let base_pos = egui::pos2(
            window_rect.right() - right_margin - circle_size,
            window_rect.top() + top_margin
        );

        let close_rect = egui::Rect::from_center_size(
            egui::pos2(base_pos.x, base_pos.y),
            egui::vec2(circle_size, circle_size)
        );
        let close_response = ui.allocate_rect(close_rect, egui::Sense::click());
        
        if close_response.clicked() {
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
        }

        let close_color = if close_response.hovered() {
            egui::Color32::from_rgb(255, 40, 40)
        } else {
            egui::Color32::from_rgb(255, 95, 87)
        };
        
        ui.painter().circle_filled(
            close_rect.center(),
            (circle_size / 2.0) * if close_response.hovered() { 1.2 } else { 1.0 },
            close_color,
        );

        let minimize_rect = egui::Rect::from_center_size(
            egui::pos2(base_pos.x - spacing, base_pos.y),
            egui::vec2(circle_size, circle_size)
        );
        let minimize_response = ui.allocate_rect(minimize_rect, egui::Sense::click());
        
        if minimize_response.clicked() {
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::Minimized(true));
        }

        let minimize_color = if minimize_response.hovered() {
            egui::Color32::from_rgb(255, 160, 0)
        } else {
            egui::Color32::from_rgb(255, 189, 46)
        };
        
        ui.painter().circle_filled(
            minimize_rect.center(),
            (circle_size / 2.0) * if minimize_response.hovered() { 1.2 } else { 1.0 },
            minimize_color,
        );
    }

    fn draw_header(&mut self, ui: &mut egui::Ui) {
        let config = get_config();
        ui.vertical_centered(|ui| {
            ui.add(egui::Label::new(
                egui::RichText::new("Settings")
                    .strong()
                    .size(24.0)
                    .color(config.colors.text_primary))
                .selectable(false));
            ui.add_space(8.0);
        });
    }

    fn draw_dpi_settings(&mut self, ui: &mut egui::Ui) {
        let config = get_config();
        ui.vertical_centered(|ui| {
            // Create a local copy of the values
            let mut dpi = self.common_settings.get("dpi").copied().unwrap_or(1600.0);
            let mut min_sens = self.common_settings.get("min_sens").copied().unwrap_or(0.15);

            // Draw the settings using the copies
            if self.create_setting_row(ui, "DPI", "Mouse DPI (Dots Per Inch)", 
                                     &mut dpi, 400.0..=6400.0, &config) {
                self.common_settings.insert("dpi".to_string(), dpi);
                self.settings_modified = true;
            }

            if self.create_setting_row(ui, "Base", "Base sensitivity multiplier", 
                                     &mut min_sens, 0.0..=1.0, &config) {
                self.common_settings.insert("min_sens".to_string(), min_sens);
                self.settings_modified = true;
            }

            ui.add_space(config.guidelines.margin);
        });
    }

    fn draw_tabs(&mut self, ui: &mut egui::Ui) {
        let config = get_config();
        let tab_data = get_tab_data();
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            let button_width = (ui.available_width() - 32.0) / tab_data.len() as f32;
            
            for &(name, color) in tab_data.iter() {
                let is_active = self.active_tab == name;
                let btn = egui::Button::new(
                    egui::RichText::new(name)
                        .color(if is_active { config.colors.text_secondary } 
                              else { ui.style().visuals.text_color() })
                )
                .fill(if is_active { color } 
                      else { ui.style().visuals.widgets.inactive.bg_fill })
                .min_size(egui::vec2(button_width, 30.0))
                .corner_radius(config.guidelines.corner_radius);

                if ui.add(btn).clicked() {
                    self.active_tab = name.to_string();
                }
            }
        });
        ui.add_space(config.guidelines.margin);
    }

    fn draw_settings_section(&mut self, ui: &mut egui::Ui) {
        let active_tab = self.active_tab.clone();
        let current_settings = match active_tab.as_str() {
            "Micro" => self.micro_settings.clone(),
            "Tracking" => self.tracking_settings.clone(),
            "Flicking" => self.flicking_settings.clone(),
            _ => self.micro_settings.clone(),
        };

        let setting_specs = match active_tab.as_str() {
            "Micro" => vec![
                ("range", "Range", "Speed threshold before increasing sensitivity", 1.0..=100.0),
                ("growth_base", "Rate", "How quickly sensitivity increases", 1.001..=1.5),
                ("max_sens", "Max", "Maximum sensitivity multiplier", 0.1..=5.0),
            ],
            _ => vec![
                ("range", "Range", "Speed threshold before increasing sensitivity", 0.0..=100.0),
                ("growth_base", "Rate", "How quickly sensitivity increases", 1.001..=1.5),
                ("max_sens", "Max", "Maximum sensitivity multiplier", 0.1..=10.0),
            ],
        };

        let config = get_config();
        ui.vertical_centered(|ui| {
            for (name, label, tooltip, range) in setting_specs {
                if let Some(mut value) = current_settings.get(name).copied() {
                    if self.create_setting_row(ui, label, tooltip, &mut value, range, &config) {
                        let settings = match active_tab.as_str() {
                            "Micro" => &mut self.micro_settings,
                            "Tracking" => &mut self.tracking_settings,
                            "Flicking" => &mut self.flicking_settings,
                            _ => &mut self.micro_settings,
                        };
                        settings.insert(name.to_string(), value);
                        self.settings_modified = true;
                    }
                }
            }
        });
    }

    fn create_setting_row(
        &self,
        ui: &mut egui::Ui,
        label: &str,
        tooltip: &str,
        value: &mut f64,
        range: std::ops::RangeInclusive<f64>,
        config: &AppConfig,
    ) -> bool {
        let mut changed = false;
        ui.horizontal(|ui| {
            config.guidelines.label_frame().show(ui, |ui| {
                ui.add_sized(
                    [config.guidelines.label_width - 8.0, config.guidelines.widget_height],
                    egui::Label::new(label).sense(egui::Sense::hover()).selectable(false)
                )
            }).response.on_hover_text(tooltip);

            let slider_width = config.guidelines.slider_width - config.guidelines.value_width - 4.0;
            if ui.add_sized(
                [slider_width, 20.0],
                egui::Slider::new(value, range.clone()).show_value(false)
            ).changed() {
                changed = true;
            }

            config.guidelines.value_frame().show(ui, |ui| {
                let decimals = if *value < 10.0 { 3 } else if *value < 100.0 { 2 } else { 1 };
                let formatted = format!("{:^6.1$}", value, decimals);
                let mut text = formatted.clone();
                if ui.add_sized(
                    [config.guidelines.value_width, config.guidelines.widget_height],
                    egui::TextEdit::singleline(&mut text)
                        .desired_width(config.guidelines.value_width)
                        .clip_text(false)
                        .frame(false)
                        .horizontal_align(egui::Align::Center)
                ).changed() {
                    if let Ok(parsed_value) = text.parse() {
                        *value = parsed_value;
                        changed = true;
                    }
                }
            });
        });
        changed
    }

    fn draw_action_buttons(&mut self, ui: &mut egui::Ui) {
        let config = get_config();
        ui.add_space(config.guidelines.margin);
        ui.horizontal(|ui| {
            let button_size = egui::vec2((ui.available_width() - 32.0) / 2.0, config.guidelines.button_height);
            
            if ui.add_sized(
                button_size,
                egui::Button::new(
                    egui::RichText::new("Reset").color(config.colors.text_secondary)
                )
                .fill(config.colors.error)
                .corner_radius(config.guidelines.corner_radius)
            ).clicked() {
                self.reset_to_defaults_with_config(&config.defaults);
            }
            
            ui.add_space(8.0);
            
            if ui.add_sized(
                button_size,
                egui::Button::new(
                    egui::RichText::new("Export LUT").color(config.colors.text_secondary)
                )
                .fill(config.colors.primary)
                .corner_radius(config.guidelines.corner_radius)
            ).clicked() {
                self.export_lut_to_clipboard();
            }
        });
    }

    fn draw_plot_header(&self, ui: &mut egui::Ui) {
        let config = get_config();
        ui.vertical_centered(|ui| {
            ui.add(egui::Label::new(
                egui::RichText::new("Sensitivity Curve")
                    .color(config.colors.text_primary)
                    .strong()
                    .size(24.0)
            ).selectable(false));
            ui.add_space(8.0);
        });
    }
}

impl App for NeuroAccelApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut Frame) {
        let config = get_config();
        ctx.set_visuals(egui::Visuals {
            override_text_color: Some(config.colors.text_primary),
            window_fill: config.colors.bg_primary,
            panel_fill: config.colors.bg_primary,
            extreme_bg_color: config.colors.bg_primary,
            ..Default::default()
        });

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.painter().rect_filled(
                ui.available_rect_before_wrap(),
                0.0,
                egui::Color32::BLACK,
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::TOP), |ui| {
                let settings_width: f32 = 240.0;
                let available_width = ui.available_width();
                let graph_min_width: f32 = 500.0;

                // Settings panel (now on right)
                ui.allocate_ui_with_layout(
                    egui::vec2(settings_width.min(available_width * 0.3), ui.available_height()),
                    egui::Layout::top_down_justified(egui::Align::Center),
                    |ui| self.draw_settings_panel(ui)
                );

                ui.add_space(8.0);

                // Main plot (now on left)
                if available_width - settings_width >= graph_min_width {
                    ui.with_layout(
                        egui::Layout::top_down_justified(egui::Align::Center),
                        |ui| self.draw_main_plot(ui)
                    );
                }
            });
        });

        if self.settings_modified {
            self.save_settings();
            self.settings_modified = false;
        }
    }
}

fn main() {
    let config = AppConfig::default();
    let options = NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size(config.window.size)
            .with_min_inner_size(config.window.min_size)
            .with_resizable(config.window.resizable)
            .with_decorations(config.window.decorations)
            .with_transparent(true)
            .with_transparent(true),
        ..Default::default()
    };
    
    eframe::run_native(
        "NeuroCurve",
        options,
        Box::new(|cc| {
            install_image_loaders(&cc.egui_ctx);
            cc.egui_ctx.set_style(egui::Style {
                interaction: egui::style::Interaction {
                    tooltip_delay: 0.0,
                    ..Default::default()
                },
                ..Default::default()
            });
            Ok(Box::new(NeuroAccelApp::new()))
        }),
    ).unwrap();
}