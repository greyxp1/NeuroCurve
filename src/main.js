const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

let settings = null;
let chart = null;

const $ = s => document.querySelector(s);
const el = (t, c, a = {}) => Object.assign(document.createElement(t), { className: c, ...a });

const cfg = {
    chart: {
        type: 'line',
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 400,
                easing: 'easeOutQuad'
            },
            plugins: {
                legend: { display: false },
                tooltip: false
            },
            hover: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)',
                        drawTicks: false,
                        drawBorder: false
                    },
                    border: { display: false },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        font: { size: 11, family: 'Inter' },
                        maxRotation: 0,
                        padding: 10,
                        callback: v => parseFloat(v),
                        maxTicksLimit: 10
                    },
                    title: {
                        display: true,
                        text: 'Input Speed (counts/ms)',
                        color: 'rgba(255, 255, 255, 0.6)',
                        font: { size: 12, family: 'Inter', weight: '500' },
                        padding: { top: 15 }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)',
                        drawTicks: false,
                        drawBorder: false
                    },
                    border: { display: false },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        font: { size: 11, family: 'Inter' },
                        padding: 10,
                        callback: v => parseFloat(v).toFixed(2)
                    },
                    title: {
                        display: true,
                        text: 'Sensitivity Multiplier',
                        color: 'rgba(255, 255, 255, 0.6)',
                        font: { size: 12, family: 'Inter', weight: '500' },
                        padding: { bottom: 15 }
                    },
                    beginAtZero: true
                }
            }
        }
    },
    settings: {
        min_sens: { 
            label: 'Min', 
            tooltip: 'Minimum sensitivity multiplier', 
            min: 0.1, 
            max: 2, 
            step: .05 
        },
        max_sens: { 
            label: 'Max', 
            tooltip: 'Maximum sensitivity multiplier (plateau)', 
            min: 0.1, 
            max: 5, 
            step: .05 
        },
        offset: { 
            label: 'Offset', 
            tooltip: 'Speed threshold (in counts/ms) before acceleration begins', 
            min: 0, 
            max: 50, 
            step: 1 
        },
        range: { 
            label: 'Range', 
            tooltip: 'Speed range (in counts/ms) over which sensitivity increases after offset', 
            min: 10, 
            max: 200, 
            step: 1 
        },
        growth_base: { 
            label: 'Growth', 
            tooltip: 'How quickly sensitivity increases within the range', 
            min: 1, 
            max: 1.5, 
            step: .01 
        }
    }
};

const createUI = () => {
    $('.container').innerHTML = `
        <div class="settings-panel">
            <div class="panel-header"><h2>Settings</h2></div>
            <div class="settings-container"><div id="all-settings"></div></div>
            <div class="action-buttons">
                <button id="reset-btn">Reset</button>
                <button id="export-btn">Export LUT</button>
            </div>
        </div>
        <div class="plot-panel">
            <div class="window-controls">
                ${['minimize', 'maximize', 'close'].map(a => `<button class="titlebar-button" id="titlebar-${a}"></button>`).join('')}
            </div>
            <div class="panel-header"><h2>Sensitivity Curve</h2></div>
            <div id="sensitivity-plot-container">
                <canvas id="sensitivity-plot"></canvas>
            </div>
        </div>`;
    ['minimize', 'maximize', 'close'].forEach(a => $(`#titlebar-${a}`).onclick = () => a === 'maximize' ? appWindow.toggleMaximize() : appWindow[a]());
};

const setupTooltips = () => {
    const tip = el('div', 'floating-tooltip');
    document.body.appendChild(tip);
    let timeout;
    const show = target => {
        const { left, top, width, bottom } = target.getBoundingClientRect();
        const { width: w, height: h } = tip.getBoundingClientRect();
        Object.assign(tip.style, {
            left: `${Math.max(8, Math.min(left + (width/2) - (w/2), innerWidth - w - 8))}px`,
            top: `${top - h - 8 < 8 ? bottom + 8 : top - h - 8}px`
        });
        tip.classList.add('visible');
    };
    const hide = () => { clearTimeout(timeout); tip.classList.remove('visible'); };
    document.addEventListener('mouseover', e => {
        if (e.target.dataset.tooltip) {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                tip.textContent = e.target.dataset.tooltip;
                show(e.target);
            }, 400);
        }
    });
    document.addEventListener('mouseout', e => e.target.dataset.tooltip && hide());
    document.addEventListener('scroll', hide, true);
};

