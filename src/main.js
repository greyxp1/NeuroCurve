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

// Reset button handler
document
  .getElementById('reset-btn')
  ?.addEventListener('click', async () => {
    console.log('Reset button clicked'); // Debug log
    settings = await invoke('get_default_settings');
    updateUIFromSettings();
    updatePlot();
  });

// Export button handler
document
  .getElementById('export-btn')
  ?.addEventListener('click', async () => {
    const points = await invoke('calculate_curve', { settings });
    
    // Format the points as a LUT string (skip first point as in old_app.rs)
    const lut = points
      .slice(1)  // Skip first point
      .map(([x, y]) => `${x},${y.toFixed(4)}`)
      .join(';\n');
    
    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(lut);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  });

let settings = null;
let currentTab = 'micro';

async function initializeSettings() {
  settings = await invoke('get_default_settings');
  updateUIFromSettings();
  updatePlot();

  // Add event listeners for DPI slider and input
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

  // Add event listeners for Base sensitivity slider and input
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
  // Update common settings
  document.getElementById('dpi').value = settings.common.dpi;
  document.getElementById('dpi-value').value = settings.common.dpi;
  document.getElementById('min-sens').value = settings.common.min_sens;
  document.getElementById('min-sens-value').value = settings.common.min_sens;

  // Update tab settings
  updateTabSettings('micro');
  updateTabSettings('tracking');
  updateTabSettings('flicking');
}

function initializeTooltips() {
  document.querySelectorAll('[data-tooltip]').forEach(element => {
    const title = element.getAttribute('title');
    if (title) {
      element.setAttribute('data-tooltip', title);
      element.removeAttribute('title');
    }
  });
}

function updateTabSettings(tab) {
  const container = document.getElementById(`${tab}-settings`);
  container.innerHTML = ''; // Clear existing settings

  // Define settings order and their properties
  const settingsOrder = ['range', 'growth_base', 'max_sens'];
  const settingInfo = {
    'range': {
      label: 'Range',
      tooltip: 'Speed threshold before increasing sensitivity\nHigher values mean the effect kicks in at faster movements'
    },
    'growth_base': {
      label: 'Rate',
      tooltip: 'How quickly sensitivity increases\nHigher values mean more aggressive acceleration'
    },
    'max_sens': {
      label: 'Max',
      tooltip: 'Maximum sensitivity multiplier\nLimits how high the sensitivity can go'
    }
  };

  const tabSettings = settings[tab];
  
  // Create settings in specified order
  for (const key of settingsOrder) {
    const value = tabSettings[key];
    const row = document.createElement('div');
    row.className = 'setting-row';
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'setting-label';
    labelDiv.textContent = settingInfo[key]?.label || key;
    labelDiv.setAttribute('data-tooltip', settingInfo[key]?.tooltip || '');
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'setting-slider';
    slider.min = 0;
    slider.max = key === 'range' ? 100 : key === 'growth_base' ? 2 : 5;
    slider.step = 0.001;
    slider.value = value;
    
    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.className = 'setting-value';
    numberInput.value = value;
    numberInput.step = 0.001;
    
    row.appendChild(labelDiv);
    row.appendChild(slider);
    row.appendChild(numberInput);
    
    container.appendChild(row);

    // Add event listeners
    slider.addEventListener('input', (e) => {
      numberInput.value = e.target.value;
      settings[tab][key] = parseFloat(e.target.value);
      updatePlot();
    });

    numberInput.addEventListener('change', (e) => {
      slider.value = e.target.value;
      settings[tab][key] = parseFloat(e.target.value);
      updatePlot();
    });

    // Add these event listeners to your slider creation code
    slider.addEventListener('mousedown', () => {
      const tabContainer = document.querySelector('.tab-container');
      tabContainer.classList.add('interacting');
    });

    slider.addEventListener('mouseup', () => {
      const tabContainer = document.querySelector('.tab-container');
      tabContainer.classList.remove('interacting');
    });

    // Also handle mouse leaving the window
    window.addEventListener('mouseup', () => {
      const tabContainer = document.querySelector('.tab-container');
      tabContainer.classList.remove('interacting');
    });

    // For the number inputs
    numberInput.addEventListener('focus', () => {
      const tabContainer = document.querySelector('.tab-container');
      tabContainer.classList.add('interacting');
    });

    numberInput.addEventListener('blur', () => {
      const tabContainer = document.querySelector('.tab-container');
      tabContainer.classList.remove('interacting');
    });
  }
  
  // Initialize tooltips for the newly created elements
  initializeTooltips();
}

