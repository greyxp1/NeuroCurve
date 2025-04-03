const {invoke} = window.__TAURI__.core, {getCurrentWindow} = window.__TAURI__.window, appWindow = getCurrentWindow(), $ = s => document.querySelector(s), Chart = window.Chart;
const throttle = (f, l) => {let i; return function() {if (!i) {f.apply(this, arguments); i = true; setTimeout(() => i = false, l);}}},
      formatNumber = n => Number.isInteger(n) ? n.toString() : n.toString().replace(/\.?0+$/, '');
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
        const data = points.map(p => p[1]);
        chart.data.datasets[0].data = chart.data.datasets[1].data = data;
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
    const maxX = Math.max(...points.map(p => p[0])),
          data = points.map(p => p[1]),
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
                    type: 'linear', beginAtZero: true, max: maxX,
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

const cfg = {
    chart: {
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: {duration: 1200, easing: 'easeInOutQuart', delay: ctx => ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 3 : 0},
            plugins: {legend: {display: false}, tooltip: false, decimation: {enabled: true, algorithm: 'min-max'}},
            elements: {point: {radius: 0, hoverRadius: 0}, line: {tension: 0.4, borderWidth: 2.5}},
            transitions: {active: {animation: {duration: 400}}},
            devicePixelRatio: window.devicePixelRatio || 1,
            scales: {
                x: {
                    grid: {color: 'rgba(255,255,255,0.03)', drawTicks: false, borderColor: 'transparent', borderWidth: 0, drawOnChartArea: true},
                    border: {display: false}, position: 'bottom',
                    ticks: {color: 'rgba(255,255,255,0.4)', font: {size: 11, family: 'Inter'}, maxRotation: 0, padding: 10, callback: v => parseFloat(v), maxTicksLimit: 10},
                    title: {display: true, text: 'Input Speed (counts/ms)', color: 'rgba(255,255,255,0.6)', font: {size: 12, family: 'Inter', weight: '500'}, padding: {top: 15}}
                },
                y: {
                    grid: {color: 'rgba(255,255,255,0.03)', drawTicks: false, borderColor: 'transparent', borderWidth: 0, drawOnChartArea: true},
                    border: {display: false}, position: 'left', beginAtZero: true,
                    ticks: {color: 'rgba(255,255,255,0.4)', font: {size: 11, family: 'Inter'}, padding: 10, callback: v => parseFloat(v).toFixed(2)},
                    title: {display: true, text: 'Sensitivity Multiplier', color: 'rgba(255,255,255,0.6)', font: {size: 12, family: 'Inter', weight: '500'}, padding: {bottom: 15}}
                }
            }
        }
    },
    settings: {
        min_sens: {label: 'Base Sensitivity', tooltip: 'Your base sensitivity multiplier when moving slowly or below the threshold speed', min: 0.1, max: 2, step: 0.05},
        max_sens: {label: 'Maximum Sensitivity', tooltip: 'The highest sensitivity multiplier when moving at or above maximum speed', min: 0.1, max: 5, step: 0.05},
        offset: {label: 'Speed Threshold', tooltip: 'Mouse movement speed (counts/ms) at which acceleration begins', min: 0, max: 50, step: 1},
        range: {label: 'Acceleration Range', tooltip: 'The speed range (counts/ms) over which sensitivity scales from base to maximum', min: 10, max: 200, step: 1},
        growth_base: {label: 'Acceleration Rate', tooltip: 'How aggressively sensitivity increases within the acceleration range (higher = more aggressive)', min: 1, max: 1.5, step: 0.001}
    }
};

class SettingsManager {
    constructor() {
        const template = $('#setting-row-template');
        Object.entries(cfg.settings).forEach(([key, info]) => {
            const row = template.content.cloneNode(true),
                  label = row.querySelector('.setting-label'),
                  input = row.querySelector('.setting-value');

            label.textContent = info.label;
            input.id = `${key}-value`;
            Object.assign(input, {min: info.min, max: info.max, step: info.step});
            $('#all-settings').appendChild(row);

            input.onchange = e => {
                const value = parseFloat(e.target.value);
                e.target.value = formatNumber(value);
                this.updateValue(key, value);
            };

            input.oninput = e => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) settings.values[key] = value;
            };
        });
    }

    updateValue(key, value) {
        const input = $(`#${key}-value`),
              info = cfg.settings[key];
        value = Math.min(Math.max(value, info.min), info.max);
        input.value = formatNumber(value);
        if (settings) {
            settings.values[key] = value;
            updatePlotThrottled(true);
        }
    }
}

const initializeSettings = async () => {
    settings = await invoke('get_default_settings');
    Object.entries(settings.values).forEach(([key, value]) => {
        $(`#${key}-value`).value = formatNumber(value);
    });
};

const setupEventListeners = () => {
    $('#reset-btn').onclick = async () => {
        const button = $('#reset-btn');
        button.disabled = true;
        settings = await invoke('get_default_settings');
        Object.entries(settings.values).forEach(([key, value]) => {
            $(`#${key}-value`).value = formatNumber(value);
        });
        updatePlotThrottled(true);
        button.disabled = false;
    };

    $('#export-btn').onclick = async () => {
        try {
            const points = await invoke('calculate_curve', {settings});
            await navigator.clipboard.writeText(
                points.slice(1).map(([x, y]) => `${x},${formatNumber(y)}`).join(';\n')
            );
        } catch (error) { console.error('Export failed:', error); }
    };

    $('#apply-btn').onclick = async () => {
        try {
            const button = $('#apply-btn');
            button.disabled = true;

            // Show a dialog to select the Raw Accel directory
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: 'Select Raw Accel Directory'
            });

            if (selected) {
                // Apply the curve to Raw Accel
                await invoke('apply_to_raw_accel', {
                    settings,
                    raw_accel_path: selected
                });

                // Show a success message
                alert('Curve applied to Raw Accel successfully!');
            }

            button.disabled = false;
        } catch (error) {
            console.error('Apply to Raw Accel failed:', error);
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

document.addEventListener('DOMContentLoaded', async () => {
    applyWebView2Optimizations();
    new SettingsManager();
    await initializeSettings();
    setupEventListeners();
    updatePlotThrottled();
});

document.addEventListener('contextmenu', e => e.preventDefault());

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

window.addEventListener('beforeunload', cleanupChart);