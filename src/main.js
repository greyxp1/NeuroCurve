const {invoke} = window.__TAURI__.core, {getCurrentWindow} = window.__TAURI__.window, appWindow = getCurrentWindow(), $ = s => document.querySelector(s), el = (t, c, a = {}) => Object.assign(document.createElement(t), {className: c, ...a});

const throttle = (f, l) => {
    let i;
    return function() {
        const a = arguments, c = this;
        if (!i) {
            f.apply(c, a);
            i = true;
            setTimeout(() => i = false, l);
        }
    };
};

const updatePlotThrottled = throttle(async (a = true) => {
    if (!settings || !$('#sensitivity-plot')) return;
    
    const p = await invoke('calculate_curve', {settings});
    const m = Math.max(...p.map(p => p[1])) + 0.5;
    const x = Math.max(...p.map(p => p[0]));

    if (chart) {
        const d = p.map(p => p[1]);
        chart.data.datasets[0].data = d;
        chart.data.datasets[1].data = d;
        chart.data.labels = p.map(p => parseFloat(p[0]));
        chart.options.scales.y.max = m;
        chart.options.scales.x.max = x;
        chart.update({duration: a ? 300 : 0, easing: 'easeOutCubic', lazy: true});
    } else {
        await createChart(p, m);
    }
}, 100);

const isWebView2 = () => navigator.userAgent.includes('Edg') && window.chrome;

const applyWebView2Optimizations = () => {
    if (isWebView2()) {
        document.body.classList.add('webview2');
        cfg.chart.options.animation.duration = 600;
        cfg.chart.options.animation.easing = 'linear';
        cfg.chart.options.scales.x.grid.color = 'rgba(255,255,255,0.1)';
        cfg.chart.options.scales.y.grid.color = 'rgba(255,255,255,0.1)';
        document.head.appendChild(Object.assign(document.createElement('style'), {
            textContent: `.webview2 .plot-panel,.webview2 .settings-panel{background:rgba(0,0,0,.97)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.webview2 .panel-header h2{background:linear-gradient(120deg,var(--text-primary) 0%,var(--primary) 50%,var(--text-primary) 100%);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:grad 32s linear infinite}.webview2 .panel-header h2::after{content:'';position:absolute;bottom:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,var(--primary),transparent);animation:glow 16s ease infinite}.webview2 #sensitivity-plot{image-rendering:auto}`
        }));
        const c = $('#sensitivity-plot');
        if (c) c.getContext('2d', {alpha: false, desynchronized: true, powerPreference: 'high-performance'});
    }
};

let chart = null, settings = null;

const cfg = {
    chart: {
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {duration: 1200, easing: 'easeInOutQuart', delay: ctx => ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 3 : 0},
            plugins: {legend: {display: false}, tooltip: false, decimation: {enabled: true, algorithm: 'min-max'}},
            elements: {point: {radius: 0, hoverRadius: 0}, line: {tension: 0.4, borderWidth: 2.5}},
            transitions: {active: {animation: {duration: 400}}},
            devicePixelRatio: window.devicePixelRatio || 1,
            scales: {
                x: {
                    grid: {color: 'rgba(255,255,255,0.03)', drawTicks: false, borderColor: 'transparent', borderWidth: 0, drawOnChartArea: true},
                    border: {display: false},
                    position: 'bottom',
                    ticks: {color: 'rgba(255,255,255,0.4)', font: {size: 11, family: 'Inter'}, maxRotation: 0, padding: 10, callback: v => parseFloat(v), maxTicksLimit: 10},
                    title: {display: true, text: 'Input Speed (counts/ms)', color: 'rgba(255,255,255,0.6)', font: {size: 12, family: 'Inter', weight: '500'}, padding: {top: 15}}
                },
                y: {
                    grid: {color: 'rgba(255,255,255,0.03)', drawTicks: false, borderColor: 'transparent', borderWidth: 0, drawOnChartArea: true},
                    border: {display: false},
                    position: 'left',
                    ticks: {color: 'rgba(255,255,255,0.4)', font: {size: 11, family: 'Inter'}, padding: 10, callback: v => parseFloat(v).toFixed(2)},
                    title: {display: true, text: 'Sensitivity Multiplier', color: 'rgba(255,255,255,0.6)', font: {size: 12, family: 'Inter', weight: '500'}, padding: {bottom: 15}},
                    beginAtZero: true
                }
            }
        }
    },
    settings: {
        min_sens: {label: 'Base Sensitivity', tooltip: 'Your base sensitivity multiplier when moving slowly or below the threshold speed', min: 0.1, max: 2, step: 0.001},
        max_sens: {label: 'Maximum Sensitivity', tooltip: 'The highest sensitivity multiplier when moving at or above maximum speed', min: 0.1, max: 5, step: 0.001},
        offset: {label: 'Speed Threshold', tooltip: 'Mouse movement speed (counts/ms) at which acceleration begins', min: 0, max: 50, step: 1},
        range: {label: 'Acceleration Range', tooltip: 'The speed range (counts/ms) over which sensitivity scales from base to maximum', min: 10, max: 200, step: 1},
        growth_base: {label: 'Acceleration Rate', tooltip: 'How aggressively sensitivity increases within the acceleration range (higher = more aggressive)', min: 1, max: 1.5, step: 0.001}
    }
};

