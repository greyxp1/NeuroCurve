let debugDragRegions = false;

function toggleDragRegionsDebug() {
  debugDragRegions = !debugDragRegions;
  document.body.classList.toggle('debug-drag-regions', debugDragRegions);
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    toggleDragRegionsDebug();
  }
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  return false;
}, { capture: true });

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

document
  .getElementById('titlebar-minimize')
  ?.addEventListener('click', () => appWindow.minimize());
document
  .getElementById('titlebar-maximize')
  ?.addEventListener('click', () => appWindow.toggleMaximize());
document
  .getElementById('titlebar-close')
  ?.addEventListener('click', () => appWindow.close());

document
  .getElementById('reset-btn')
  ?.addEventListener('click', async () => {
    console.log('Reset button clicked');
    settings = await invoke('get_default_settings');
    updateUIFromSettings();
    updatePlot();
  });

document
  .getElementById('export-btn')
  ?.addEventListener('click', async () => {
    const points = await invoke('calculate_curve', { settings });

    const lut = points
      .slice(1)
      .map(([x, y]) => `${x},${y.toFixed(4)}`)
      .join(';\n');

    try {
      await navigator.clipboard.writeText(lut);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  });

let settings = null;
let currentTab = 'micro';
let isAnimating = false;

async function initializeSettings() {
  settings = await invoke('get_default_settings');
  
  createTabSettings('micro');
  createTabSettings('tracking');
  createTabSettings('flicking');
  
  updateUIFromSettings();
  updatePlot();
  
  const dpiSlider = document.getElementById('dpi');
  const dpiInput = document.getElementById('dpi-value');
  
  dpiSlider.addEventListener('input', (e) => {
    dpiInput.value = e.target.value;
    settings.common.dpi = parseFloat(e.target.value);
    updatePlot();
  });

  dpiInput.addEventListener('change', (e) => {
    dpiSlider.value = e.target.value;
    settings.common.dpi = parseFloat(e.target.value);
    updatePlot();
  });

  const minSensSlider = document.getElementById('min-sens');
  const minSensInput = document.getElementById('min-sens-value');
  
  minSensSlider.addEventListener('input', (e) => {
    minSensInput.value = e.target.value;
    settings.common.min_sens = parseFloat(e.target.value);
    updatePlot();
  });

  minSensInput.addEventListener('change', (e) => {
    minSensSlider.value = e.target.value;
    settings.common.min_sens = parseFloat(e.target.value);
    updatePlot();
  });
}

function updateUIFromSettings() {
  document.getElementById('dpi').value = settings.common.dpi;
  document.getElementById('dpi-value').value = settings.common.dpi;
  document.getElementById('min-sens').value = settings.common.min_sens;
  document.getElementById('min-sens-value').value = settings.common.min_sens;

  updateTabSettings('micro');
  updateTabSettings('tracking');
  updateTabSettings('flicking');
}

function createTabSettings(tab) {
  const container = document.getElementById(`${tab}-settings`);
  const settingOrder = ['range', 'growth_base', 'max_sens'];
  const settingInfo = {
    'range': {
      label: 'Range',
      tooltip: 'Speed threshold before increasing sensitivity\nHigher values mean the effect kicks in at faster movements',
      step: 1,
      min: 0,
      max: 100
    },
    'growth_base': {
      label: 'Rate',
      tooltip: 'How quickly sensitivity increases\nHigher values mean more aggressive acceleration',
      step: 0.01,
      min: 1.01,
      max: 1.5
    },
    'max_sens': {
      label: 'Max',
      tooltip: 'Maximum sensitivity multiplier\nLimits how high the sensitivity can go',
      step: 0.001,
      min: 0,
      max: 10
    }
  };

  for (const key of settingOrder) {
    const info = settingInfo[key];
    const row = document.createElement('div');
    row.className = 'setting-row';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'setting-label';
    labelDiv.setAttribute('data-tooltip', info.tooltip);
    labelDiv.textContent = info.label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `${tab}-${key}-slider`;
    slider.className = 'setting-slider';
    slider.min = info.min;
    slider.max = info.max;
    slider.step = info.step;
    slider.value = settings[tab][key];

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.id = `${tab}-${key}-input`;
    numberInput.className = 'setting-value';
    numberInput.min = info.min;
    numberInput.max = info.max;
    numberInput.step = info.step;
    numberInput.value = settings[tab][key];

    row.appendChild(labelDiv);
    row.appendChild(slider);
    row.appendChild(numberInput);
    container.appendChild(row);

    slider.addEventListener('input', (e) => {
      const newValue = key === 'range' ? Math.round(parseFloat(e.target.value)) : parseFloat(e.target.value);
      numberInput.value = newValue;
      settings[tab][key] = newValue;
      updatePlot();
    });

    numberInput.addEventListener('change', (e) => {
      const newValue = key === 'range' ? Math.round(parseFloat(e.target.value)) : parseFloat(e.target.value);
      slider.value = newValue;
      settings[tab][key] = newValue;
      updatePlot();
    });
  }
}

function updateTabSettings(tab) {
  const tabSettings = settings[tab];
  const settingOrder = ['range', 'growth_base', 'max_sens'];
  
  for (const key of settingOrder) {
    const value = tabSettings[key];
    if (value === undefined) continue;

    const slider = document.getElementById(`${tab}-${key}-slider`);
    const input = document.getElementById(`${tab}-${key}-input`);
    
    if (slider && input) {
      // Directly set values without animation
      slider.value = key === 'range' ? Math.round(value) : value;
      input.value = key === 'range' ? Math.round(value) : value;
    }
  }
}

// Remove the animateValue function since it's no longer needed

async function updatePlot() {
  const points = await invoke('calculate_curve', { settings });
  
  const microEnd = Math.min(Math.round(settings.micro.range), points.length);
  const trackingEnd = Math.min(Math.round(microEnd + settings.tracking.range), points.length);
  
  const totalThreshold = Math.round(settings.micro.range + settings.tracking.range + settings.flicking.range);
  const baseDisplayX = totalThreshold * points[1][0];
  const displayX = Math.ceil(baseDisplayX * 1.2);

  const microPoints = points.slice(0, microEnd + 1);
  const trackingPoints = points.slice(microEnd, trackingEnd + 1);
  const flickingPoints = points.slice(trackingEnd);

  const traces = [];
  
  if (microPoints.length > 0) {
    traces.push({
      x: microPoints.map(p => p[0]),
      y: microPoints.map(p => p[1]),
      type: 'scatter',
      mode: 'lines',
      name: 'Micro',
      line: { color: '#3d8bff', width: 3.5 },
      hoverinfo: 'none'
    });
  }

  if (trackingPoints.length > 0) {
    traces.push({
      x: trackingPoints.map(p => p[0]),
      y: trackingPoints.map(p => p[1]),
      type: 'scatter',
      mode: 'lines',
      name: 'Tracking',
      line: { color: '#ff9900', width: 3.5 },
      hoverinfo: 'none'
    });
  }

  if (flickingPoints.length > 0) {
    traces.push({
      x: flickingPoints.map(p => p[0]),
      y: flickingPoints.map(p => p[1]),
      type: 'scatter',
      mode: 'lines',
      name: 'Flicking',
      line: { color: '#33cc33', width: 3.5 },
      hoverinfo: 'none'
    });
  }

  const visiblePoints = points.filter(p => p[0] <= displayX);
  const maxY = visiblePoints.length > 0 ? Math.max(...visiblePoints.map(p => p[1])) : 1;

  const layout = {
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)',
    autosize: true,
    useResizeHandler: true,
    responsive: true,
    margin: { l: 50, r: 30, b: 50, t: 10, pad: 0 },
    xaxis: {
      title: 'Input Speed (counts/ms)',
      range: [0, displayX],
      gridcolor: '#222',
      zerolinecolor: '#444',
      tickfont: { color: '#888' },
      titlefont: { color: '#888' },
      fixedrange: true
    },
    yaxis: {
      title: 'Sensitivity Multiplier',
      range: [0, maxY * 1.1],
      gridcolor: '#222',
      zerolinecolor: '#444',
      tickfont: { color: '#888' },
      titlefont: { color: '#888' },
      fixedrange: true
    },
    showlegend: true,
    legend: {
      x: 0,
      y: 1,
      traceorder: 'normal',
      font: { color: '#888' },
      bgcolor: 'rgba(0,0,0,0)'
    },
    dragmode: false,
    hovermode: false
  };

  const config = {
    displayModeBar: false,
    responsive: true,
    staticPlot: true
  };

  const plotElement = document.getElementById('sensitivity-plot');
  Plotly.newPlot('sensitivity-plot', traces, layout, config).then(() => {
    Plotly.Plots.resize(plotElement);
  });
}

