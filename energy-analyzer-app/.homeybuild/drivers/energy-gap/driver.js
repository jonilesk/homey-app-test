'use strict';

const Homey = require('homey');

class EnergyGapDriver extends Homey.Driver {

  async onInit() {
    this.log('EnergyGapDriver has been initialized');
  }

  async onPairListDevices() {
    this.log('Pairing: listing devices');

    // Check if device already exists
    const existingDevices = this.getDevices();
    if (existingDevices.length > 0) {
      this.log('Device already exists, returning empty list');
      return [];
    }

    // Return a single virtual device
    return [
      {
        name: 'Energy Gap Analyzer',
        data: {
          id: 'energy-gap-analyzer-singleton'
        }
      }
    ];
  }

}

module.exports = EnergyGapDriver;