const createSettings = () => {
    const updateValue = (key, value) => {
        const val = key === 'range' ? Math.round(value) : parseFloat(value);
        $(`#${key}-slider`).value = $(`#${key}-value`).value = val;
        settings.values[key] = val;
        updatePlot();
    };
    $('#all-settings').innerHTML = Object.entries(cfg.settings)
        .map(([key, info]) => `
            <div class="setting-row">
                <div class="setting-label" data-tooltip="${info.tooltip}">${info.label}</div>
                <input type="range" class="setting-slider" id="${key}-slider" min="${info.min}" max="${info.max}" step="${info.step}">
                <input type="number" class="setting-value" id="${key}-value" min="${info.min}" max="${info.max}" step="${info.step}">
            </div>`).join('');
    Object.keys(cfg.settings).forEach(key => {
        const slider = $(`#${key}-slider`);
        const value = $(`#${key}-value`);
        slider.oninput = e => updateValue(key, e.target.value);
        value.onchange = e => updateValue(key, e.target.value);
    });
};

const updatePlot = async () => {
    if (!settings || !$('#sensitivity-plot')) return;
    const points = await invoke('calculate_curve', { settings });
    
    const dataset = {
        data: points.map(p => p[1]),
        borderColor: '#4d9fff',
        backgroundColor: 'rgba(77, 159, 255, 0.05)',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.35,
        fill: true
    };

    if (!chart) {
        const ctx = $('#sensitivity-plot');
        chart = new Chart(ctx, {
            ...cfg.chart,
            data: {
                labels: points.map(p => parseFloat(p[0])),
                datasets: [dataset]
            }
        });

        let isHovering = false;
        
        ctx.addEventListener('mousemove', () => {
            if (!isHovering) {
                isHovering = true;
                chart.options.plugins.tooltip = true;
                chart.data.datasets[0].pointHoverRadius = 5;
                chart.data.datasets[0].pointHoverBackgroundColor = '#ffffff';
                chart.data.datasets[0].pointHoverBorderColor = '#4d9fff';
                chart.data.datasets[0].pointHoverBorderWidth = 2;
                requestAnimationFrame(() => chart.update());
            }
        });

        ctx.addEventListener('mouseleave', () => {
            if (isHovering) {
                isHovering = false;
                chart.options.plugins.tooltip = false;
                chart.data.datasets[0].pointHoverRadius = 0;
                requestAnimationFrame(() => chart.update());
            }
        });

        return;
    }

    // Smoothly update existing chart
    chart.data.labels = points.map(p => parseFloat(p[0]));
    chart.data.datasets[0].data = points.map(p => p[1]);
    chart.update('active');
};

const initializeSettings = async () => {
    settings = await invoke('get_default_settings');
    Object.entries(settings.values).forEach(([key, value]) => {
        $(`#${key}-slider`).value = $(`#${key}-value`).value = key === 'range' ? Math.round(value) : value;
    });
    updatePlot();
};

const ensureUI = () => {
    if (!$('.container')) {
        createUI();
        setupTooltips();
        createSettings();
        if (settings) {
            Object.entries(settings.values).forEach(([key, value]) => {
                const slider = $(`#${key}-slider`);
                const value_input = $(`#${key}-value`);
                if (slider && value_input) slider.value = value_input.value = key === 'range' ? Math.round(value) : value;
            });
            updatePlot();
        }
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    createUI();
    setupTooltips();
    createSettings();
    await initializeSettings();
    $('#reset-btn').onclick = initializeSettings;
    $('#export-btn').onclick = async () => {
        try {
            const points = await invoke('calculate_curve', { settings });
            const lutText = points.slice(1).map(([x, y]) => `${x},${y.toFixed(4)}`).join(';\n');
            await navigator.clipboard.writeText(lutText);
        } catch (e) { console.error('Export failed:', e); }
    };
});

if (import.meta.hot) import.meta.hot.accept(() => ensureUI());

const checkUIInterval = setInterval(() => {
    if (!$('.container') || !$('#sensitivity-plot')) ensureUI();
}, 1000);

addEventListener('beforeunload', () => {
    if (chart) chart.destroy();
    clearInterval(checkUIInterval);
});
