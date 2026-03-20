#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { HomeyAPI } = require('homey-api');

// ─── Helpers ───────────────────────────────────────────────

function printHeader(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}\n`);
}

function printSection(title) {
  console.log(`\n--- ${title} ---\n`);
}

function pad(str, len) {
  return String(str).padEnd(len);
}

// ─── Commands ──────────────────────────────────────────────

/**
 * List all devices with basic info
 */
async function cmdDevices(api, args) {
  const devices = Object.values(await api.devices.getDevices());
  const filter = args[0]?.toLowerCase();

  let filtered = devices;
  if (filter) {
    filtered = devices.filter(d =>
      d.name?.toLowerCase().includes(filter) ||
      d.class?.toLowerCase().includes(filter) ||
      d.driverUri?.toLowerCase().includes(filter) ||
      d.zoneName?.toLowerCase().includes(filter)
    );
  }

  printHeader(`Devices${filter ? ` matching "${filter}"` : ''} (${filtered.length}/${devices.length})`);

  // Sort by name
  filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  console.log(`${pad('Name', 30)} ${pad('Class', 14)} ${pad('Zone', 16)} ${pad('Driver', 30)} Available`);
  console.log(`${'-'.repeat(30)} ${'-'.repeat(14)} ${'-'.repeat(16)} ${'-'.repeat(30)} ---------`);

  for (const d of filtered) {
    console.log(
      `${pad(d.name || '?', 30)} ${pad(d.class || '?', 14)} ${pad(d.zoneName || '?', 16)} ${pad(d.driverUri || '?', 30)} ${d.available ? 'yes' : 'NO'}`
    );
  }
}

/**
 * Inspect a single device in full detail
 */
async function cmdInspect(api, args) {
  const search = args[0];
  if (!search) {
    console.error('Usage: homey-query inspect <device-name-or-id>');
    process.exit(1);
  }

  const devices = Object.values(await api.devices.getDevices());
  const searchLower = search.toLowerCase();
  const device = devices.find(d =>
    d.id === search ||
    d.name?.toLowerCase() === searchLower ||
    d.name?.toLowerCase().includes(searchLower)
  );

  if (!device) {
    console.error(`Device not found: "${search}"`);
    console.log('Available devices:');
    devices.forEach(d => console.log(`  - ${d.name} (${d.id})`));
    process.exit(1);
  }

  printHeader(`Device: ${device.name}`);

  // Basic info
  printSection('Identity');
  console.log(`  ID:         ${device.id}`);
  console.log(`  Name:       ${device.name}`);
  console.log(`  Class:      ${device.class}`);
  console.log(`  Zone:       ${device.zoneName || '?'}`);
  console.log(`  Available:  ${device.available}`);
  console.log(`  Driver URI: ${device.driverUri}`);
  console.log(`  Driver ID:  ${device.driverId}`);

  // Capabilities
  printSection('Capabilities');
  const caps = device.capabilities || [];
  if (caps.length === 0) {
    console.log('  (none)');
  } else {
    for (const capId of caps) {
      const capObj = device.capabilitiesObj?.[capId];
      const value = capObj?.value;
      const units = capObj?.units || '';
      const lastUpdated = capObj?.lastUpdated
        ? new Date(capObj.lastUpdated).toLocaleString()
        : '?';
      console.log(`  ${pad(capId, 30)} = ${pad(value !== null && value !== undefined ? `${value}${units ? ' ' + units : ''}` : '(null)', 20)} (updated: ${lastUpdated})`);
    }
  }

  // Energy configuration
  printSection('Energy Configuration');
  const energy = device.energyObj;
  if (!energy || Object.keys(energy).length === 0) {
    console.log('  (no energy configuration)');
  } else {
    for (const [key, val] of Object.entries(energy)) {
      if (typeof val === 'object' && val !== null) {
        console.log(`  ${key}:`);
        for (const [k2, v2] of Object.entries(val)) {
          console.log(`    ${k2}: ${JSON.stringify(v2)}`);
        }
      } else {
        console.log(`  ${pad(key, 30)} = ${JSON.stringify(val)}`);
      }
    }
  }

  // Energy-readiness assessment
  printSection('Energy Readiness Assessment');
  const hasMeasurePower = caps.includes('measure_power');
  const hasMeterPower = caps.some(c => c.startsWith('meter_power'));
  const hasApproximation = !!energy?.approximation;
  const isExcluded = energy?.excludeFromEnergyUsage === true;

  const energyReady = hasMeasurePower || hasMeterPower || hasApproximation;

  if (isExcluded) {
    console.log('  ⚠  Device is EXCLUDED from Energy tracking');
  }
  if (hasMeasurePower) {
    const pw = device.capabilitiesObj?.measure_power?.value;
    console.log(`  ✓  Has measure_power (current: ${pw ?? 'null'}W)`);
  } else {
    console.log('  ✗  Missing measure_power — Homey Energy won\'t track real-time watts');
  }
  if (hasMeterPower) {
    const meterCaps = caps.filter(c => c.startsWith('meter_power'));
    for (const mc of meterCaps) {
      const val = device.capabilitiesObj?.[mc]?.value;
      console.log(`  ✓  Has ${mc} (current: ${val ?? 'null'} kWh)`);
    }
  } else {
    console.log('  ✗  Missing meter_power — no cumulative kWh tracking');
  }
  if (hasApproximation) {
    console.log(`  ✓  Has energy.approximation: ${JSON.stringify(energy.approximation)}`);
  }

  if (!energyReady) {
    console.log('\n  ⛔ NOT included in Homey Energy — needs measure_power, meter_power, or energy.approximation');
  } else if (!isExcluded) {
    console.log('\n  ✅ Should appear in Homey Energy');
  }

  // Data/store
  printSection('Device Data (pairing identifiers)');
  if (device.data) {
    for (const [key, val] of Object.entries(device.data)) {
      console.log(`  ${pad(key, 20)} = ${JSON.stringify(val)}`);
    }
  } else {
    console.log('  (none)');
  }

  // Settings
  printSection('Settings');
  try {
    const settings = device.settings;
    if (settings && Object.keys(settings).length > 0) {
      for (const [key, val] of Object.entries(settings)) {
        console.log(`  ${pad(key, 25)} = ${JSON.stringify(val)}`);
      }
    } else {
      console.log('  (none)');
    }
  } catch {
    console.log('  (could not read settings)');
  }
}

/**
 * Energy diagnostics — find devices missing from Homey Energy
 */
async function cmdEnergy(api) {
  const devices = Object.values(await api.devices.getDevices());

  printHeader('Homey Energy Diagnostics');

  const included = [];
  const excluded = [];
  const missing = [];
  const meters = [];

  for (const d of devices) {
    const caps = d.capabilities || [];
    const energy = d.energyObj || {};
    const hasMeasurePower = caps.includes('measure_power');
    const hasMeterPower = caps.some(c => c.startsWith('meter_power'));
    const hasApproximation = !!energy.approximation;
    const isExcluded = energy.excludeFromEnergyUsage === true;

    // Detect whole-home meters
    if (d.class === 'homemeter' || (caps.includes('meter_power.imported') && caps.includes('meter_power.exported'))) {
      meters.push(d);
      continue;
    }

    const info = {
      name: d.name,
      class: d.class,
      driver: d.driverUri,
      power: d.capabilitiesObj?.measure_power?.value,
      meterPower: d.capabilitiesObj?.meter_power?.value,
      caps: caps.filter(c => c.includes('power') || c.includes('meter') || c.includes('energy')),
    };

    if (isExcluded) {
      excluded.push(info);
    } else if (hasMeasurePower || hasMeterPower || hasApproximation) {
      included.push(info);
    } else {
      // Check if this looks like it SHOULD have energy tracking
      const energyClasses = ['socket', 'light', 'heater', 'thermostat', 'fan',
        'solarpanel', 'battery', 'evcharger', 'car', 'coffeemachine',
        'kettle', 'washer', 'dryer', 'dishwasher', 'oven', 'tv',
        'amplifier', 'vacuumcleaner'];
      if (energyClasses.includes(d.class)) {
        missing.push({ ...info, reason: `class "${d.class}" typically consumes power` });
      }
    }
  }

  // Whole-home meters
  printSection(`Whole-Home Meters (${meters.length})`);
  for (const m of meters) {
    const pw = m.capabilitiesObj?.measure_power?.value;
    const imp = m.capabilitiesObj?.['meter_power.imported']?.value;
    const exp = m.capabilitiesObj?.['meter_power.exported']?.value;
    console.log(`  ${m.name}: ${pw ?? '?'}W (imported: ${imp ?? '?'} kWh, exported: ${exp ?? '?'} kWh)`);
  }

  // Included devices
  printSection(`Tracked by Energy (${included.length})`);
  included.sort((a, b) => (b.power || 0) - (a.power || 0));
  const totalTracked = included.reduce((sum, d) => sum + (d.power || 0), 0);
  for (const d of included) {
    console.log(`  ${pad(d.name, 30)} ${pad(d.class, 14)} ${d.power != null ? d.power + 'W' : 'no W'} ${d.caps.join(', ')}`);
  }
  console.log(`\n  Total tracked power: ${Math.round(totalTracked)}W`);

  // Excluded devices
  if (excluded.length > 0) {
    printSection(`Manually Excluded (${excluded.length})`);
    for (const d of excluded) {
      console.log(`  ${pad(d.name, 30)} ${pad(d.class, 14)} ${d.caps.join(', ')}`);
    }
  }

  // Missing devices — the interesting part for troubleshooting
  if (missing.length > 0) {
    printSection(`⚠  Missing from Energy (${missing.length})`);
    console.log('  These devices have energy-consuming classes but lack power capabilities:\n');
    for (const d of missing) {
      console.log(`  ${pad(d.name, 30)} ${pad(d.class, 14)} — ${d.reason}`);
      console.log(`  ${' '.repeat(30)} driver: ${d.driver}`);
      if (d.caps.length > 0) {
        console.log(`  ${' '.repeat(30)} energy-related caps: ${d.caps.join(', ')}`);
      } else {
        console.log(`  ${' '.repeat(30)} energy-related caps: NONE`);
      }
      console.log();
    }
  } else {
    printSection('✅ No obvious missing devices');
  }
}

/**
 * Show capabilities of all devices (for a specific capability filter)
 */
async function cmdCapabilities(api, args) {
  const filter = args[0]?.toLowerCase();
  const devices = Object.values(await api.devices.getDevices());

  if (!filter) {
    // Show all unique capabilities across all devices
    printHeader('All Capabilities in System');
    const capMap = new Map();
    for (const d of devices) {
      for (const cap of d.capabilities || []) {
        if (!capMap.has(cap)) capMap.set(cap, 0);
        capMap.set(cap, capMap.get(cap) + 1);
      }
    }
    const sorted = [...capMap.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cap, count] of sorted) {
      console.log(`  ${pad(cap, 35)} — ${count} device${count > 1 ? 's' : ''}`);
    }
    return;
  }

  // Show devices that have a specific capability
  printHeader(`Devices with capability: "${filter}"`);
  const matching = devices.filter(d =>
    d.capabilities?.some(c => c.toLowerCase().includes(filter))
  );

  if (matching.length === 0) {
    console.log(`  No devices have a capability matching "${filter}"`);
    return;
  }

  for (const d of matching) {
    const matchedCaps = d.capabilities.filter(c => c.toLowerCase().includes(filter));
    for (const cap of matchedCaps) {
      const obj = d.capabilitiesObj?.[cap];
      console.log(`  ${pad(d.name, 30)} ${pad(cap, 25)} = ${obj?.value ?? 'null'} ${obj?.units || ''}`);
    }
  }
}

/**
 * Show all apps and their devices
 */
async function cmdApps(api, args) {
  const devices = Object.values(await api.devices.getDevices());
  const filter = args[0]?.toLowerCase();

  // Group by driver URI (app)
  const appMap = new Map();
  for (const d of devices) {
    const appId = d.driverUri?.split(':')[1] || 'unknown';
    if (!appMap.has(appId)) appMap.set(appId, []);
    appMap.get(appId).push(d);
  }

  const apps = [...appMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const filtered = filter
    ? apps.filter(([appId]) => appId.toLowerCase().includes(filter))
    : apps;

  printHeader(`Apps & Devices${filter ? ` matching "${filter}"` : ''}`);

  for (const [appId, devs] of filtered) {
    console.log(`\n  📦 ${appId} (${devs.length} device${devs.length > 1 ? 's' : ''})`);
    for (const d of devs) {
      const caps = (d.capabilities || []).join(', ');
      console.log(`     ${pad(d.name, 25)} [${d.class}] ${d.available ? '' : '⚠ UNAVAILABLE'}`);
      console.log(`     ${' '.repeat(25)} caps: ${caps}`);
    }
  }
}

/**
 * Dump raw device JSON
 */
async function cmdRaw(api, args) {
  const search = args[0];
  if (!search) {
    console.error('Usage: homey-query raw <device-name-or-id>');
    process.exit(1);
  }

  const devices = Object.values(await api.devices.getDevices());
  const searchLower = search.toLowerCase();
  const device = devices.find(d =>
    d.id === search ||
    d.name?.toLowerCase() === searchLower ||
    d.name?.toLowerCase().includes(searchLower)
  );

  if (!device) {
    console.error(`Device not found: "${search}"`);
    process.exit(1);
  }

  console.log(JSON.stringify(device, null, 2));
}

// ─── Main ──────────────────────────────────────────────────

const COMMANDS = {
  devices: { fn: cmdDevices, desc: 'List all devices (optional filter)', usage: '[filter]' },
  inspect: { fn: cmdInspect, desc: 'Full detail for one device', usage: '<name-or-id>' },
  energy: { fn: cmdEnergy, desc: 'Energy diagnostics — find gaps', usage: '' },
  caps: { fn: cmdCapabilities, desc: 'List capabilities (optional filter)', usage: '[capability]' },
  apps: { fn: cmdApps, desc: 'List apps and their devices', usage: '[app-filter]' },
  raw: { fn: cmdRaw, desc: 'Dump raw device JSON', usage: '<name-or-id>' },
};

function showHelp() {
  console.log('\nHomey API Query Tool — troubleshoot devices, energy, capabilities\n');
  console.log('Usage: node homey-query.js [--homey <name>] <command> [args...]\n');
  console.log('Options:');
  console.log('  --homey <name>    Select Homey by name (matches homey-<name>-ip/api-key in ../.env)');
  console.log('                    Default: airaksela\n');
  console.log('Commands:');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${pad(name + ' ' + cmd.usage, 30)} ${cmd.desc}`);
  }
  console.log('\nExamples:');
  console.log('  node homey-query.js devices');
  console.log('  node homey-query.js --homey riitekatu inspect KEBA');
  console.log('  node homey-query.js --homey airaksela energy\n');
}

