const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();
const $ = s => document.querySelector(s);
const el = (t, c, a = {}) => Object.assign(document.createElement(t), { className: c, ...a });

let chart = null;
let settings = null;

const cfg = {
    chart: {
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1200, easing: 'easeInOutQuart', delay: ctx => ctx.type === 'data' ? ctx.dataIndex * 3 : 0 },
            transitions: { active: { animation: { duration: 800, easing: 'easeOutCubic', delay: ctx => ctx.dataIndex * 2 } } },
            plugins: { 
                legend: { display: false }, 
                tooltip: false
            },
            scales: {
                x: {
                    grid: { 
                        color: 'rgba(255, 255, 255, 0.03)',
                        drawTicks: false,
                        borderColor: 'transparent',
                        borderWidth: 0,
                        drawOnChartArea: true
                    },
                    border: { 
                        display: false
                    },
                    position: 'bottom',
                    ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 11, family: 'Inter' }, maxRotation: 0, padding: 10, callback: v => parseFloat(v), maxTicksLimit: 10 },
                    title: { display: true, text: 'Input Speed (counts/ms)', color: 'rgba(255, 255, 255, 0.6)', font: { size: 12, family: 'Inter', weight: '500' }, padding: { top: 15 } }
                },
                y: {
                    grid: { 
                        color: 'rgba(255, 255, 255, 0.03)',
                        drawTicks: false,
                        borderColor: 'transparent',
                        borderWidth: 0,
                        drawOnChartArea: true
                    },
                    border: { 
                        display: false
                    },
                    position: 'left',
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

class Tooltip {
    constructor() {
        this.tooltip = document.querySelector('.floating-tooltip');
        this.timeout = null;
        this.currentTarget = null;
        this.setupListeners();
    }

    show(target, x, y) {
        if (!this.tooltip) return;
        
        this.tooltip.textContent = target.dataset.tooltip;
        this.tooltip.classList.add('visible');
        
        // Position the tooltip
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        
        // Default position to the right of the element
        let left = targetRect.right + 10;
        let top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
        
        // Check if tooltip would go off-screen to the right
        if (left + tooltipRect.width > window.innerWidth) {
            // Position to the left instead
            left = targetRect.left - tooltipRect.width - 10;
        }
        
        // Ensure tooltip stays within vertical bounds
        top = Math.max(10, Math.min(window.innerHeight - tooltipRect.height - 10, top));
        
        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
    }

    hide() {
        if (this.tooltip) {
            this.tooltip.classList.remove('visible');
        }
    }

    setupListeners() {
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tooltip]');
            if (!target || getComputedStyle(target).cursor !== 'help') return;

            clearTimeout(this.timeout);
            this.currentTarget = target;
            
            this.timeout = setTimeout(() => {
                const rect = target.getBoundingClientRect();
                this.show(target, rect.left, rect.top);
            }, 400);
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-tooltip]');
            if (!target || getComputedStyle(target).cursor !== 'help') return;

            clearTimeout(this.timeout);
            this.hide();
        });

        // Handle scroll events on any scrollable container
        document.addEventListener('scroll', () => {
            if (this.currentTarget && this.tooltip.classList.contains('visible')) {
                const rect = this.currentTarget.getBoundingClientRect();
                this.show(this.currentTarget, rect.left, rect.top);
            }
        }, true);

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.currentTarget && this.tooltip.classList.contains('visible')) {
                const rect = this.currentTarget.getBoundingClientRect();
                this.show(this.currentTarget, rect.left, rect.top);
            }
        });
    }
}

class SettingsManager {
    constructor() {
        this.populateSettings();
        this.setupControls();
    }

    populateSettings() {
        const template = $('#setting-row-template');
        Object.entries(cfg.settings).forEach(([key, info]) => {
            const row = template.content.cloneNode(true);
            const elements = {
                label: row.querySelector('.setting-label'),
                input: row.querySelector('.setting-value'),
                minus: row.querySelector('.minus'),
                plus: row.querySelector('.plus')
            };

            elements.label.textContent = info.label;
            elements.input.id = `${key}-value`;
            Object.assign(elements.input, {min: info.min, max: info.max, step: info.step});
            elements.minus.dataset.key = elements.plus.dataset.key = key;

            $('#all-settings').appendChild(row);
        });
    }

