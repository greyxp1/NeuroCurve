const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();
const $ = s => document.querySelector(s);
const el = (t, c, a = {}) => Object.assign(document.createElement(t), { className: c, ...a });

let settings = null, chart = null;

const cfg = {
    chart: {
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1200, easing: 'easeInOutQuart', delay: ctx => ctx.type === 'data' ? ctx.dataIndex * 3 : 0 },
            transitions: { active: { animation: { duration: 800, easing: 'easeOutCubic', delay: ctx => ctx.dataIndex * 2 } } },
            plugins: { legend: { display: false }, tooltip: false },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)', drawTicks: false, drawBorder: false },
                    border: { display: false },
                    ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 11, family: 'Inter' }, maxRotation: 0, padding: 10, callback: v => parseFloat(v), maxTicksLimit: 10 },
                    title: { display: true, text: 'Input Speed (counts/ms)', color: 'rgba(255, 255, 255, 0.6)', font: { size: 12, family: 'Inter', weight: '500' }, padding: { top: 15 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)', drawTicks: false, drawBorder: false },
                    border: { display: false },
                    ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 11, family: 'Inter' }, padding: 10, callback: v => parseFloat(v).toFixed(2) },
                    title: { display: true, text: 'Sensitivity Multiplier', color: 'rgba(255, 255, 255, 0.6)', font: { size: 12, family: 'Inter', weight: '500' }, padding: { bottom: 15 } },
                    beginAtZero: true
                }
            }
        }
    },
    settings: {
        min_sens: { label: 'Base Sensitivity', tooltip: 'Your base sensitivity multiplier when moving slowly or below the threshold speed', min: 0.1, max: 2, step: 0.001 },
        max_sens: { label: 'Maximum Sensitivity', tooltip: 'The highest sensitivity multiplier when moving at or above maximum speed', min: 0.1, max: 5, step: 0.001 },
        offset: { label: 'Speed Threshold', tooltip: 'Mouse movement speed (counts/ms) at which acceleration begins', min: 0, max: 50, step: 1 },
        range: { label: 'Acceleration Range', tooltip: 'The speed range (counts/ms) over which sensitivity scales from base to maximum', min: 10, max: 200, step: 1 },
        growth_base: { label: 'Acceleration Rate', tooltip: 'How aggressively sensitivity increases within the acceleration range (higher = more aggressive)', min: 1, max: 1.5, step: 0.001 }
    }
};

class TooltipManager {
    constructor() {
        this.tip = el('div', 'floating-tooltip');
        document.body.appendChild(this.tip);
        this.setupListeners();
    }

    show(target) {
        const { left, top, width, bottom } = target.getBoundingClientRect();
        const { width: w, height: h } = this.tip.getBoundingClientRect();
        Object.assign(this.tip.style, {
            left: `${Math.max(8, Math.min(left + (width/2) - (w/2), innerWidth - w - 8))}px`,
            top: `${top - h - 8 < 8 ? bottom + 8 : top - h - 8}px`
        });
        this.tip.classList.add('visible');
    }

    setupListeners() {
        document.addEventListener('mouseover', e => {
            if (e.target.dataset.tooltip) {
                clearTimeout(this.timeout);
                this.timeout = setTimeout(() => {
                    this.tip.textContent = e.target.dataset.tooltip;
                    this.show(e.target);
                }, 400);
            }
        });
        document.addEventListener('mouseout', e => e.target.dataset.tooltip && (this.tip.classList.remove('visible')));
        document.addEventListener('scroll', () => this.tip.classList.remove('visible'), true);
    }
}

class SettingsManager {
    constructor() {
        $('#all-settings').innerHTML = Object.entries(cfg.settings)
            .map(([key, info]) => `
                <div class="setting-row">
                    <div class="setting-label" data-tooltip="${info.tooltip}">${info.label}</div>
                    <div class="value-control">
                        <button class="value-adjust minus" onclick="this.blur()" data-key="${key}">-</button>
                        <input type="number" class="setting-value" id="${key}-value" min="${info.min}" max="${info.max}" step="${info.step}">
                        <button class="value-adjust plus" onclick="this.blur()" data-key="${key}">+</button>
                    </div>
                </div>`).join('');
        this.setupControls();
    }

    updateValue(key, value) {
        const info = cfg.settings[key];
        const val = key === 'range' ? Math.round(value) : Number(parseFloat(value).toFixed(info.step.toString().split('.')[1]?.length || 0));
        $(`#${key}-value`).value = val;
        settings.values[key] = val;
        updatePlot();
    }

