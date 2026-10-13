'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  availableMonths: [],
  geojson: null,
  geojsonLayer: null,
  pricesByMonth: {},    // cache: month_str -> payload
  currentMonth: null,
  activeMetric: 'price',
};

// ── Map init ───────────────────────────────────────────────────────────────────
const map = L.map('map', {
  center: [38.5, -96],
  zoom: 4,
  zoomSnap: 0.5,
  minZoom: 3,
  maxZoom: 8,
  attributionControl: true,
});

// OpenStreetMap tiles -- no API key, no domain restrictions.
// CSS dark filter applied in style.css (.leaflet-tile-pane) to match the theme.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

// ── Color scales ───────────────────────────────────────────────────────────────
// Fixed absolute thresholds -- consistent across all months.
const PRICE_BREAKS = [8, 10, 12, 14, 17, 20];
const PRICE_COLORS = ['#c6dba2', '#b7d6b7', '#87b8f8', '#779efb', '#455bb1', '#2e3f8a'];

const SALES_BREAKS = [1000, 3000, 6000, 12000, 25000, 50000];
const SALES_COLORS = ['#c6dba2', '#b7d6b7', '#87b8f8', '#779efb', '#455bb1', '#2e3f8a'];

function valueToColor(value, metric) {
  if (value == null) return '#1a2035';
  const breaks = metric === 'price' ? PRICE_BREAKS : SALES_BREAKS;
  const colors = metric === 'price' ? PRICE_COLORS : SALES_COLORS;
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (value >= breaks[i]) return colors[i];
  }
  return colors[0];
}

// ── GeoJSON style helpers ──────────────────────────────────────────────────────
function featureStyle(priceMap, salesMap, metric) {
  return function (feature) {
    const name  = feature.properties.name.toLowerCase();
    const value = metric === 'price' ? priceMap[name] : salesMap[name];
    return {
      fillColor:   valueToColor(value, metric),
      fillOpacity: 0.84,
      color:       'rgba(198,219,162,0.6)',
      weight:      1.2,
      opacity:     1,
    };
  };
}

function bindTooltip(layer, priceMap, salesMap) {
  const name  = layer.feature.properties.name;
  const key   = name.toLowerCase();
  const price = priceMap[key];
  const sales = salesMap[key];

  const priceText = price != null
    ? `${price.toFixed(2)}¢/kWh`
    : '<em style="color:#8b949e">No data</em>';
  const salesText = sales != null
    ? `${Math.round(sales).toLocaleString()} GWh`
    : '<em style="color:#8b949e">No data</em>';

  layer.bindTooltip(
    `<strong>${name}</strong><br>Price: ${priceText}<br>Sales: ${salesText}`,
    { sticky: true, opacity: 1 }
  );
}

// ── Build data lookups from API payload ────────────────────────────────────────
// EIA returns state_description in ALL CAPS; GeoJSON uses Title Case -- normalise to lowercase.
function buildDataMaps(payload) {
  const priceMap = {};
  const salesMap = {};
  for (const s of payload.states) {
    const key = (s.state_description || '').toLowerCase();
    if (key) {
      priceMap[key] = s.avg_price;
      salesMap[key] = s.total_sales;
    }
  }
  return { priceMap, salesMap };
}