    setupControls() {
        // Setup input change handlers
        Object.keys(cfg.settings).forEach(key => {
            const input = $(`#${key}-value`);
            input.onchange = e => this.updateValue(key, parseFloat(e.target.value));
        });

        // Setup plus/minus button handlers
        document.querySelectorAll('.value-adjust').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key;
                const info = cfg.settings[key];
                const input = $(`#${key}-value`);
                const currentValue = parseFloat(input.value);
                const step = parseFloat(info.step);
                const delta = btn.classList.contains('plus') ? step : -step;
                
                const newValue = Math.min(
                    Math.max(
                        currentValue + delta,
                        info.min
                    ),
                    info.max
                );
                
                input.value = newValue;
                this.updateValue(key, newValue);
            };
        });
    }

    updateValue(key, value) {
        const input = $(`#${key}-value`);
        const info = cfg.settings[key];
        
        // Ensure value is within bounds
        value = Math.min(Math.max(value, info.min), info.max);
        
        // Update input value
        input.value = value;
        
        // Update settings and plot
        if (settings) {
            settings.values[key] = value;
            updatePlot(true);
        }
    }
}

const chartAreaBorder = {
    id: 'chartAreaBorder',
    beforeDraw(chart, args, options) {
        const {ctx, chartArea: {left, top, width, height}} = chart;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);
        const path = new Path2D();
        path.rect(left, top, width, height);
        const perimeter = 2 * (width + height);
        const gradientLength = perimeter * 0.2;
        const time = Date.now() % 12000;
        const progress1 = (time / 12000);
        const progress2 = ((time + 6000) % 12000) / 12000;
        
        const getPos = (progress) => {
            const position = progress * perimeter;
            const d = position % perimeter;
            
            return d < width ? [left + d, top] :
                d < width + height ? [left + width, top + (d - width)] :
                d < 2 * width + height ? [left + width - (d - (width + height)), top + height] :
                [left, top + height - (d - (2 * width + height))];
        };
        
        const [x1, y1] = getPos(progress1);
        const [x2, y2] = getPos((progress1 + gradientLength/perimeter) % 1);
        
        const gradient1 = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient1.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
        gradient1.addColorStop(0.5, 'rgba(110, 180, 255, 0.3)');
        gradient1.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
        ctx.strokeStyle = gradient1;
        ctx.stroke(path);
        const [x3, y3] = getPos(progress2);
        const [x4, y4] = getPos((progress2 + gradientLength/perimeter) % 1);
        const gradient2 = ctx.createLinearGradient(x3, y3, x4, y4);
        gradient2.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
        gradient2.addColorStop(0.5, 'rgba(110, 180, 255, 0.3)');
        gradient2.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
        ctx.strokeStyle = gradient2;
        ctx.stroke(path);
        ctx.restore();
    }
};

