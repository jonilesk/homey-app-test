'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

class TuyaTS0201Driver extends ZigBeeDriver {
  onInit() {
    this.log('[Driver:tuya_ts0201] Tuya TS0201 driver initialized');
  }
}

module.exports = TuyaTS0201Driver;
