'use strict';

const SolcastApi = require('../lib/SolcastApi');
const ForecastAggregator = require('../lib/ForecastAggregator');

const apiKey = process.env.SOLCAST_API_KEY || process.argv[2];
if (!apiKey) {
  console.error('Usage: node cli/fetch-forecast.js <API_KEY>');
  console.error('  Or set SOLCAST_API_KEY environment variable');
  console.error('  Or create .env file with SOLCAST_API_KEY=...');
  process.exit(1);
}

async function main() {
  const api = new SolcastApi({ apiKey, timeout: 30000 });

  console.log('Solcast PV Forecast');
  console.log('===================\n');

  // Fetch sites
  console.log('Fetching sites...');
  const sites = await api.getSites();
  console.log(`Found ${sites.length} site(s):`);
  for (const site of sites) {
    console.log(`  ${site.name} (${site.resource_id}) — ${site.capacity}kW, ${site.location}`);
  }
  console.log('');

  // Fetch forecasts
  const siteIds = sites.map(s => s.resource_id);
  console.log(`Fetching 48h forecast for ${siteIds.length} site(s)...`);
  const forecasts = await api.getAllForecasts(siteIds, 48);
  console.log(`Got ${forecasts.length} intervals\n`);

  // Compute values
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const agg = new ForecastAggregator(forecasts, 'pv_estimate', 0);
  const values = agg.getAll(timezone);

  console.log(`--- Power (${timezone}) ---`);
  console.log(`  Power Now:          ${values.power_now} W`);
  console.log(`  Power in 30min:     ${values.power_30m} W`);
  console.log(`  Power in 1hr:       ${values.power_1hr} W`);
  console.log('');
  console.log('--- Energy ---');
  console.log(`  Forecast Today:     ${values.forecast_today} kWh`);
  console.log(`  Forecast Tomorrow:  ${values.forecast_tomorrow} kWh`);
  console.log(`  Remaining Today:    ${values.forecast_remaining} kWh`);
  console.log(`  This Hour:          ${values.forecast_this_hour} Wh`);
  console.log(`  Next Hour:          ${values.forecast_next_hour} Wh`);
  console.log('');
  console.log('--- Peak ---');
  console.log(`  Peak Today:         ${values.peak_today} W`);
  console.log(`  Peak Tomorrow:      ${values.peak_tomorrow} W`);
  console.log(`  Peak Time Today:    ${values.peak_time_today || 'N/A'}`);
  console.log(`  Peak Time Tomorrow: ${values.peak_time_tomorrow || 'N/A'}`);
  console.log('');

  const usage = api.getUsage();
  console.log(`API Usage: ${usage.used}/${usage.limit}`);
}

// Load .env if exists
try {
  const envContent = require('fs').readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
} catch { /* no .env */ }

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