// ── Render choropleth for a loaded payload ─────────────────────────────────────
function renderMonth(payload) {
  const { priceMap, salesMap } = buildDataMaps(payload);
  const metric = state.activeMetric;

  if (state.geojsonLayer) {
    state.geojsonLayer.setStyle(featureStyle(priceMap, salesMap, metric));
    state.geojsonLayer.eachLayer(layer => {
      layer.unbindTooltip();
      bindTooltip(layer, priceMap, salesMap);
    });
  } else {
    state.geojsonLayer = L.geoJSON(state.geojson, {
      style: featureStyle(priceMap, salesMap, metric),
      onEachFeature(feature, layer) {
        bindTooltip(layer, priceMap, salesMap);
        layer.on({
          mouseover(e) {
            e.target.setStyle({ weight: 1.8, color: '#c6dba2', fillOpacity: 0.95 });
            const name     = e.target.feature.properties.name;
            const key      = name.toLowerCase();
            const price    = priceMap[key];
            const sales    = salesMap[key];
            const card     = document.getElementById('hover-state');
            card.style.opacity = '1';
            // Show the value for the active metric
            if (state.activeMetric === 'price') {
              document.getElementById('hover-value').textContent =
                price != null ? `${price.toFixed(2)}¢` : 'No data';
            } else {
              document.getElementById('hover-value').textContent =
                sales != null ? `${Math.round(sales).toLocaleString()} GWh` : 'No data';
            }
            document.getElementById('hover-name').textContent = name;
          },
          mouseout(e) {
            state.geojsonLayer.resetStyle(e.target);
            bindTooltip(e.target, priceMap, salesMap);
            document.getElementById('hover-state').style.opacity = '0.45';
            document.getElementById('hover-value').textContent = '--';
            document.getElementById('hover-name').textContent = '--';
          },
        });
      },
    }).addTo(map);
  }

  updateStats(payload);
}

// ── Stats panel ────────────────────────────────────────────────────────────────
function updateStats(payload) {
  const s = payload.stats;

  setCard('national-avg',
    s.national_avg_price != null ? `${s.national_avg_price.toFixed(2)}¢` : '--',
    'cents/kWh · all sectors',
    'cobalt'
  );
  setCard('national-sales',
    s.national_total_sales != null
      ? `${Math.round(s.national_total_sales).toLocaleString()} GWh`
      : '--',
    'monthly · all sectors',
    'electric'
  );
  setCard('cheapest-state',
    s.state_min_price != null ? `${s.state_min_price.toFixed(2)}¢` : '--',
    s.state_min_price_name ? `${titleCase(s.state_min_price_name)} · lowest price` : '--',
    'green'
  );
  setCard('priciest-state',
    s.state_max_price != null ? `${s.state_max_price.toFixed(2)}¢` : '--',
    s.state_max_price_name ? `${titleCase(s.state_max_price_name)} · highest price` : '--',
    'red'
  );
}

function setCard(id, value, sub, colorClass) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('.value').textContent = value;
  el.querySelector('.value').className = `value ${colorClass}`;
  el.querySelector('.sub').textContent = sub;
}

// Convert ALL CAPS state name to Title Case for display
function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Legend ─────────────────────────────────────────────────────────────────────
function updateLegend(metric) {
  const gradient  = document.getElementById('legend-gradient');
  const labelsEl  = document.getElementById('legend-labels');
  const titleEl   = document.getElementById('legend-title');

  const colors = metric === 'price' ? PRICE_COLORS : SALES_COLORS;
  const breaks = metric === 'price' ? PRICE_BREAKS : SALES_BREAKS;

  gradient.style.background = `linear-gradient(to right, ${colors.join(', ')})`;

  // Rebuild label spans
  labelsEl.innerHTML = '';
  breaks.forEach((b, i) => {
    const span = document.createElement('span');
    span.textContent = i === breaks.length - 1 ? `${b}+` : String(b);
    labelsEl.appendChild(span);
  });

  if (metric === 'price') {
    titleEl.textContent = 'cents/kWh';
  } else {
    titleEl.textContent = 'GWh (sales)';
  }
}

// ── Metric toggle wiring ───────────────────────────────────────────────────────
document.querySelectorAll('.metric-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeMetric = btn.dataset.metric;
    document.querySelectorAll('.metric-btn').forEach(b => b.classList.toggle('active', b === btn));
    updateLegend(state.activeMetric);
    if (state.pricesByMonth[state.currentMonth]) {
      renderMonth(state.pricesByMonth[state.currentMonth]);
    }
  });
});

