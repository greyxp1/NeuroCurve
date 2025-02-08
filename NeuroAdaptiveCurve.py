import sys
import json
import numpy as np
import matplotlib.pyplot as plt
import tkinter as tk
from tkinter import ttk
from matplotlib import rcParams
import pyperclip
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

# Use winreg only on Windows.
if sys.platform.startswith('win'):
    import winreg

# -------------------------------
# Global Settings & Plotting Defaults
# -------------------------------
rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': ['Arial', 'DejaVu Sans', 'Liberation Sans', 'sans-serif'],
    'axes.facecolor': '#0d1117',
    'figure.facecolor': '#0d1117',
    'axes.labelcolor': 'white',
    'text.color': 'white',
    'xtick.color': 'white',
    'ytick.color': 'white',
    'grid.color': '#30363d',
    'grid.alpha': 0.3
})

# -------------------------------
# Helper Functions for Configuration Parsing
# -------------------------------
def parse_value(value_str, default):
    """
    Convert an entry string to a float/int or list of floats.
    If conversion fails, returns the default value.
    """
    try:
        if ',' in value_str:
            return [float(x.strip()) for x in value_str.split(',')]
        else:
            return float(value_str) if '.' in value_str else int(value_str)
    except Exception:
        return default

def get_config_from_entries(entries, default_config):
    """
    Reads configuration from the provided entry widgets.
    Returns a dictionary with parsed values.
    """
    config = {}
    for key, entry in entries.items():
        if key == 'dpi':
            config[key] = int(entry.get())  # Ensure DPI is integer
        else:
            config[key] = parse_value(entry.get(), default_config[key])
    return config

def validate_config(config):
    """
    Checks that all required keys exist, that the phase boundaries are
    monotonically increasing, and that the response_ratios list is of the correct length.
    Raises a ValueError if something is wrong.
    """
    required_keys = [
        "input_range", "phase_boundaries", "response_ratios",
        "transition_steepness", "hysteresis_window",
        "microscale_factor", "sensitivity_floor",
        "dpi"
    ]
    for key in required_keys:
        if key not in config:
            raise ValueError(f"Missing required parameter: {key}")
    boundaries = config['phase_boundaries']
    if not all(boundaries[i] < boundaries[i+1] for i in range(len(boundaries)-1)):
        raise ValueError("Phase boundaries must be monotonically increasing")
    if len(config['response_ratios']) != len(boundaries) + 1:
        raise ValueError("Response ratios count must match phase boundaries + 1")

# -------------------------------
# Neuroadaptive Curve Computation
# -------------------------------
def neuromorphic_transition(t, dpi):
    """
    Computes a transition value using a sigmoid modulated with a sine wave.
    """
    k = 2.5 + (dpi / 800)
    return 1 / (1 + np.exp(-k * (t - 0.6) * 10)) + 0.2 * np.sin(2 * np.pi * t)

def generate_neuroadaptive_curve(config):
    """
    Generates the x and y values for the neuroadaptive curve based on the configuration.
    """
    x = np.linspace(1, config['input_range'], config['input_range'])
    y = np.zeros_like(x, dtype=np.float64)
    
    bounds = config['phase_boundaries']
    ratios = config['response_ratios']
    micro_scale = config['microscale_factor']
    min_sens = config['sensitivity_floor']
    
    # Phase 1: Neuromorphic microscale control
    mask = x <= bounds[0]
    y[mask] = np.maximum(
        ratios[0] * (np.log1p(x[mask]) / np.log(2)) * micro_scale,
        min_sens
    )
    
    # Phase transitions with synaptic decay modeling
    for i in range(len(bounds)):
        lower = bounds[i - 1] if i > 0 else 0
        upper = bounds[i]
        phase_mask = (x > lower) & (x <= upper)
        t = (x[phase_mask] - lower) / (upper - lower)
        y[phase_mask] = ratios[i] + (ratios[i+1] - ratios[i]) * neuromorphic_transition(t, config['dpi'])
    
    # Stability enforcement
    mask = x > bounds[-1]
    y[mask] = ratios[-1] * (0.97 + 0.03 * np.tanh((x[mask] - bounds[-1]) / 50))
    
    # Hysteresis filtering
    h_window = config['hysteresis_window']
    for boundary in bounds:
        transition_zone = (x >= boundary - h_window) & (x <= boundary + h_window)
        y[transition_zone] = np.clip(
            y[transition_zone],
            ratios[bounds.index(boundary)],
            ratios[bounds.index(boundary)+1]
        )
    return x, y

