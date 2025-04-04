const {invoke} = window.__TAURI__.core, {getCurrentWindow} = window.__TAURI__.window, appWindow = getCurrentWindow(), $ = s => document.querySelector(s), Chart = window.Chart;
const throttle = (f, l) => {let i; return function() {if (!i) {f.apply(this, arguments); i = true; setTimeout(() => i = false, l);}}};
const formatNumber = n => Number.isInteger(n) ? n.toString() : n.toString().replace(/\.?0+$/, '');
let chart = null, settings = null;

const applyWebView2Optimizations = () => navigator.userAgent.includes('Edg') && window.chrome && (document.body.classList.add('webview2'),
    cfg.chart.options.animation.duration = 600, cfg.chart.options.animation.easing = 'linear',
    cfg.chart.options.scales.x.grid.color = cfg.chart.options.scales.y.grid.color = 'rgba(255,255,255,0.1)',
    document.head.appendChild(Object.assign(document.createElement('style'), {textContent: `.webview2 .plot-panel,.webview2 .settings-panel{background:rgba(0,0,0,.97)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.webview2 .panel-header h2{background:linear-gradient(120deg,var(--text-primary) 0%,var(--primary) 50%,var(--text-primary) 100%);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:grad 32s linear infinite}.webview2 .panel-header h2::after{content:'';position:absolute;bottom:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--primary),transparent);animation:glow 16s ease infinite}.webview2 #sensitivity-plot{image-rendering:auto}`})),
    $('#sensitivity-plot')?.getContext('2d', {alpha: false, desynchronized: true, powerPreference: 'high-performance'}));
const updatePlot = async (animate = true) => {
    if (!settings || !$('#sensitivity-plot')) return;
    const points = await invoke('calculate_curve', {settings}),
          maxY = Math.max(...points.map(p => p[1])) + 0.5,
          maxX = Math.max(...points.map(p => p[0]));
    if (chart) {
        chart.data.datasets[0].data = chart.data.datasets[1].data = points.map(p => p[1]);
        chart.data.labels = points.map(p => parseFloat(p[0]));
        chart.options.scales.y.max = maxY;
        chart.options.scales.x.max = maxX;
        chart.update({duration: animate ? 300 : 0, easing: 'easeOutCubic', lazy: true});
    } else createChart(points, maxY);
},
updatePlotThrottled = throttle(updatePlot, 100);

const chartAreaBorder = {
    id: 'chartAreaBorder',
    beforeDraw(chart) {
        const {ctx, chartArea: {left, top, width, height}} = chart;
        ctx.save(); ctx.lineWidth = 2;
        const path = new Path2D(); path.rect(left, top, width, height);
        const perimeter = 2 * (width + height), glowLength = perimeter * 0.2,
              time = Date.now() % 12000,
              pos1 = time / 12000, pos2 = ((time + 6000) % 12000) / 12000,
              getPos = prog => {
                  const pos = prog * perimeter, d = pos % perimeter;
                  return d < width ? [left + d, top] :
                      d < width + height ? [left + width, top + (d - width)] :
                      d < 2 * width + height ? [left + width - (d - (width + height)), top + height] :
                      [left, top + height - (d - (2 * width + height))];
              };

        for (const pos of [pos1, pos2]) {
            const [x1, y1] = getPos(pos), [x2, y2] = getPos((pos + glowLength/perimeter) % 1),
                  gradient = ctx.createLinearGradient(x1, y1, x2, y2);
            gradient.addColorStop(0, 'rgba(255,255,255,0.05)');
            gradient.addColorStop(0.5, 'rgba(110,180,255,0.3)');
            gradient.addColorStop(1, 'rgba(255,255,255,0.05)');
            ctx.strokeStyle = gradient;
            ctx.stroke(path);
        }
        ctx.restore();
    }
};