// ── Month loading (with in-memory cache) ──────────────────────────────────────
async function loadMonth(monthStr) {
  showLoading(true);
  try {
    if (!state.pricesByMonth[monthStr]) {
      const resp = await fetch(`data/electricity_${monthStr}.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      state.pricesByMonth[monthStr] = await resp.json();
    }
    state.currentMonth = monthStr;
    renderMonth(state.pricesByMonth[monthStr]);
    document.getElementById('month-display').textContent = formatMonth(monthStr);
  } catch (err) {
    console.error('Failed to load month', monthStr, err);
  } finally {
    showLoading(false);
  }
}

function formatMonth(str) {
  const [y, m] = str.split('-');
  const d = new Date(+y, +m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Autoplay ───────────────────────────────────────────────────────────────────
const PLAY_SPEED_MS = 900;
let playTimer = null;

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  const btn = document.getElementById('play-btn');
  btn.classList.remove('playing');
  btn.innerHTML = '&#9654;';
  btn.title = 'Play through all months';
}

function startPlay() {
  const slider = document.getElementById('month-slider');
  const btn    = document.getElementById('play-btn');

  // If already at the end, restart from the beginning
  if (+slider.value >= +slider.max) {
    slider.value = 0;
    syncSliderFill(slider);
  }

  btn.classList.add('playing');
  btn.innerHTML = '&#9646;&#9646;';
  btn.title = 'Pause';

  playTimer = setInterval(() => {
    const next = +slider.value + 1;
    if (next > +slider.max) {
      stopPlay();
      return;
    }
    slider.value = next;
    syncSliderFill(slider);
    const month = state.availableMonths[next];
    document.getElementById('month-display').textContent = formatMonth(month);
    loadMonth(month);
  }, PLAY_SPEED_MS);
}

function togglePlay() {
  if (playTimer) { stopPlay(); } else { startPlay(); }
}

// Exposed to the onclick in HTML
window.togglePlay = togglePlay;

document.getElementById('play-btn').addEventListener('click', togglePlay);

// ── Slider wiring ──────────────────────────────────────────────────────────────
function syncSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty('--fill', `${pct}%`);
}

function initSlider(months) {
  const slider = document.getElementById('month-slider');
  slider.min   = 0;
  slider.max   = months.length - 1;
  slider.value = months.length - 1;

  document.querySelector('.slider-labels span:first-child').textContent =
    formatMonth(months[0]);
  document.querySelector('.slider-labels span:last-child').textContent =
    formatMonth(months[months.length - 1]);

  syncSliderFill(slider);

  let debounce;
  slider.addEventListener('input', () => {
    if (playTimer) stopPlay();  // manual drag cancels autoplay
    clearTimeout(debounce);
    syncSliderFill(slider);
    const month = months[+slider.value];
    document.getElementById('month-display').textContent = formatMonth(month);
    debounce = setTimeout(() => loadMonth(month), 120);
  });
}

// ── Loading overlay ────────────────────────────────────────────────────────────
function showLoading(visible) {
  document.getElementById('loading').classList.toggle('hidden', !visible);
}

// ── Boot ───────────────────────────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    const [manifestResp, geojsonResp] = await Promise.all([
      fetch('data/manifest.json'),
      fetch('data/us-states.geojson'),
    ]);

    if (!manifestResp.ok) throw new Error('manifest.json not found - run the pipeline first');
    if (!geojsonResp.ok)  throw new Error('us-states.geojson not found - run the pipeline first');

    const manifest = await manifestResp.json();
    state.geojson = await geojsonResp.json();
    state.availableMonths = manifest.available_months;

    document.getElementById('last-updated').textContent =
      `Last updated: ${new Date(manifest.last_updated).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      })}`;

    // Initialize legend for default metric (price)
    updateLegend(state.activeMetric);

    initSlider(state.availableMonths);
    await loadMonth(manifest.latest_month);
  } catch (err) {
    showLoading(false);
    const loadingEl = document.getElementById('loading');
    loadingEl.textContent = `Error: ${err.message}`;
    loadingEl.classList.remove('hidden');
    console.error(err);
  }
}

init();