const createChart = async (points, maxValue) => {
    const maxX = Math.max(...points.map(p => p[0]));
    // Keep both points at transition by not modifying the data
    const processedPoints = points.map(p => p[1]);

    const baseDataset = {
        data: processedPoints,
        borderColor: '#4d9fff',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        fill: true,
        backgroundColor: ctx => {
            if (!ctx?.chart?.chartArea) return 'rgba(77, 159, 255, 0.05)';
            const gradient = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.bottom, 0, ctx.chart.chartArea.top);
            gradient.addColorStop(0, 'rgba(77, 159, 255, 0.01)');
            gradient.addColorStop(1, 'rgba(77, 159, 255, 0.15)');
            return gradient;
        },
    };

    const config = {
        type: 'line',
        data: {
            labels: points.map(p => parseFloat(p[0])),
            datasets: [
                {
                    ...baseDataset,
                    backgroundColor: ctx => {
                        if (!ctx?.chart?.chartArea) return 'rgba(77, 159, 255, 0.05)';
                        const gradient = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.bottom, 0, ctx.chart.chartArea.top);
                        gradient.addColorStop(0, 'rgba(77, 159, 255, 0.01)');
                        gradient.addColorStop(1, 'rgba(77, 159, 255, 0.15)');
                        return gradient;
                    },
                },
                {
                    ...baseDataset,
                    backgroundColor: 'transparent',
                    borderWidth: 4,
                    fill: false,
                    borderColor: ctx => {
                        if (!ctx?.chart?.ctx) return 'transparent';
                        const progress = (Date.now() % 3000) / 3000;
                        const gradient = ctx.chart.ctx.createLinearGradient(0, 0, ctx.chart.width, 0);
                        gradient.addColorStop(Math.max(0, progress - 0.2), 'transparent');
                        gradient.addColorStop(progress, 'rgba(110, 180, 255, 0.8)');
                        gradient.addColorStop(Math.min(1, progress + 0.2), 'transparent');
                        return gradient;
                    },
                }
            ]
        },
        options: {
            ...cfg.chart.options,
            animation: {
                duration: 300,
                easing: 'easeOutCubic'
            },
            elements: {
                line: {
                    tension: 0.4,
                    capBezierPoints: true
                }
            },
            scales: {
                ...cfg.chart.options.scales,
                x: {
                    ...cfg.chart.options.scales.x,
                    type: 'linear',
                    beginAtZero: true,
                    max: maxX,
                    grid: {
                        ...cfg.chart.options.scales.x.grid,
                        drawTicks: true
                    }
                },
                y: {
                    ...cfg.chart.options.scales.y,
                    min: 0,
                    max: maxValue,
                    beginAtZero: true,
                    ticks: {
                        ...cfg.chart.options.scales.y.ticks,
                        callback: v => parseFloat(v).toFixed(2)
                    }
                }
            }
        },
        plugins: [chartAreaBorder]
    };

    chart = new Chart($('#sensitivity-plot'), config);
    const animate = () => {
        chart.update('none');
        chart.animationFrame = requestAnimationFrame(animate);
    };
    chart.animationFrame = requestAnimationFrame(animate);
};

const updatePlot = async (animate = true) => {
    if (!settings || !$('#sensitivity-plot')) return;
    
    const points = await invoke('calculate_curve', {settings});
    const maxValue = Math.max(...points.map(p => p[1])) + 0.1;
    const maxX = Math.max(...points.map(p => p[0]));

    if (chart) {
        // Keep both points at transition by not modifying the data
        const processedPoints = points.map(p => p[1]);

        chart.data.datasets[0].data = processedPoints;
        chart.data.datasets[1].data = processedPoints;
        chart.data.labels = points.map(p => parseFloat(p[0]));
        chart.options.scales.y.max = maxValue;
        chart.options.scales.x.max = maxX;
        
        chart.update({
            duration: animate ? 300 : 0,
            easing: 'easeOutCubic',
            lazy: true
        });
    } else {
        await createChart(points, maxValue);
    }
};

const initializeSettings = async () => {
    settings = await invoke('get_default_settings');
    Object.entries(settings.values).forEach(([key, value]) => 
        $(`#${key}-value`).value = key === 'range' ? Math.round(value) : value
    );
};

const setupEventListeners = () => {
    $('#reset-btn').onclick = async () => {
        const btn = $('#reset-btn');
        btn.disabled = true;
        
        await updatePlot(false);
        await initializeSettings();
        await updatePlot(true);
        
        btn.disabled = false;
    };
    
    $('#export-btn').onclick = async () => {
        try {
            const points = await invoke('calculate_curve', {settings});
            await navigator.clipboard.writeText(
                points.slice(1)
                    .map(([x, y]) => `${x},${y.toFixed(4)}`)
                    .join(';\n')
            );
        } catch (e) {
            console.error('Export failed:', e);
        }
    };

    $('#titlebar-minimize').onclick = () => appWindow.minimize();
    $('#titlebar-maximize').onclick = () => appWindow.toggleMaximize();
    $('#titlebar-close').onclick = () => appWindow.close();
};

document.addEventListener('DOMContentLoaded', async () => {
    new Tooltip();
    new SettingsManager();
    await initializeSettings();
    setupEventListeners();
    await updatePlot(true);
});

document.addEventListener('contextmenu', e => e.preventDefault());

if (import.meta.hot) {
    import.meta.hot.accept(async () => {
        if (settings) {
            Object.entries(settings.values).forEach(([key, value]) => 
                $(`#${key}-value`).value = key === 'range' ? Math.round(value) : value
            );
            await updatePlot();
        }
    });
}

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
    if (chart?.animationFrame) {
        cancelAnimationFrame(chart.animationFrame);
    }
});
