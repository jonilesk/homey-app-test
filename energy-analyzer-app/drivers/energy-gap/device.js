'use strict';

const Homey = require('homey');

class EnergyGapDevice extends Homey.Device {

  async onInit() {
    this.log('EnergyGapDevice has been initialized');
  }

  async updateMetrics(data) {
    this.log('Updating metrics:', data);

    try {
      // Update all capability values
      await this.setCapabilityValue('power_total', data.total || 0);
      await this.setCapabilityValue('power_tracked', data.tracked || 0);
      await this.setCapabilityValue('power_untracked', data.untracked || 0);
      await this.setCapabilityValue('untracked_percentage', data.untrackedPercent || 0);
      await this.setCapabilityValue('tracked_device_count', data.deviceCount || 0);
    } catch (error) {
      this.error('Failed to update metrics:', error);
    }
  }

  async onDeleted() {
    this.log('EnergyGapDevice has been deleted');
  }

}

module.exports = EnergyGapDevice;