const createChart = (points, maxValue) => {
    const data = points.map(p => p[1]),
          labels = points.map(p => parseFloat(p[0])),
          baseDataset = {
              data, fill: true, borderWidth: 2, pointRadius: 0, borderColor: 'rgba(77,159,255,0.8)',
              backgroundColor: ctx => {
                  if (!ctx?.chart?.chartArea) return 'rgba(77,159,255,0.05)';
                  const gradient = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.bottom, 0, ctx.chart.chartArea.top);
                  gradient.addColorStop(0, 'rgba(77,159,255,0.01)');
                  gradient.addColorStop(1, 'rgba(77,159,255,0.15)');
                  return gradient;
              },
              cubicInterpolationMode: 'monotone', tension: 0.4, capBezierPoints: true
          };

    chart = new Chart($('#sensitivity-plot'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {...baseDataset},
                {
                    ...baseDataset, backgroundColor: 'transparent', borderWidth: 4, fill: false,
                    borderColor: ctx => {
                        if (!ctx?.chart?.ctx) return 'transparent';
                        const progress = (Date.now() % 3000) / 3000,
                              gradient = ctx.chart.ctx.createLinearGradient(0, 0, ctx.chart.width, 0);
                        gradient.addColorStop(Math.max(0, progress - 0.2), 'transparent');
                        gradient.addColorStop(progress, 'rgba(110,180,255,0.8)');
                        gradient.addColorStop(Math.min(1, progress + 0.2), 'transparent');
                        return gradient;
                    }
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: {duration: 300, easing: 'easeOutCubic'},
            plugins: {legend: {display: false}, tooltip: false},
            scales: {
                x: {
                    grid: {color: 'rgba(255,255,255,0.05)'}, border: {display: false}, position: 'bottom',
                    type: 'linear', beginAtZero: true, max: Math.max(...points.map(p => p[0])),
                    title: {display: true, text: 'Input Speed (counts/ms)', color: 'rgba(255,255,255,0.6)'}
                },
                y: {
                    grid: {color: 'rgba(255,255,255,0.05)'}, border: {display: false}, position: 'left',
                    beginAtZero: true, min: 0, max: maxValue,
                    title: {display: true, text: 'Sensitivity Multiplier', color: 'rgba(255,255,255,0.6)'},
                    ticks: {callback: v => formatNumber(parseFloat(v))}
                }
            }
        },
        plugins: [chartAreaBorder]
    });

    const animate = () => {
        if (!document.hidden) chart.update('none');
        chart.animationFrame = requestAnimationFrame(animate);
    };
    chart.animationFrame = requestAnimationFrame(animate);
};

const chartConfig = {
    options: {
        responsive: true, maintainAspectRatio: false,
        animation: {duration: 1200, easing: 'easeInOutQuart'},
        plugins: {legend: {display: false}, tooltip: false},
        elements: {point: {radius: 0}, line: {tension: 0.4, borderWidth: 2.5}},
        devicePixelRatio: window.devicePixelRatio || 1,
        scales: {
            x: {
                grid: {color: 'rgba(255,255,255,0.03)', borderColor: 'transparent'},
                border: {display: false}, position: 'bottom',
                ticks: {color: 'rgba(255,255,255,0.4)', font: {size: 11}, maxTicksLimit: 10},
                title: {display: true, text: 'Input Speed (counts/ms)', color: 'rgba(255,255,255,0.6)'}
            },
            y: {
                grid: {color: 'rgba(255,255,255,0.03)', borderColor: 'transparent'},
                border: {display: false}, position: 'left', beginAtZero: true,
                ticks: {color: 'rgba(255,255,255,0.4)', font: {size: 11}},
                title: {display: true, text: 'Sensitivity Multiplier', color: 'rgba(255,255,255,0.6)'}
            }
        }
    }
};

let cfg = {
    chart: chartConfig,
    curveSettings: {},
    rawAccelSettings: {}
};

const loadDefaultConfigurations = async () => {
    try {
        const defaultSettings = await invoke('get_all_default_settings');
        cfg.curveSettings = defaultSettings.curve_settings;
        cfg.rawAccelSettings = defaultSettings.raw_accel_settings;
        return true;
    } catch (error) {
        console.error('Failed to load default settings:', error);
        return false;
    }
};

class SettingsManager {
    constructor() {
        this.rawAccelPath = '';
        this.rawAccelSettings = {};
        this.initCurveSettings();
        this.initRawAccelSettings();
        $('#select-path-btn').onclick = this.handleBrowseClick.bind(this);
    }