let resizeTimeout;
const plotElement = document.getElementById('sensitivity-plot');

if (plotElement) {
    const debounceResize = () => {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        
        requestAnimationFrame(() => {
            const container = plotElement.parentElement;
            const width = container.clientWidth;
            const height = container.clientHeight;
            
            if (plotElement._prevWidth !== width || plotElement._prevHeight !== height) {
                plotElement._prevWidth = width;
                plotElement._prevHeight = height;
                
                Plotly.relayout(plotElement, {
                    width: width,
                    height: height,
                    'plot_bgcolor': 'transparent',
                    'paper_bgcolor': 'transparent'
                });
            }
        });
        
        resizeTimeout = setTimeout(() => {
            updatePlot();
        }, 150);
    };

    const resizeObserver = new ResizeObserver((entries) => {
        if (!entries[0]) return;
        debounceResize();
    });

    resizeObserver.observe(plotElement.parentElement);
}

document.addEventListener('DOMContentLoaded', () => {
  initializeSettings();
  
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', async () => {
      if (isAnimating) return;
      
      const newTab = button.dataset.tab;
      if (currentTab === newTab) return;
      
      isAnimating = true;
      
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      document.getElementById(`${newTab}-settings`).classList.add('active');
      
      document.body.className = `${newTab}-tab`;
      
      const settingKeys = ['range', 'growth_base', 'max_sens'];
      const startValues = {};
      const endValues = settings[newTab];
      
      settingKeys.forEach(key => {
        const slider = document.getElementById(`${currentTab}-${key}-slider`);
        startValues[key] = parseFloat(slider.value);
      });
      
      const duration = 300;
      const frames = 30;
      const interval = duration / frames;
      
      for (let frame = 0; frame <= frames; frame++) {
        const progress = frame / frames;
        const eased = 1 - Math.pow(1 - progress, 3);
        
        settingKeys.forEach(key => {
          const slider = document.getElementById(`${newTab}-${key}-slider`);
          const input = document.getElementById(`${newTab}-${key}-input`);
          
          if (slider && input) {
            const start = startValues[key];
            const end = endValues[key];
            const current = start + (end - start) * eased;
            const formatted = key === 'range' ? Math.round(current) : current.toFixed(3);
            
            slider.value = formatted;
            input.value = formatted;
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, interval));
      }
      
      settingKeys.forEach(key => {
        const slider = document.getElementById(`${newTab}-${key}-slider`);
        const input = document.getElementById(`${newTab}-${key}-input`);
        if (slider && input) {
          const formatted = key === 'range' ? Math.round(endValues[key]) : endValues[key].toFixed(3);
          slider.value = formatted;
          input.value = formatted;
        }
      });
      
      currentTab = newTab;
      isAnimating = false;
      updatePlot();
    });
  });

  document.getElementById('reset-btn').addEventListener('click', async () => {
    settings = await invoke('get_default_settings');
    updateUIFromSettings();
    updatePlot();
  });

  document.getElementById('export-btn').addEventListener('click', async () => {
    const points = await invoke('calculate_curve', { settings });
  });
});