# -------------------------------
# Registry Functions (Windows Only)
# -------------------------------
REG_PATH = r"Software\NeuroAdaptiveVisualizer"

def load_config_from_registry(default_config):
    """
    Load the configuration from the Windows registry.
    Returns a dictionary of configuration values.
    """
    config = default_config.copy()
    if not sys.platform.startswith('win'):
        return config  # On non-Windows platforms, simply return the default.
    try:
        registry_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH, 0, winreg.KEY_READ)
        for key, default_value in default_config.items():
            try:
                value, _ = winreg.QueryValueEx(registry_key, key)
                if isinstance(default_value, list):
                    config[key] = json.loads(value)
                elif isinstance(default_value, int):
                    config[key] = int(value)
                elif isinstance(default_value, float):
                    config[key] = float(value)
                else:
                    config[key] = value
            except Exception:
                pass  # If a key is missing, leave the default.
        winreg.CloseKey(registry_key)
    except Exception as e:
        print("Could not load config from registry:", e)
    return config

def save_config_to_registry(config):
    """
    Save the configuration dictionary to the Windows registry.
    """
    if not sys.platform.startswith('win'):
        return  # Skip if not on Windows.
    try:
        registry_key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_PATH)
        for key, value in config.items():
            value_str = json.dumps(value) if isinstance(value, list) else str(value)
            winreg.SetValueEx(registry_key, key, 0, winreg.REG_SZ, value_str)
        winreg.CloseKey(registry_key)
    except Exception as e:
        print("Could not save config to registry:", e)

