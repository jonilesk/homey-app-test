'use strict';

const SolcastApi = require('../lib/SolcastApi');
const ForecastAggregator = require('../lib/ForecastAggregator');

// Load .env
try {
  const envContent = require('fs').readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
} catch { /* no .env */ }

const apiKey = process.env.SOLCAST_API_KEY || process.argv[2];
const intervalMin = parseInt(process.argv[3] || '60', 10);

if (!apiKey) {
  console.error('Usage: node cli/monitor.js <API_KEY> [interval_minutes]');
  console.error('  Or set SOLCAST_API_KEY in .env');
  process.exit(1);
}

let forecasts = [];
let pollCount = 0;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function poll(api) {
  pollCount++;
  const ts = new Date().toLocaleTimeString();

  try {
    const sites = await api.getSites();
    const siteIds = sites.map(s => s.resource_id);
    forecasts = await api.getAllForecasts(siteIds, 48);

    const agg = new ForecastAggregator(forecasts, 'pv_estimate', 0);
    const v = agg.getAll(timezone);
    const usage = api.getUsage();

    console.log(`[${ts}] Poll #${pollCount} — ${v.power_now}W now | ${v.forecast_today}kWh today | ${v.forecast_remaining}kWh remaining | Peak ${v.peak_today}W | API ${usage.used}/${usage.limit}`);
  } catch (err) {
    console.log(`[${ts}] Poll #${pollCount} — Error: ${err.message}`);
  }
}

function refresh() {
  if (forecasts.length === 0) return;
  const ts = new Date().toLocaleTimeString();
  const agg = new ForecastAggregator(forecasts, 'pv_estimate', 0);
  const v = agg.getAll(timezone);
  console.log(`[${ts}] Refresh — ${v.power_now}W now | ${v.forecast_remaining}kWh remaining`);
}

async function main() {
  const api = new SolcastApi({ apiKey, timeout: 30000 });

  console.log(`Solcast Monitor (${timezone})`);
  console.log(`Polling every ${intervalMin}min, refreshing every 5min`);
  console.log('Press Ctrl+C to stop\n');

  await poll(api);

  // Refresh display every 5 minutes (recompute from cached data)
  const refreshTimer = setInterval(refresh, 5 * 60 * 1000);

  // Fetch new data at configured interval
  const pollTimer = setInterval(() => poll(api), intervalMin * 60 * 1000);

  process.on('SIGINT', () => {
    console.log('\nStopping...');
    clearInterval(refreshTimer);
    clearInterval(pollTimer);
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