let tooltipElement = null;
let tooltipTimeout = null;
const TOOLTIP_DELAY = 400;

function createTooltip() {
  tooltipElement = document.createElement('div');
  tooltipElement.className = 'floating-tooltip';
  document.body.appendChild(tooltipElement);
}

function showTooltip(event) {
  const target = event.target;
  const tooltip = target.getAttribute('data-tooltip');
  if (!tooltip) return;

  if (!tooltipElement) {
    createTooltip();
  }

  tooltipElement.textContent = tooltip;
  tooltipElement.style.display = 'block';

  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();
  
  let x = rect.left + (rect.width - tooltipRect.width) / 2;
  let y = rect.top - tooltipRect.height - 8;

  x = Math.max(8, Math.min(x, window.innerWidth - tooltipRect.width - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - tooltipRect.height - 8));

  tooltipElement.style.left = `${x}px`;
  tooltipElement.style.top = `${y}px`;
}

function hideTooltip() {
  if (tooltipTimeout) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = null;
  }
  if (tooltipElement) {
    tooltipElement.style.display = 'none';
  }
}

document.addEventListener('mouseover', (e) => {
  if (e.target.hasAttribute('data-tooltip')) {
    if (tooltipTimeout) clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => showTooltip(e), TOOLTIP_DELAY);
  }
});

document.addEventListener('mouseout', (e) => {
  if (e.target.hasAttribute('data-tooltip')) {
    hideTooltip();
  }
});

document.addEventListener('mousemove', (e) => {
  if (e.target.hasAttribute('data-tooltip') && tooltipElement?.style.display === 'block') {
    showTooltip(e);
  }
});