async function updatePlot() {
  const points = await invoke('calculate_curve', { settings });
  
  // Calculate section boundaries based on ranges
  const microEnd = Math.min(Math.round(settings.micro.range), points.length);
  const trackingEnd = Math.min(Math.round(microEnd + settings.tracking.range), points.length);
  
  // Calculate display range
  const totalThreshold = Math.round(settings.micro.range + settings.tracking.range + settings.flicking.range);
  const baseDisplayX = totalThreshold * points[1][0];
  const displayX = Math.ceil(baseDisplayX * 1.2);

  // Ensure we have valid points for each section
  const microPoints = points.slice(0, microEnd + 1);
  const trackingPoints = points.slice(microEnd, trackingEnd + 1);
  const flickingPoints = points.slice(trackingEnd);

  // Create traces only if there are points
  const traces = [];
  
  if (microPoints.length > 0) {
    traces.push({
      x: microPoints.map(p => p[0]),
      y: microPoints.map(p => p[1]),
      type: 'scatter',
      mode: 'lines',
      name: 'Micro',
      line: { color: '#3d8bff', width: 3.5 }
    });
  }

  if (trackingPoints.length > 0) {
    traces.push({
      x: trackingPoints.map(p => p[0]),
      y: trackingPoints.map(p => p[1]),
      type: 'scatter',
      mode: 'lines',
      name: 'Tracking',
      line: { color: '#ff9900', width: 3.5 }
    });
  }

  if (flickingPoints.length > 0) {
    traces.push({
      x: flickingPoints.map(p => p[0]),
      y: flickingPoints.map(p => p[1]),
      type: 'scatter',
      mode: 'lines',
      name: 'Flicking',
      line: { color: '#33cc33', width: 3.5 }
    });
  }

  // Calculate max Y value only from visible points
  const visiblePoints = points.filter(p => p[0] <= displayX);
  const maxY = visiblePoints.length > 0 
    ? Math.max(...visiblePoints.map(p => p[1])) 
    : 1;

  const layout = {
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)',
    autosize: true,
    useResizeHandler: true,
    responsive: true,
    margin: {
      l: 50,
      r: 30,
      b: 50,
      t: 10,  // Reduced from 20 to 10
      pad: 0
    },
    xaxis: {
      title: 'Input Velocity',
      gridcolor: '#333',
      zerolinecolor: '#333',
      fixedrange: true,
      range: [0, displayX],
      showline: true,
      linewidth: 2,
      linecolor: '#464646',
      mirror: true,
      layer: 'above traces',
      showgrid: true,
      gridwidth: 1,
      zeroline: false,
      automargin: false,
      constrain: 'domain'
    },
    yaxis: {
      title: 'Sensitivity Multiplier',
      gridcolor: '#333',
      zerolinecolor: '#333',
      fixedrange: true,
      range: [0, maxY * 1.15],
      showline: true,
      linewidth: 2,
      linecolor: '#464646',
      mirror: true,
      layer: 'above traces',
      showgrid: true,
      gridwidth: 1,
      zeroline: false,
      automargin: false,
      constrain: 'domain'
    },
    font: {
      color: '#c8c8c8'
    },
    showlegend: true,
    legend: {
      x: 0.02,
      y: 0.98,
      xanchor: 'left',
      yanchor: 'top',
      bgcolor: 'rgba(0,0,0,0.7)',
      bordercolor: '#464646',
      borderwidth: 1,
      font: { color: '#c8c8c8' }
    }
  };

  const config = {
    responsive: true,
    displayModeBar: false,
    scrollZoom: false,
    doubleClick: false,
    showTips: false,
    displaylogo: false,
    staticPlot: false
  };

  Plotly.newPlot('sensitivity-plot', traces, layout, config).then(() => {
    // Force an initial resize
    Plotly.Plots.resize(plotElement);
  });
}