class Tooltip {
    constructor() {
        this.tooltip = $('.floating-tooltip');
        this.timeout = null;
        this.currentTarget = null;
        document.addEventListener('mouseover', e => {
            const t = e.target.closest('[data-tooltip]');
            if (!t || getComputedStyle(t).cursor !== 'help') return;
            clearTimeout(this.timeout);
            this.currentTarget = t;
            this.timeout = setTimeout(() => {
                const r = t.getBoundingClientRect();
                this.show(t, r.left, r.top);
            }, 400);
        });
        document.addEventListener('mouseout', e => {
            const t = e.target.closest('[data-tooltip]');
            if (!t || getComputedStyle(t).cursor !== 'help') return;
            clearTimeout(this.timeout);
            this.hide();
        });
        document.addEventListener('scroll', () => this.updatePosition(), true);
        window.addEventListener('resize', () => this.updatePosition());
    }

    show(t, x, y) {
        if (!this.tooltip) return;
        this.tooltip.textContent = t.dataset.tooltip;
        this.tooltip.classList.add('visible');
        const tr = this.tooltip.getBoundingClientRect();
        const r = t.getBoundingClientRect();
        let l = r.right + 10;
        let top = r.top + (r.height - tr.height) / 2;
        if (l + tr.width > window.innerWidth) l = r.left - tr.width - 10;
        top = Math.max(10, Math.min(window.innerHeight - tr.height - 10, top));
        this.tooltip.style.left = `${l}px`;
        this.tooltip.style.top = `${top}px`;
    }

    hide() {
        if (this.tooltip) this.tooltip.classList.remove('visible');
    }

    updatePosition() {
        if (this.currentTarget && this.tooltip?.classList.contains('visible')) {
            const r = this.currentTarget.getBoundingClientRect();
            this.show(this.currentTarget, r.left, r.top);
        }
    }
}

class SettingsManager {
    constructor() {
        this.populateSettings();
        this.setupControls();
    }

    populateSettings() {
        const t = $('#setting-row-template');
        Object.entries(cfg.settings).forEach(([k, i]) => {
            const r = t.content.cloneNode(true);
            const e = {
                label: r.querySelector('.setting-label'),
                input: r.querySelector('.setting-value'),
                minus: r.querySelector('.minus'),
                plus: r.querySelector('.plus')
            };
            e.label.textContent = i.label;
            e.input.id = `${k}-value`;
            Object.assign(e.input, {min: i.min, max: i.max, step: i.step});
            e.minus.dataset.key = e.plus.dataset.key = k;
            $('#all-settings').appendChild(r);
        });
    }

