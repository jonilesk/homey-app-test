'use strict';

const Homey = require('homey');
const { parseReport1 } = require('../../lib/KebaDataParser');
const { parseProductInfo } = require('../../lib/KebaDeviceInfo');

class KebaDriver extends Homey.Driver {

  async onPair(session) {
    let pairData = {};

    session.setHandler('login', async (data) => {
      const host = (data.username || '').trim();
      if (!host) {
        throw new Error('IP address is required');
      }

      // Basic IP format validation
      if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
        throw new Error('Invalid IP address format');
      }

      this.log(`[pairing] Connecting to KEBA charger at ${host}`);

      const udpClient = this.homey.app.udpClient;
      if (!udpClient) {
        throw new Error('UDP client not available. Please restart the app.');
      }

      // Send report 1 to get device info
      let report1Raw;
      try {
        report1Raw = await udpClient.sendAndWait(host, 'report 1', { timeout: 5000 });
      } catch (err) {
        throw new Error(`Could not connect to KEBA charger at ${host}: ${err.message}`);
      }

      let report1Json;
      try {
        report1Json = JSON.parse(report1Raw);
      } catch (err) {
        throw new Error(`Device at ${host} is not a KEBA KeContact charger (invalid response)`);
      }

      // Validate it's a KEBA report 1
      if (!report1Json.ID || parseInt(report1Json.ID, 10) !== 1 || !report1Json.Product) {
        throw new Error(`Device at ${host} is not a KEBA KeContact charger`);
      }

      const report1 = parseReport1(report1Json);
      const info = parseProductInfo(report1);

      this.log(`[pairing] Found ${info.manufacturer} ${info.model} (serial: ${info.serial})`);

      pairData = { host, info };
      return true;
    });

    session.setHandler('list_devices', async () => {
      const { host, info } = pairData;

      return [{
        name: `KEBA ${info.model} (${host})`,
        data: {
          id: `keba_${info.serial}`,
        },
        store: {
          host,
          serial: info.serial,
          product: info.product,
          firmware: info.firmware,
          manufacturer: info.manufacturer,
          model: info.model,
          meterIntegrated: info.meterIntegrated,
          displayAvailable: info.displayAvailable,
          authAvailable: info.authAvailable,
          dataLogger: info.dataLogger,
          phaseSwitch: info.phaseSwitch,
        },
        settings: {
          host,
          poll_interval: 30,
        },
      }];
    });
  }

}

module.exports = KebaDriver;