# -------------------------------
# Main Application Class
# -------------------------------
class CombinedVisualizer:
    def __init__(self):
        # Default configuration values.
        self.default_config = {
            "input_range": 257,
            "phase_boundaries": [18, 55, 130],
            "response_ratios": [0.35, 0.65, 1.05, 1.45],
            "transition_steepness": 1.8,
            "hysteresis_window": 5,
            "microscale_factor": 0.38,
            "sensitivity_floor": 0.08,
            "dpi": 1600
        }
        # Load the persistent configuration (if available).
        self.current_config = load_config_from_registry(self.default_config)
        
        self.root = tk.Tk()
        self.root.title("NeuroAdaptive Visualizer")
        self.root.geometry("1300x1000")
        self.root.minsize(1300, 1000)
        
        self.left_frame = tk.Frame(self.root)
        self.left_frame.grid(row=0, column=0, sticky="nsew")
        
        self.right_container = tk.Frame(self.root, bg='#0d1117')
        self.right_container.grid(row=0, column=1, columnspan=2, sticky="nsew")
        
        self.config_frame = tk.Frame(self.right_container, bg='#0d1117')
        self.config_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.right_frame = tk.Frame(self.right_container, bg='#0d1117')
        self.right_frame.pack(fill=tk.BOTH, expand=True)
        
        self.root.grid_columnconfigure(0, weight=2)
        self.root.grid_columnconfigure(1, weight=2)
        self.root.grid_rowconfigure(0, weight=1)
        
        self.create_config_panel()
        self.update_plot()
        
        self.author_label = tk.Label(self.root, text="Created by Greyxp1",
                                     bg='#0d1117', fg='white',
                                     font=("Helvetica", 8, "italic"))
        self.author_label.place(relx=0.0, rely=1.0, anchor='sw', x=10, y=-10)

    def create_config_panel(self):
        """Creates the configuration panel with labels, entry fields, and control buttons."""
        self.config_vars = {}
        for i, key in enumerate(self.default_config.keys()):
            value = self.current_config.get(key, self.default_config[key])
            label = tk.Label(self.config_frame, text=key, bg='#0d1117', fg='white')
            label.grid(row=i, column=0, padx=5, pady=5, sticky="w")
            
            if key == 'dpi':
                # Create a Combobox for DPI selection
                entry = ttk.Combobox(self.config_frame, values=[400, 800, 1600, 3200, 6400], state="readonly")
                entry.set(str(value))
            else:
                entry = tk.Entry(self.config_frame, bg='#30363d', fg='white', insertbackground='white')
                if isinstance(value, list):
                    entry.insert(0, ', '.join(map(str, value)))
                else:
                    entry.insert(0, str(value))
            entry.grid(row=i, column=1, padx=5, pady=5, sticky="ew")
            self.config_vars[key] = entry

        # Create the Update and Reset buttons with matching padding.
        update_button = tk.Button(self.config_frame, text="Update", bg="#58a6ff", fg="white",
                                  font=("Helvetica", 10, "bold"), command=self.update_plot,
                                  relief=tk.FLAT, bd=0)
        update_button.grid(row=len(self.default_config), column=0, columnspan=2, padx=5, pady=5, sticky="ew")
        
        reset_button = tk.Button(self.config_frame, text="Reset to Default", bg="#da3633", fg="white",
                                  font=("Helvetica", 10, "bold"), command=self.reset_config,
                                  relief=tk.FLAT, bd=0)
        reset_button.grid(row=len(self.default_config)+1, column=0, columnspan=2, padx=5, pady=5, sticky="ew")

    def update_plot(self):
        """
        Reads values from the configuration entries, validates and saves the config,
        then regenerates the curve and updates the display.
        """
        config = get_config_from_entries(self.config_vars, self.default_config)
        try:
            validate_config(config)
        except Exception as e:
            print("Configuration error:", e)
            return
        
        # Check if DPI has changed and scale parameters accordingly
        current_dpi = self.current_config.get('dpi', self.default_config['dpi'])
        new_dpi = config['dpi']
        if new_dpi != current_dpi:
            scale_phase = new_dpi / current_dpi
            scale_response = current_dpi / new_dpi
            
            # Scale phase boundaries
            phase_entry = self.config_vars['phase_boundaries']
            current_phase = parse_value(phase_entry.get(), self.default_config['phase_boundaries'])
            scaled_phase = [x * scale_phase for x in current_phase]
            phase_entry.delete(0, tk.END)
            phase_entry.insert(0, ', '.join(map(str, scaled_phase)))
            
            # Scale response ratios
            response_entry = self.config_vars['response_ratios']
            current_response = parse_value(response_entry.get(), self.default_config['response_ratios'])
            scaled_response = [r * scale_response for r in current_response]
            response_entry.delete(0, tk.END)
            response_entry.insert(0, ', '.join(map(str, scaled_response)))
            
            # Re-fetch the config with scaled values
            config = get_config_from_entries(self.config_vars, self.default_config)
        
        self.current_config = config
        save_config_to_registry(config)
        
        x, y = generate_neuroadaptive_curve(config)
        self.draw_modern_curve(x, y)
        self.update_lut_text(x, y)

    def draw_modern_curve(self, x, y):
        """Creates the matplotlib figure and draws the neuroadaptive curve."""
        if hasattr(self, 'canvas'):
            self.canvas.get_tk_widget().destroy()
        
        self.fig = plt.Figure(figsize=(8, 10), dpi=120)
        self.ax_plot = self.fig.add_subplot(111)
        
        mask = x <= 150
        x_visible, y_visible = x[mask], y[mask]
        y_max = np.max(y_visible)
        
        # Plot main curve and a glow effect underneath.
        self.ax_plot.plot(x_visible, y_visible, color='#58a6ff', lw=3, zorder=5)
        self.ax_plot.plot(x_visible, y_visible, color='#1f6feb', lw=8, alpha=0.15, zorder=4)
        self.ax_plot.set_xlim(0, 150)
        self.ax_plot.set_ylim(np.min(y_visible), y_max * 1.1)
        
        # Draw vertical dashed lines at the phase boundaries.
        try:
            boundaries = [float(x.strip()) for x in self.config_vars['phase_boundaries'].get().split(',')]
        except Exception:
            boundaries = []
        for bound in boundaries:
            self.ax_plot.axvline(bound, color='white', ls='--', lw=1, alpha=0.8, zorder=6)
        
        # Add phase labels (if there are at least 3 boundaries).
        if len(boundaries) >= 3:
            x1, x2, x3 = boundaries[0], boundaries[1], boundaries[2]
            label_y = y_max * 1.08
            phase_labels = ["Precision\nControl Field", "Dynamic\nResponse Field", "Stabilized\nOutput Field"]
            phase_colors = ['#238636', '#da3633', '#8957e5']
            for x_pos, label, color in zip([x1, x2, x3], phase_labels, phase_colors):
                bbox = dict(boxstyle="round,pad=0.3", fc='#0d1117', ec=color, alpha=0.9)
                self.ax_plot.text(x_pos, label_y, label, ha='center', va='top',
                                  color=color, fontsize=10, fontweight='bold', zorder=7, bbox=bbox)
        
        # Add arrow annotations.
        bbox_annot = dict(boxstyle="round,pad=0.3", fc='#0d1117', ec='#30363d', alpha=0.9)
        if len(boundaries) >= 2:
            arrow_x1 = boundaries[0]
            arrow_x2 = boundaries[1]
            arrow_x3 = (boundaries[1] + boundaries[2]) / 2 if len(boundaries) > 2 else boundaries[1]
            self.ax_plot.annotate(
                f"Microscale Domain\n({self.config_vars['response_ratios'].get().split(',')[0]}× base)",
                xy=(arrow_x1, np.interp(arrow_x1, x, y)), xytext=(25, -40),
                textcoords='offset points', arrowprops=dict(arrowstyle="->", color='#2ea043'),
                bbox=bbox_annot, color='#2ea043', fontsize=9, ha='center', zorder=11, clip_on=False)
            try:
                ratios = [float(r.strip()) for r in self.config_vars['response_ratios'].get().split(',')]
                delta_r = ratios[1] - ratios[0]
            except Exception:
                delta_r = 0
            self.ax_plot.annotate(
                f"Transition Gradient\nΔR = {delta_r:+.2f}",
                xy=(arrow_x2, np.interp(arrow_x2, x, y)), xytext=(20, -45),
                textcoords='offset points', arrowprops=dict(arrowstyle="->", color='#da3633'),
                bbox=bbox_annot, color='#da3633', fontsize=9, ha='center', zorder=11, clip_on=False)
            self.ax_plot.annotate(
                f"Stabilized Output\nσ = {self.config_vars['response_ratios'].get().split(',')[-1]}±0.03",
                xy=(arrow_x3, np.interp(arrow_x3, x, y)), xytext=(40, -40),
                textcoords='offset points', arrowprops=dict(arrowstyle="->", color='#8957e5'),
                bbox=bbox_annot, color='#8957e5', fontsize=9, ha='center', zorder=11, clip_on=False)
        
        self.ax_plot.set_xlabel('Input Velocity (counts/ms)', fontsize=12, labelpad=10)
        self.ax_plot.set_ylabel('Sensitivity Multiplier (κ)', fontsize=12, labelpad=10)
        self.ax_plot.set_title("NeuroAdaptive Response Profile", pad=20, fontsize=16, fontweight='bold')
        self.ax_plot.grid(True, which='both', ls='--', alpha=0.4)
        
        # Add a secondary x-axis for effective CPI.
        secax = self.ax_plot.secondary_xaxis('top', functions=(
            lambda x: x * float(self.config_vars['dpi'].get()) / 1000,
            lambda x: x * 1000 / float(self.config_vars['dpi'].get())
        ))
        secax.set_xlabel('Effective CPI', fontsize=10, labelpad=8)
        
        self.canvas = FigureCanvasTkAgg(self.fig, master=self.left_frame)
        self.canvas.draw()
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

    def update_lut_text(self, x, y):
        """Updates the lookup text area with the full response profile."""
        self.x = x
        self.y = y
        
        if hasattr(self, 'main_container'):
            self.main_container.destroy()
        
        config = get_config_from_entries(self.config_vars, self.default_config)
        header = (
            f"Neuroadaptive Response Profile\n"
            f"DPI: {config['dpi']}\n"
            f"Phase Boundaries: {config['phase_boundaries']}\n"
            f"Response Ratios: {config['response_ratios']}\n"
            f"Microscale Factor: {config['microscale_factor']}\n"
            f"Sensitivity Floor: {config['sensitivity_floor']}\n\n"
            f"Full Response Profile:\n"
        )
        body = "\n".join([f"{xi:.0f},{yi:.6f}" for xi, yi in zip(x, y)])
        full_lut = header + body
        
        self.main_container = tk.Frame(self.right_frame, bg='#0d1117')
        self.main_container.pack(fill=tk.BOTH, expand=True)
        
        self.text_container = tk.Frame(self.main_container, bg='#0d1117', width=300, height=500)
        self.text_container.pack(fill=tk.BOTH, expand=True, padx=5, pady=(5, 0))
        self.text_container.pack_propagate(False)
        
        self.text_widget = tk.Text(self.text_container, wrap=tk.NONE, font=("Consolas", 10),
                                    bg='#0d1117', fg='white', insertbackground='white', bd=0,
                                    relief=tk.FLAT, highlightthickness=0, width=40)
        self.text_widget.config(padx=10, pady=10)
        self.text_widget.insert(tk.END, full_lut)
        self.text_widget.grid(row=0, column=0, sticky="nsew")
        
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("Vertical.TScrollbar",
                        gripcount=0,
                        background="#30363d",
                        darkcolor="#0d1117",
                        lightcolor="#0d1117",
                        troughcolor="#0d1117",
                        bordercolor="#0d1117",
                        arrowcolor="white",
                        relief="flat")
                        
        self.scrollbar = ttk.Scrollbar(self.text_container, orient=tk.VERTICAL,
                                        style="Vertical.TScrollbar",
                                        command=self.text_widget.yview)
        self.text_widget.config(yscrollcommand=self.scrollbar.set)
        self.scrollbar.grid(row=0, column=1, sticky="ns")
        
        self.text_container.grid_rowconfigure(0, weight=1)
        self.text_container.grid_columnconfigure(0, weight=1)
        
        self.copy_button = tk.Button(self.main_container, text="Copy", bg="#58a6ff", fg="white",
                                     font=("Helvetica", 10, "bold"), command=self.copy_to_clipboard,
                                     relief=tk.FLAT, bd=0)
        self.copy_button.pack(pady=(5, 10), padx=5, fill=tk.X)

    def copy_to_clipboard(self):
        """
        Copies only the x,y lookup data to the clipboard.
        The output is formatted as a single line of semicolon-separated pairs:
        e.g. 1,0.370521;2,0.388567;3,0.401962;...
        """
        try:
            body = ";".join(f"{xi:.0f},{yi:.6f}" for xi, yi in zip(self.x, self.y))
            pyperclip.copy(body)
            self.copy_button.config(text="Copied!")
            self.root.after(2000, lambda: self.copy_button.config(text="Copy"))
        except Exception as e:
            print(f"Copy error: {e}")
            self.copy_button.config(text="Error")
            self.root.after(2000, lambda: self.copy_button.config(text="Copy"))

    def reset_config(self):
        """Resets all configuration entries to their default values and updates the plot."""
        for key, default_value in self.default_config.items():
            entry = self.config_vars.get(key)
            entry.delete(0, tk.END)
            if isinstance(default_value, list):
                entry.insert(0, ', '.join(map(str, default_value)))
            else:
                entry.insert(0, str(default_value))
        self.current_config = self.default_config.copy()
        save_config_to_registry(self.default_config)
        self.update_plot()

    def run(self):
        self.root.mainloop()

# -------------------------------
# Main Entry Point
# -------------------------------
if __name__ == "__main__":
    app = CombinedVisualizer()
    app.run()