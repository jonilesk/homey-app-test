'use strict';

const Homey = require('homey');

class FMIWeatherApp extends Homey.App {
  async onInit() {
    this.log('FMI Weather app initialized');
  }
}

module.exports = FMIWeatherApp;
