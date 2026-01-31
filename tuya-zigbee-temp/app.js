'use strict';

const Homey = require('homey');

class TuyaZigbeeTempApp extends Homey.App {
  async onInit() {
    this.log('Tuya Zigbee Temperature app initialized');
  }
}

module.exports = TuyaZigbeeTempApp;
