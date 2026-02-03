'use strict';

class EnergyAnalyzer {
  constructor(homey, homeyApi) {
    this.homey = homey;
    this.homeyApi = homeyApi;
  }

  async analyze() {
    this.homey.app.log('[EnergyAnalyzer] Starting analysis...');

    // Get ALL devices via Web API
    let systemDevices = [];
    try {
      const devicesObj = await this.homeyApi.devices.getDevices();
      systemDevices = Object.values(devicesObj);
      this.homey.app.log(`[EnergyAnalyzer] Found ${systemDevices.length} devices in Homey system`);

      // Debug: Show sample of first 5 devices (only on first run)
      if (!this._hasLoggedSample) {
        const sample = systemDevices.slice(0, 5).map(d => ({
          id: d.id,
          name: d.name,
          class: d.class,
          driverUri: d.driverUri,
          hasMeasurePower: d.capabilities?.includes('measure_power'),
          measurePowerValue: d.capabilitiesObj?.measure_power?.value
        }));
        this.homey.app.log('[DEBUG] Sample devices:', JSON.stringify(sample, null, 2));
        this._hasLoggedSample = true;
      }
    } catch (error) {
      this.homey.app.error('[EnergyAnalyzer] Failed to get devices:', error);
      return {
        total: 0,
        tracked: 0,
        untracked: 0,
        untrackedPercent: 0,
        deviceCount: 0,
        devices: []
      };
    }

    let totalHome = 0;
    let trackedSum = 0;
    const deviceBreakdown = [];

    for (const device of systemDevices) {
      // Skip our own virtual device
      if (device.driverId === 'energy-gap') {
        continue;
      }

      // Skip devices excluded from Energy tracking
      if (device.energyObj?.excludeFromEnergyUsage === true) {
        this.homey.app.log(`[EnergyAnalyzer] Skipping ${device.name} (excluded from Energy)`);
        continue;
      }

      const power = device.capabilitiesObj?.measure_power?.value;
      const deviceName = device.name || 'Unknown';
      const deviceClass = device.class || 'unknown';

      if (this.isEnergyDongle(device)) {
        this.homey.app.log(`[EnergyAnalyzer] ✓ Found Energy Dongle: ${deviceName} with ${power}W`);
        totalHome = power || 0;
      } else if (power != null && power > 0) {
        // Regular device reporting power
        trackedSum += power;
        deviceBreakdown.push({
          id: device.id,
          name: deviceName,
          class: deviceClass,
          power: power
        });
      } else if (device.capabilities?.includes('measure_power')) {
        // Device has measure_power but value is null/0 - log for debugging
        this.homey.app.log(`[DEBUG] Device "${deviceName}" has measure_power but power=${power}`);
      }
    }

    const untracked = Math.max(0, totalHome - trackedSum);
    const untrackedPercent = totalHome > 0
      ? Math.round((untracked / totalHome) * 100)
      : 0;

    // Log device breakdown
    this.homey.app.log(`[EnergyAnalyzer] === Device Breakdown ===`);
    deviceBreakdown.sort((a, b) => b.power - a.power).forEach(d => {
      this.homey.app.log(`  - ${d.name}: ${d.power}W (${d.class})`);
    });
    this.homey.app.log(`[EnergyAnalyzer] Total tracked devices: ${deviceBreakdown.length}`);

    return {
      total: totalHome,
      tracked: trackedSum,
      untracked: untracked,
      untrackedPercent: untrackedPercent,
      deviceCount: deviceBreakdown.length,
      devices: deviceBreakdown.sort((a, b) => b.power - a.power)
    };
  }

  isEnergyDongle(device) {
    // Use stronger signals than just name matching
    const deviceClass = device.class || '';
    const deviceName = (device.name || '').toLowerCase();
    const capabilities = device.capabilities || [];

    // Check for homemeter class
    const isHomemeter = deviceClass === 'homemeter';

    // Check for import/export capabilities (typical for energy meters)
    const hasImportExport = capabilities.includes('meter_power.imported') ||
                            capabilities.includes('meter_power.exported');

    // Check if it has measure_power (required for total consumption)
    const hasMeasurePower = capabilities.includes('measure_power');

    // Fallback to name patterns
    const nameHint = deviceName.includes('energy dongle') ||
                     deviceName.includes('p1') ||
                     deviceName.includes('smart meter') ||
                     deviceName.includes('energy');

    // Prefer class + capabilities, fallback to name
    return (isHomemeter && hasMeasurePower) ||
           (hasImportExport && hasMeasurePower) ||
           (nameHint && hasMeasurePower);
  }
}

module.exports = EnergyAnalyzer;