    setupControls() {
        Object.keys(cfg.settings).forEach(k => {
            const input = $(`#${k}-value`);
            input.onchange = e => {
                const value = parseFloat(e.target.value);
                // Fix issue with displaying the correct value after typing
                e.target.value = value.toFixed(this.getDecimalPlaces(cfg.settings[k].step));
                this.updateValue(k, value);
            };
            
            // Also update on input to fix value display issues
            input.oninput = e => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) {
                    settings.values[k] = value;
                }
            };
        });

        document.querySelectorAll('.value-adjust').forEach(b => {
            b.onclick = () => {
                const k = b.dataset.key;
                const info = cfg.settings[k];
                const inp = $(`#${k}-value`);
                const currentValue = parseFloat(inp.value);
                const step = parseFloat(info.step);
                const delta = b.classList.contains('plus') ? step : -step;
                
                // Fix the incrementation issue by ensuring we respect the step value
                const newValue = this.roundToStep(currentValue + delta, step);
                const decimalPlaces = this.getDecimalPlaces(step);
                
                inp.value = newValue.toFixed(decimalPlaces);
                this.updateValue(k, newValue);
            };
        });
    }

    // Helper to get decimal places from step
    getDecimalPlaces(step) {
        const stepStr = step.toString();
        if (stepStr.includes('.')) {
            return stepStr.split('.')[1].length;
        }
        return 0;
    }

    // Helper to round to the nearest step
    roundToStep(value, step) {
        return Math.round(value / step) * step;
    }

    updateValue(k, v) {
        const inp = $(`#${k}-value`);
        const info = cfg.settings[k];
        v = Math.min(Math.max(v, info.min), info.max);
        
        // Format with appropriate decimal places
        const decimalPlaces = this.getDecimalPlaces(info.step);
        inp.value = v.toFixed(decimalPlaces);
        
        if (settings) {
            settings.values[k] = v;
            updatePlotThrottled(true);
        }
    }
}

const chartAreaBorder = {
    id: 'chartAreaBorder',
    beforeDraw(chart, args, options) {
        const {ctx, chartArea: {left, top, width, height}} = chart;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);
        const path = new Path2D();
        path.rect(left, top, width, height);
        const p = 2 * (width + height);
        const gl = p * 0.2;
        const t = Date.now() % 12000;
        const p1 = (t / 12000);
        const p2 = ((t + 6000) % 12000) / 12000;
        
        const getPos = (prog) => {
            const pos = prog * p;
            const d = pos % p;
            return d < width ? [left + d, top] :
                d < width + height ? [left + width, top + (d - width)] :
                d < 2 * width + height ? [left + width - (d - (width + height)), top + height] :
                [left, top + height - (d - (2 * width + height))];
        };
        
        const [x1, y1] = getPos(p1);
        const [x2, y2] = getPos((p1 + gl/p) % 1);
        
        const g1 = ctx.createLinearGradient(x1, y1, x2, y2);
        g1.addColorStop(0, 'rgba(255,255,255,0.05)');
        g1.addColorStop(0.5, 'rgba(110,180,255,0.3)');
        g1.addColorStop(1, 'rgba(255,255,255,0.05)');
        ctx.strokeStyle = g1;
        ctx.stroke(path);
        const [x3, y3] = getPos(p2);
        const [x4, y4] = getPos((p2 + gl/p) % 1);
        const g2 = ctx.createLinearGradient(x3, y3, x4, y4);
        g2.addColorStop(0, 'rgba(255,255,255,0.05)');
        g2.addColorStop(0.5, 'rgba(110,180,255,0.3)');
        g2.addColorStop(1, 'rgba(255,255,255,0.05)');
        ctx.strokeStyle = g2;
        ctx.stroke(path);
        ctx.restore();
    }
};

const createChart = async (points, maxValue) => {
    const maxX = Math.max(...points.map(p => p[0]));
    const baseDataset = {
        data: points.map(p => p[1]),
        fill: true,
        borderWidth: 2,
        pointRadius: 0,
        borderColor: 'rgba(77,159,255,0.8)',
        backgroundColor: ctx => {
            if (!ctx?.chart?.chartArea) return 'rgba(77,159,255,0.05)';
            const g = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.bottom, 0, ctx.chart.chartArea.top);
            g.addColorStop(0, 'rgba(77,159,255,0.01)');
            g.addColorStop(1, 'rgba(77,159,255,0.15)');
            return g;
        },
        cubicInterpolationMode: 'monotone',
        tension: 0.4,
        capBezierPoints: true
    };

    const config = {
        type: 'line',
        data: {
            labels: points.map(p => parseFloat(p[0])),
            datasets: [
                {...baseDataset},
                {
                    ...baseDataset,
                    backgroundColor: 'transparent',
                    borderWidth: 4,
                    fill: false,
                    borderColor: ctx => {
                        if (!ctx?.chart?.ctx) return 'transparent';
                        const prog = (Date.now() % 3000) / 3000;
                        const g = ctx.chart.ctx.createLinearGradient(0, 0, ctx.chart.width, 0);
                        g.addColorStop(Math.max(0, prog - 0.2), 'transparent');
                        g.addColorStop(prog, 'rgba(110,180,255,0.8)');
                        g.addColorStop(Math.min(1, prog + 0.2), 'transparent');
                        return g;
                    },
                }
            ]
        },
        options: {
            ...cfg.chart.options,
            animation: {duration: 300, easing: 'easeOutCubic'},
            elements: {line: {tension: 0.4, capBezierPoints: true, cubicInterpolationMode: 'monotone'}},
            scales: {
                ...cfg.chart.options.scales,
                x: {...cfg.chart.options.scales.x, type: 'linear', beginAtZero: true, max: maxX, grid: {...cfg.chart.options.scales.x.grid, drawTicks: true}},
                y: {...cfg.chart.options.scales.y, min: 0, max: maxValue, beginAtZero: true, ticks: {...cfg.chart.options.scales.y.ticks, callback: v => parseFloat(v).toFixed(2)}}
            }
        },
        plugins: [chartAreaBorder]
    };

    chart = new Chart($('#sensitivity-plot'), config);
    
    const animate = () => {
        if (!document.hidden) chart.update('none');
        chart.animationFrame = requestAnimationFrame(animate);
    };
    
    chart.animationFrame = requestAnimationFrame(animate);
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

