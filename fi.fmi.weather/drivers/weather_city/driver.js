'use strict';

const Homey = require('homey');

class WeatherCityDriver extends Homey.Driver {
  async onInit() {
    this.log('WeatherCityDriver initialized');
  }

  async onPairListDevices() {
    // Return a default device for the user to add
    // City can be configured in device settings after pairing
    return [
      {
        name: 'Helsinki Weather',
        data: {
          id: `fmi-weather-${Date.now()}`,
        },
        settings: {
          city: 'Helsinki',
          pollInterval: 15,
        },
      },
    ];
  }
}

module.exports = WeatherCityDriver;
