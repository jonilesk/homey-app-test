#!/usr/bin/env node
'use strict';

const { HomeyAPI } = require('homey-api');

async function main() {
  try {
    // Connect to local Homey
    const api = await HomeyAPI.forCurrentHomey();

    console.log('Fetching all devices...\n');

    const devices = await api.devices.getDevices();
    const deviceList = Object.values(devices);

    console.log(`Total devices: ${deviceList.length}\n`);

    // Filter devices with measure_power
    const powerDevices = deviceList.filter(d =>
      d.capabilities?.includes('measure_power')
    );

    console.log('=== Devices with measure_power capability ===\n');

    // Group by name pattern
    const acDevices = powerDevices.filter(d =>
      d.name?.toLowerCase().includes('ac ')
    );

    if (acDevices.length > 0) {
      console.log('--- AC Devices ---');
      acDevices.forEach(d => {
        const power = d.capabilitiesObj?.measure_power?.value;
        const excluded = d.energyObj?.excludeFromEnergyUsage;
        console.log(`  ${d.name}: ${power}W (excluded: ${excluded})`);
      });
      console.log();
    }

    // Show all power devices sorted by power
    console.log('--- All Power Devices (sorted by consumption) ---');
    powerDevices
      .map(d => ({
        name: d.name,
        power: d.capabilitiesObj?.measure_power?.value || 0,
        excluded: d.energyObj?.excludeFromEnergyUsage || false,
        class: d.class
      }))
      .sort((a, b) => b.power - a.power)
      .forEach(d => {
        const flag = d.excluded ? ' [EXCLUDED]' : '';
        console.log(`  ${d.name}: ${d.power}W (${d.class})${flag}`);
      });

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