    setupControls() {
        Object.keys(cfg.settings).forEach(key => $(`#${key}-value`).onchange = e => this.updateValue(key, e.target.value));
        document.querySelectorAll('.value-adjust').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key;
                const info = cfg.settings[key];
                const input = $(`#${key}-value`);
                const delta = btn.classList.contains('plus') ? 1 : -1;
                this.updateValue(key, Math.min(Math.max(parseFloat(input.value) + delta * parseFloat(info.step), info.min), info.max));
            };
        });
    }
}

const updatePlot = async () => {
    if (!settings || !$('#sensitivity-plot')) return;
    
    const points = await invoke('calculate_curve', { settings });
    const dataset = {
        data: points.map(p => p[1]),
        borderColor: '#4d9fff',
        backgroundColor: context => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return 'rgba(77, 159, 255, 0.05)';
            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            gradient.addColorStop(0, 'rgba(77, 159, 255, 0.01)');
            gradient.addColorStop(1, 'rgba(77, 159, 255, 0.15)');
            return gradient;
        },
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.4,
        fill: true,
        hoverBorderWidth: 3,
        hoverBorderColor: '#6eb4ff'
    };

    const chartConfig = {
        type: 'line',
        data: { labels: points.map(p => parseFloat(p[0])), datasets: [dataset] },
        options: { ...cfg.chart.options, hover: { mode: 'nearest', intersect: false, animationDuration: 150 } }
    };

    if (chart) {
        chart.data = chartConfig.data;
        chart.update('none');
    } else {
        chart = new Chart($('#sensitivity-plot'), chartConfig);
    }
};

const initializeSettings = async () => {
    settings = await invoke('get_default_settings');
    Object.entries(settings.values).forEach(([key, value]) => $(`#${key}-value`).value = key === 'range' ? Math.round(value) : value);
    if (chart) { chart.destroy(); chart = null; }
    await updatePlot();
};

const createUI = () => {
    $('.container').innerHTML = `
        <div class="settings-panel">
            <div class="panel-header"><h2>Settings</h2></div>
            <div class="settings-container"><div id="all-settings"></div></div>
            <div class="action-buttons">
                <button id="reset-btn">Reset</button>
                <button id="export-btn">Export</button>
            </div>
        </div>
        <div class="plot-panel">
            <div class="window-controls">
                ${['minimize', 'maximize', 'close'].map(a => `<button class="titlebar-button" id="titlebar-${a}"></button>`).join('')}
            </div>
            <div class="panel-header"><h2>Sensitivity Curve</h2></div>
            <div id="sensitivity-plot-container"><canvas id="sensitivity-plot"></canvas></div>
        </div>`;
};

const setupEventListeners = () => {
    $('#reset-btn').onclick = async () => {
        const btn = $('#reset-btn');
        btn.disabled = true;
        await initializeSettings();
        btn.disabled = false;
    };
    
    $('#export-btn').onclick = async () => {
        try {
            const points = await invoke('calculate_curve', { settings });
            const lutText = points.slice(1)
                .map(([x, y]) => `${x},${y.toFixed(4)}`)
                .join(';\n');
            await navigator.clipboard.writeText(lutText);
        } catch (e) {
            console.error('Export failed:', e);
        }
    };
};

document.addEventListener('DOMContentLoaded', async () => {
    createUI();
    new TooltipManager();
    new SettingsManager();
    await initializeSettings();
    setupEventListeners();
});

// Hot Module Replacement Support
if (import.meta.hot) {
    import.meta.hot.accept(() => {
        if (!$('.container')) {
            createUI();
            new TooltipManager();
            new SettingsManager();
            if (settings) {
                Object.entries(settings.values).forEach(([key, value]) => {
                    const input = $(`#${key}-value`);
                    if (input) input.value = key === 'range' ? Math.round(value) : value;
                });
                updatePlot();
            }
        }
    });
}

// UI Recovery
setInterval(() => {
    if (!$('.container') || !$('#sensitivity-plot')) {
        createUI();
        new TooltipManager();
        new SettingsManager();
        if (settings) {
            Object.entries(settings.values).forEach(([key, value]) => {
                const input = $(`#${key}-value`);
                if (input) input.value = key === 'range' ? Math.round(value) : value;
            });
            updatePlot();
        }
    }
}, 1000);

document.addEventListener('contextmenu', e => e.preventDefault());
