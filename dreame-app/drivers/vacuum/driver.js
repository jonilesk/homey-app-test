'use strict';

const Homey = require('homey');

class DreameVacuumDriver extends Homey.Driver {

  async onInit() {
    this.log('[driver:vacuum] initialized');
  }

  /**
   * Pairing flow.
   * Steps: login_credentials → list_devices → add_devices
   */
  async onPair(session) {
    let username = '';
    let password = '';

    // Step 1: Login credentials
    session.setHandler('login', async (data) => {
      this.log('[driver:vacuum] pairing: login attempt');
      username = data.username;
      password = data.password;

      if (!username || !password) {
        throw new Error(this.homey.__('pair.error.missing_credentials'));
      }

      try {
        await this.homey.app.dreameCloud.login(username, password);
        this.log('[driver:vacuum] pairing: login successful');
        return true;
      } catch (err) {
        this.error('[driver:vacuum] pairing: login failed:', err.message);
        throw new Error(err.message);
      }
    });

    // Step 2: List devices
    session.setHandler('list_devices', async () => {
      this.log('[driver:vacuum] pairing: listing devices');

      try {
        const devices = await this.homey.app.dreameCloud.getDevices();
        this.log(`[driver:vacuum] pairing: found ${devices.length} Dreame vacuum(s)`);

        if (devices.length === 0) {
          throw new Error(this.homey.__('pair.error.no_devices'));
        }

        return devices.map(device => ({
          name: device.name || `Dreame ${device.model}`,
          data: {
            id: String(device.did),
            mac: device.mac,
            model: device.model,
          },
          store: {
            bindDomain: device.bindDomain,
            uid: this.homey.app.dreameCloud._uid,
          },
        }));
      } catch (err) {
        this.error('[driver:vacuum] pairing: list devices failed:', err.message);
        throw new Error(err.message);
      }
    });
  }
}

module.exports = DreameVacuumDriver;
