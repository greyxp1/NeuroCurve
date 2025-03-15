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

let settings = null;
let chart = null;

async function initializeSettings() {
  settings = await invoke('get_default_settings');
  
  createFlickingSettings();
  updateUIFromSettings();
  updatePlot();
  
  const dpiSlider = document.getElementById('dpi');
  const dpiInput = document.getElementById('dpi-value');
  
  dpiSlider.addEventListener('input', 
    createSliderHandler(dpiSlider, dpiInput, 'common', 'dpi')
  );

  dpiInput.addEventListener('change', (e) => {
    dpiSlider.value = e.target.value;
    settings.common.dpi = parseFloat(e.target.value);
    updatePlot();
  });

  const minSensSlider = document.getElementById('min-sens');
  const minSensInput = document.getElementById('min-sens-value');
  
  minSensSlider.addEventListener('input', 
    createSliderHandler(minSensSlider, minSensInput, 'common', 'min_sens')
  );

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
  document.getElementById('max-sens').value = settings.flicking.max_sens;
  document.getElementById('max-sens-value').value = settings.flicking.max_sens;

  updateFlickingSettings();
}

function createFlickingSettings() {
  const container = document.getElementById('all-settings');
  const settingOrder = ['range', 'growth_base'];
  const settingInfo = {
    'range': {
      label: 'Range',
      tooltip: 'Speed range (in counts/ms) over which sensitivity increases',
      min: 0,
      max: 200,
      step: 1
    },
    'growth_base': {
      label: 'Growth',
      tooltip: 'How quickly sensitivity increases within the range (higher = faster growth)',
      min: 1.001,
      max: 1.5,
      step: 0.001
    }
  };

  const maxSensSlider = document.getElementById('max-sens');
  const maxSensInput = document.getElementById('max-sens-value');
  
  maxSensSlider.addEventListener('input', 
    createSliderHandler(maxSensSlider, maxSensInput, 'flicking', 'max_sens')
  );

  maxSensInput.addEventListener('change', (e) => {
    maxSensSlider.value = e.target.value;
    settings.flicking.max_sens = parseFloat(e.target.value);
    updatePlot();
  });

  for (const key of settingOrder) {
    const info = settingInfo[key];
    const row = document.createElement('div');
    row.className = 'setting-row';
    
    const label = document.createElement('div');
    label.className = 'setting-label';
    label.textContent = info.label;
    label.setAttribute('data-tooltip', info.tooltip);
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `flicking-${key}-slider`;
    slider.className = 'setting-slider';
    slider.min = info.min;
    slider.max = info.max;
    slider.step = info.step;
    
    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.id = `flicking-${key}-input`;
    numberInput.className = 'setting-value';
    numberInput.min = info.min;
    numberInput.max = info.max;
    numberInput.step = info.step;
    
    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(numberInput);
    container.appendChild(row);
    
    slider.addEventListener('input', 
      createSliderHandler(slider, numberInput, 'flicking', key)
    );

    numberInput.addEventListener('change', (e) => {
      const newValue = key === 'range' 
        ? Math.round(parseFloat(e.target.value)) 
        : parseFloat(e.target.value);
      slider.value = newValue;
      settings.flicking[key] = newValue;
      updatePlot();
    });
  }
}

function updateFlickingSettings() {
  const settingOrder = ['range', 'growth_base', 'max_sens'];
  
  for (const key of settingOrder) {
    const value = settings.flicking[key];
    if (value === undefined) continue;

    const slider = document.getElementById(`flicking-${key}-slider`);
    const input = document.getElementById(`flicking-${key}-input`);
    
    if (slider && input) {
      slider.value = key === 'range' ? Math.round(value) : value;
      input.value = key === 'range' ? Math.round(value) : value;
    }
  }
}

async function updatePlot() {
  const points = await invoke('calculate_curve', { settings });
  
  const ctx = document.getElementById('sensitivity-plot');
  
  if (!chart) {
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: points.map(p => p[0].toFixed(1)),
        datasets: [{
          data: points.map(p => p[1]),
          borderColor: '#4d9fff',
          borderWidth: 3.5,
          pointRadius: 0,
          tension: 0.3,
          fill: false
        }]
      },
      options: createChartOptions()
    });
  } else {
    chart.data.labels = points.map(p => p[0].toFixed(1));
    chart.data.datasets[0].data = points.map(p => p[1]);
    chart.update({
      duration: 300,
      easing: 'easeOutQuart'
    });
  }
}

function createChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 300,
      easing: 'easeOutQuart'
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        enabled: false
      }
    },
    scales: {
      x: {
        grid: {
          color: '#222',
        },
        border: {
          color: '#444'
        },
        ticks: {
          color: '#888',
          maxRotation: 0,
          callback: function(value) {
            return Math.round(value);
          }
        },
        title: {
          display: true,
          text: 'Input Speed (counts/ms)',
          color: '#888',
          font: {
            size: 12
          }
        }
      },
      y: {
        grid: {
          color: '#222',
        },
        border: {
          color: '#444'
        },
        ticks: {
          color: '#888'
        },
        title: {
          display: true,
          text: 'Sensitivity Multiplier',
          color: '#888',
          font: {
            size: 12
          }
        }
      }
    },
    interaction: {
      intersect: false,
      mode: 'index'
    }
  };
}

function createSliderHandler(slider, input, settingType, settingKey) {
  let animationFrame;
  
  return (e) => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
    
    animationFrame = requestAnimationFrame(() => {
      const newValue = settingKey === 'range' 
        ? Math.round(parseFloat(e.target.value)) 
        : parseFloat(e.target.value);
        
      input.value = newValue;
      settings[settingType][settingKey] = newValue;
      updatePlot();
    });
  };
}

function initializeTooltips() {
  const tooltip = document.createElement('div');
  tooltip.className = 'floating-tooltip';
  document.body.appendChild(tooltip);

  let tooltipTimeout = null;
  const TOOLTIP_DELAY = 400;

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (target.hasAttribute('data-tooltip')) {
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
      }

      tooltipTimeout = setTimeout(() => {
        const tooltipText = target.getAttribute('data-tooltip');
        tooltip.textContent = tooltipText;
        
        const targetRect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        let top = targetRect.top - tooltipRect.height - 8;
        
        const viewportWidth = window.innerWidth;
        
        if (left < 8) {
          left = 8;
        } else if (left + tooltipRect.width > viewportWidth - 8) {
          left = viewportWidth - tooltipRect.width - 8;
        }
        
        if (top < 8) {
          top = targetRect.bottom + 8;
        }
        
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        
        tooltip.classList.add('visible');
      }, TOOLTIP_DELAY);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    if (target.hasAttribute('data-tooltip')) {
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
      }
      tooltip.classList.remove('visible');
    }
  });

  document.addEventListener('scroll', () => {
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
    tooltip.classList.remove('visible');
  }, true);
}

document.addEventListener('DOMContentLoaded', () => {
  initializeTooltips();
});

window.addEventListener('beforeunload', () => {
  if (chart) {
    chart.destroy();
  }
});

document.getElementById('reset-btn').addEventListener('click', async () => {
  settings = await invoke('get_default_settings');
  updateUIFromSettings();
  updatePlot();
});

document.getElementById('export-btn').addEventListener('click', async () => {
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

initializeSettings();