const initializeSettings = async () => {
    settings = await invoke('get_default_settings');
    
    // Update the UI with properly formatted values
    Object.entries(settings.values).forEach(([k, v]) => {
        const input = $(`#${k}-value`);
        const info = cfg.settings[k];
        if (k === 'range') {
            input.value = Math.round(v);
        } else {
            const decimalPlaces = info.step.toString().includes('.') ? 
                info.step.toString().split('.')[1].length : 0;
            input.value = v.toFixed(decimalPlaces);
        }
    });
};

const setupEventListeners = () => {
    $('#reset-btn').onclick = async () => {
        const b = $('#reset-btn');
        b.disabled = true;
        
        // Fix the reset button issue by ensuring we properly reset the settings
        settings = await invoke('get_default_settings');
        
        // Update UI with new values
        Object.entries(settings.values).forEach(([k, v]) => {
            const input = $(`#${k}-value`);
            const info = cfg.settings[k];
            if (k === 'range') {
                input.value = Math.round(v);
            } else {
                const decimalPlaces = info.step.toString().includes('.') ? 
                    info.step.toString().split('.')[1].length : 0;
                input.value = v.toFixed(decimalPlaces);
            }
        });
        
        // Update the plot with the new settings
        await updatePlotThrottled(true);
        b.disabled = false;
    };
    
    $('#export-btn').onclick = async () => {
        try {
            const p = await invoke('calculate_curve', {settings});
            await navigator.clipboard.writeText(p.slice(1).map(([x, y]) => `${x},${y.toFixed(4)}`).join(';\n'));
        } catch (e) {
            console.error('Export failed:', e);
        }
    };

    $('#titlebar-minimize').onclick = () => appWindow.minimize();
    $('#titlebar-maximize').onclick = () => appWindow.toggleMaximize();
    $('#titlebar-close').onclick = () => appWindow.close();
};

document.addEventListener('DOMContentLoaded', async () => {
    applyWebView2Optimizations();
    new Tooltip();
    new SettingsManager();
    await initializeSettings();
    setupEventListeners();
    await updatePlotThrottled(true);
});

document.addEventListener('contextmenu', e => e.preventDefault());

if (import.meta.hot) {
    import.meta.hot.accept(async () => {
        if (settings) {
            // Update UI with current settings when hot reloading
            Object.entries(settings.values).forEach(([k, v]) => {
                const input = $(`#${k}-value`);
                const info = cfg.settings[k];
                if (k === 'range') {
                    input.value = Math.round(v);
                } else {
                    const decimalPlaces = info.step.toString().includes('.') ? 
                        info.step.toString().split('.')[1].length : 0;
                    input.value = v.toFixed(decimalPlaces);
                }
            });
            await updatePlotThrottled(true);
        }
    });
}

// Better cleanup
const cleanupChart = () => {
    if (chart?.animationFrame) {
        cancelAnimationFrame(chart.animationFrame);
        chart.animationFrame = null;
    }
    if (chart) {
        chart.destroy();
        chart = null;
    }
};

window.addEventListener('beforeunload', () => {
    if (chart?.animationFrame) cancelAnimationFrame(chart.animationFrame);
});