// Replace the resize observer with a more aggressive approach
let resizeTimeout;
const plotElement = document.getElementById('sensitivity-plot');

if (plotElement) {
    const debounceResize = () => {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        
        // Use requestAnimationFrame for smoother updates
        requestAnimationFrame(() => {
            const container = plotElement.parentElement;
            const width = container.clientWidth;
            const height = container.clientHeight;
            
            // Only update if dimensions actually changed
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
        
        // Debounce full plot update
        resizeTimeout = setTimeout(() => {
            updatePlot();
        }, 150); // Increased debounce time
    };

    // Use ResizeObserver with debouncing
    const resizeObserver = new ResizeObserver((entries) => {
        if (!entries[0]) return;
        debounceResize();
    });

    // Observe the plot panel instead of the plot element
    resizeObserver.observe(plotElement.parentElement);

    // Remove window resize listener as ResizeObserver is sufficient
    // window.addEventListener('resize', debounceResize);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  const tooltip = document.createElement('div');
  tooltip.className = 'floating-tooltip';
  document.body.appendChild(tooltip);

  let tooltipTimeout = null;

  // Handle tooltip events using event delegation
  document.body.addEventListener('mouseenter', (e) => {
    const element = e.target;
    if (element.hasAttribute('data-tooltip')) {
      // Clear any existing timeout
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
      }

      // Set new timeout
      tooltipTimeout = setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const tooltipText = element.getAttribute('data-tooltip');
        
        tooltip.textContent = tooltipText;
        tooltip.style.display = 'block';
        
        let top = rect.top - tooltip.offsetHeight - 8;
        let left = rect.left;

        if (top < 8) {
          top = rect.bottom + 8;
        }

        if (left + tooltip.offsetWidth > window.innerWidth - 8) {
          left = window.innerWidth - tooltip.offsetWidth - 8;
        }

        left = Math.max(8, left);

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
      }, 500); // 500ms delay before showing tooltip
    }
  }, true);

  document.body.addEventListener('mouseleave', (e) => {
    if (e.target.hasAttribute('data-tooltip')) {
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
      }
      tooltip.style.display = 'none';
    }
  }, true);

  initializeTooltips();

  initializeSettings();

  // Add this function to handle tab switching
  function switchTab(tab) {
    currentTab = tab;
    
    // Update active states
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.getAttribute('data-tab') === tab) {
        btn.classList.add('active');
      }
    });

    // Hide all tab content and show the selected one
    document.querySelectorAll('[id$="-settings"]').forEach(content => {
      content.style.display = 'none';
    });
    document.getElementById(`${tab}-settings`).style.display = 'block';

    // Update tab container classes only - remove the direct style setting
    const tabContainer = document.querySelector('.tab-container');
    tabContainer.className = 'tab-container';
    tabContainer.classList.add(`${tab}-tab`);
  }

  // Update the tab button event listeners
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Make sure to set initial tab on load
  document.addEventListener('DOMContentLoaded', () => {
    switchTab('micro'); // Set default tab
  });

  // Reset button event listener
  document.getElementById('reset-btn').addEventListener('click', async () => {
    try {
      // Get fresh default settings from Rust
      settings = await invoke('reset_settings');
      
      // Update UI with new settings
      updateUIFromSettings();
      
      // Update the plot
      await updatePlot();
    } catch (error) {
      console.error('Failed to reset settings:', error);
    }
  });

  // Export button
  document.getElementById('export-btn').addEventListener('click', async () => {
    const points = await invoke('calculate_curve', { settings });
    
    // Format the points as a LUT string (skip first point as in old_app.rs)
    const lut = points
      .slice(1)  // Skip first point
      .map(([x, y]) => `${x},${y.toFixed(4)}`)
      .join(';\n');
    
    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(lut);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  });
});