async function main() {
  const rawArgs = process.argv.slice(2);

  // Parse --homey flag
  let homeyName = 'airaksela';
  const args = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--homey' && rawArgs[i + 1]) {
      homeyName = rawArgs[++i];
    } else {
      args.push(rawArgs[i]);
    }
  }

  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    showHelp();
    process.exit(0);
  }

  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(`Unknown command: "${command}"`);
    showHelp();
    process.exit(1);
  }

  // Read config from env vars — support --homey name or HOMEY_IP/HOMEY_TOKEN overrides
  const ip = process.env['HOMEY_IP'] || process.env[`homey-${homeyName}-ip`];
  const token = process.env['HOMEY_TOKEN'] || process.env[`homey-${homeyName}-api-key`];

  if (!ip || !token) {
    console.error(`Error: Missing config for Homey "${homeyName}".`);
    console.error(`Set homey-${homeyName}-ip and homey-${homeyName}-api-key in ../.env`);
    process.exit(1);
  }

  console.log(`Connecting to Homey "${homeyName}" at ${ip}...`);

  try {
    const api = await HomeyAPI.createLocalAPI({
      address: `http://${ip}`,
      token,
    });
    await cmd.fn(api, args.slice(1));
  } catch (error) {
    if (error.message?.includes('Not logged in') || error.message?.includes('token')) {
      console.error('Error: Not logged in. Run "homey login" first.');
    } else {
      console.error('Error:', error.message || error);
    }
    process.exit(1);
  }
}

main();