    async loadSavedSettings() {
        try {
            const appSettings = await invoke('load_app_settings');

            if (appSettings.curve_settings?.values) {
                settings = appSettings.curve_settings;
                Object.entries(settings.values).forEach(([key, value]) => {
                    const input = $(`#${key}-value`);
                    if (input) input.value = formatNumber(value);
                });
            }

            if (appSettings.raw_accel_settings) {
                this.rawAccelSettings = appSettings.raw_accel_settings;
                Object.entries(this.rawAccelSettings).forEach(([key, value]) => {
                    const input = $(`#${key}-value`);
                    if (input) input.value = formatNumber(value);
                });
            }

            if (appSettings.raw_accel_path) {
                this.rawAccelPath = appSettings.raw_accel_path;
                const pathDisplay = $('#path-display');
                pathDisplay.innerHTML = `<span title="${this.rawAccelPath}">${this.rawAccelPath}</span>`;
                pathDisplay.classList.add('path-selected');
            }

            updatePlotThrottled(true);
            return true;
        } catch (error) {
            console.error('Failed to load saved settings:', error);
            return false;
        }
    }

    async saveSettings() {
        try {
            const appSettings = {
                curve_settings: settings,
                raw_accel_settings: this.rawAccelSettings,
                raw_accel_path: this.rawAccelPath
            };

            await invoke('save_app_settings', { appSettings });
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return false;
        }
    }

    resetRawAccelSettings() {
        const rawAccelSettingOrder = ['dpi', 'polling_rate', 'sens_multiplier', 'y_x_ratio', 'rotation', 'angle_snapping'];

        rawAccelSettingOrder.forEach(key => {
            const info = cfg.rawAccelSettings[key];
            if (!info) return;

            const defaultValue = info.default;
            this.rawAccelSettings[key] = defaultValue;

            const input = $(`#${key}-value`);
            if (input) input.value = formatNumber(defaultValue);
        });
    }

    initCurveSettings() {
        const template = $('#setting-row-template');
        const curveSettingsContainer = $('#curve-settings');
        if (!template || !curveSettingsContainer) return;

        ['min_sens', 'max_sens', 'offset', 'range', 'growth_base'].forEach(key => {
            const info = cfg.curveSettings[key];
            if (!info) return;

            const row = template.content.cloneNode(true),
                  label = row.querySelector('.setting-label'),
                  input = row.querySelector('.setting-value');

            label.textContent = info.label;
            label.setAttribute('for', `${key}-value`);
            input.id = `${key}-value`;
            Object.assign(input, {min: info.min, max: info.max});
            curveSettingsContainer.appendChild(row);

            input.onchange = e => {
                const value = parseFloat(e.target.value);
                e.target.value = formatNumber(value);
                this.updateCurveValue(key, value);
            };

            input.oninput = e => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) settings.values[key] = value;
            };
        });
    }

    initRawAccelSettings() {
        const template = $('#setting-row-template');
        const rawAccelSettingsContainer = $('#raw-accel-settings');
        if (!template || !rawAccelSettingsContainer) return;

        ['dpi', 'polling_rate', 'sens_multiplier', 'y_x_ratio', 'rotation', 'angle_snapping'].forEach(key => {
            const info = cfg.rawAccelSettings[key];
            if (!info) return;

            const row = template.content.cloneNode(true),
                  label = row.querySelector('.setting-label'),
                  input = row.querySelector('.setting-value');

            label.textContent = info.label;
            label.setAttribute('for', `${key}-value`);
            input.id = `${key}-value`;
            Object.assign(input, {min: info.min, max: info.max});
            input.value = formatNumber(info.default);
            rawAccelSettingsContainer.appendChild(row);

            this.rawAccelSettings[key] = info.default;

            input.onchange = e => {
                const value = parseFloat(e.target.value);
                e.target.value = formatNumber(value);
                this.updateRawAccelValue(key, value);
            };

            input.oninput = e => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) this.rawAccelSettings[key] = value;
            };
        });
    }

    updateCurveValue(key, value) {
        const input = $(`#${key}-value`),
              info = cfg.curveSettings[key];
        value = Math.min(Math.max(value, info.min), info.max);
        input.value = formatNumber(value);
        if (settings) {
            settings.values[key] = value;
            updatePlotThrottled(true);
            this.saveSettings();
        }
    }

    updateRawAccelValue(key, value) {
        const input = $(`#${key}-value`),
              info = cfg.rawAccelSettings[key];
        value = Math.min(Math.max(value, info.min), info.max);
        input.value = formatNumber(value);
        this.rawAccelSettings[key] = value;
        this.saveSettings();
    }

    async handleBrowseClick() {
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: 'Select Raw Accel Directory'
            });

            if (selected) {
                const path = Array.isArray(selected) ? selected[0] : selected;
                this.rawAccelPath = String(path);
                const pathDisplay = $('#path-display');
                pathDisplay.innerHTML = `<span title="${this.rawAccelPath}">${this.rawAccelPath}</span>`;
                pathDisplay.classList.add('path-selected');
                this.saveSettings();
            }
        } catch (error) {
            alert(`Failed to select directory: ${error}`);
        }
    }

    getRawAccelSettings() {
        return { path: this.rawAccelPath, settings: this.rawAccelSettings };
    }
}

