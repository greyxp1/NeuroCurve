const { invoke } = window.__TAURI__.core, { appWindow } = window.__TAURI__.window;
let settings = null, chart = null;

const cfg = {
    chart: {
        type: 'line',
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 300, easing: 'easeOutQuart' },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { grid: { color: '#222' }, border: { color: '#444' }, ticks: { color: '#888', maxRotation: 0, callback: v => Math.round(v) },
                    title: { display: true, text: 'Input Speed (counts/ms)', color: '#888', font: { size: 12 } } },
                y: { grid: { color: '#222' }, border: { color: '#444' }, ticks: { color: '#888' },
                    title: { display: true, text: 'Output Speed (counts/ms)', color: '#888', font: { size: 12 } } }
            },
            interaction: { intersect: false, mode: 'index' }
        }
    },
    settings: {
        min_vel: { label: 'Min', tooltip: 'Minimum velocity multiplier', min: .1, max: 2, step: .1 },
        max_vel: { label: 'Max', tooltip: 'Maximum velocity multiplier', min: 1, max: 10, step: .1 },
        range: { label: 'Range', tooltip: 'Speed range (in counts/ms) over which sensitivity increases', min: 0, max: 200, step: 1 },
        growth_base: { label: 'Growth', tooltip: 'How quickly sensitivity increases within the range', min: 1.001, max: 1.5, step: .001 }
    }
};

const $ = s => document.querySelector(s), el = (t, c, a = {}) => Object.assign(document.createElement(t), { className: c, ...a });

const updatePlot = async () => {
    const points = await invoke('calculate_curve', { settings }),
        data = { labels: points.map(p => p[0].toFixed(1)),
            datasets: [{ data: points.map(p => p[1]), borderColor: '#4d9fff', borderWidth: 3.5, pointRadius: 0, tension: .3, fill: false }] };
    chart ? (Object.assign(chart.data, data), chart.update({ duration: 300, easing: 'easeOutQuart' }))
          : chart = new Chart($('#sensitivity-plot'), { ...cfg.chart, data });
};

const createUI = () => {
    $('.container').innerHTML = `<div class="settings-panel"><div class="panel-header"><h2>Settings</h2></div>
        <div class="settings-container"><div id="all-settings"></div></div>
        <div class="action-buttons"><button id="reset-btn">Reset</button><button id="export-btn">Export LUT</button></div></div>
        <div class="plot-panel"><div class="window-controls">${['minimize','maximize','close'].map(a => 
        `<button class="titlebar-button" id="titlebar-${a}"></button>`).join('')}</div>
        <div class="panel-header"><h2>Sensitivity Curve</h2></div>
        <div id="sensitivity-plot-container"><canvas id="sensitivity-plot"></canvas></div></div>`;
    ['minimize','maximize','close'].forEach(a => $(`#titlebar-${a}`).onclick = () => 
        a === 'maximize' ? appWindow.toggleMaximize() : appWindow[a]());
};

const setupTooltips = () => {
    const tip = el('div', 'floating-tooltip'); document.body.appendChild(tip); let timeout;
    const show = t => {
        const { left: tL, top: tT, width: tW, bottom: tB } = t.getBoundingClientRect(),
            { width: w, height: h } = tip.getBoundingClientRect();
        Object.assign(tip.style, {
            left: `${Math.max(8, Math.min(tL + (tW/2) - (w/2), innerWidth - w - 8))}px`,
            top: `${tT - h - 8 < 8 ? tB + 8 : tT - h - 8}px`
        });
        tip.classList.add('visible');
    };
    const hideTooltip = () => (clearTimeout(timeout), tip.classList.remove('visible'));
    document.addEventListener('mouseover', e => e.target.dataset.tooltip && (clearTimeout(timeout),
        timeout = setTimeout(() => (tip.textContent = e.target.dataset.tooltip, show(e.target)), 400)));
    document.addEventListener('mouseout', e => e.target.dataset.tooltip && hideTooltip());
    document.addEventListener('scroll', hideTooltip, true);
};

const createSettings = () => {
    const updateValue = (k, v) => {
        const val = k === 'range' ? Math.round(v) : parseFloat(v);
        $(`#${k}-slider`).value = $(`#${k}-value`).value = val;
        settings.values[k] = val;
        updatePlot();
    };
    $('#all-settings').innerHTML = Object.entries(cfg.settings).map(([k, i]) => 
        `<div class="setting-row"><div class="setting-label" data-tooltip="${i.tooltip}">${i.label}</div>
        <input type="range" class="setting-slider" id="${k}-slider" min="${i.min}" max="${i.max}" step="${i.step}">
        <input type="number" class="setting-value" id="${k}-value" min="${i.min}" max="${i.max}" step="${i.step}"></div>`).join('');
    Object.keys(cfg.settings).forEach(k => {
        const slider = $(`#${k}-slider`), value = $(`#${k}-value`);
        slider.oninput = e => updateValue(k, e.target.value);
        value.onchange = e => updateValue(k, e.target.value);
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    createUI(); setupTooltips(); createSettings();
    settings = await invoke('get_default_settings');
    Object.entries(settings.values).forEach(([k, v]) => 
        $(`#${k}-slider`).value = $(`#${k}-value`).value = k === 'range' ? Math.round(v) : v);
    updatePlot();
    $('#reset-btn').onclick = () => (settings = null, initializeSettings());
    $('#export-btn').onclick = async () => {
        try { await navigator.clipboard.writeText((await invoke('calculate_curve', { settings }))
            .slice(1).map(([x, y]) => `${x},${y.toFixed(4)}`).join(';\n')); 
        } catch (e) { console.error(e); }
    };
});

addEventListener('beforeunload', () => chart?.destroy());