let settingsManager;

const initializeSettings = async () => {
    settings = await invoke('get_default_settings');
    Object.entries(settings.values).forEach(([key, value]) => {
        const input = $(`#${key}-value`);
        if (input) input.value = formatNumber(value);
    });
};

const setupEventListeners = () => {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            const tabName = button.getAttribute('data-tab');
            button.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
        });
    });

    $('#reset-btn').onclick = async () => {
        const button = $('#reset-btn');
        button.disabled = true;
        settings = await invoke('get_default_settings');
        Object.entries(settings.values).forEach(([key, value]) => {
            const input = $(`#${key}-value`);
            if (input) input.value = formatNumber(value);
        });
        settingsManager.resetRawAccelSettings();
        await settingsManager.saveSettings();
        updatePlotThrottled(true);
        button.disabled = false;
    };

    $('#apply-btn').onclick = async () => {
        try {
            const button = $('#apply-btn');
            button.disabled = true;
            const rawAccelConfig = settingsManager.getRawAccelSettings();
            if (!rawAccelConfig.path) {
                alert('Please select a Raw Accel directory first');
                button.disabled = false;
                return;
            }
            await invoke('apply_to_raw_accel', {
                settings,
                rawAccelPath: rawAccelConfig.path,
                rawAccelSettings: rawAccelConfig.settings
            });
            await settingsManager.saveSettings();
            alert('Curve applied to Raw Accel successfully!');
            button.disabled = false;
        } catch (error) {
            alert(`Failed to apply curve: ${error}`);
            $('#apply-btn').disabled = false;
        }
    };

    $('#titlebar-minimize').onclick = () => appWindow.minimize();
    $('#titlebar-maximize').onclick = () => appWindow.toggleMaximize();
    $('#titlebar-close').onclick = () => appWindow.close();
};

const cleanupChart = () => {
    if (chart?.animationFrame) {
        cancelAnimationFrame(chart.animationFrame);
        chart.animationFrame = null;
    }
    if (chart) { chart.destroy(); chart = null; }
};

document.addEventListener('visibilitychange', () => {
    if (document.hidden && chart?.animationFrame) {
        cancelAnimationFrame(chart.animationFrame);
        chart.animationFrame = null;
    } else if (!document.hidden && chart && !chart.animationFrame) {
        const animate = () => {
            if (!document.hidden) chart.update('none');
            chart.animationFrame = requestAnimationFrame(animate);
        };
        chart.animationFrame = requestAnimationFrame(animate);
    }
});
document.addEventListener('DOMContentLoaded', async () => {
    applyWebView2Optimizations();
    await loadDefaultConfigurations();
    settingsManager = new SettingsManager();

    const loadedSettings = await settingsManager.loadSavedSettings();
    if (!loadedSettings) await initializeSettings();

    document.querySelector('.tab-button[data-tab="raw-accel"]').classList.add('active');
    document.getElementById('raw-accel-tab').classList.add('active');
    document.querySelector('.tab-button[data-tab="curve"]').classList.remove('active');
    document.getElementById('curve-tab').classList.remove('active');

    setupEventListeners();
    updatePlotThrottled();
});

document.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('beforeunload', cleanupChart);