'use strict';

const Homey = require('homey');
const path = require('path');
const fs = require('fs');
const SolarmanApi = require('../../lib/SolarmanApi');

class InverterDriver extends Homey.Driver {

  async onInit() {
    this.log('InverterDriver has been initialized');
  }

  async onPair(session) {
    this.log('[PAIR] Pairing session started');

    let pairData = {};

    const validateAndConnect = async (data) => {
      // login_credentials template sends username/password.
      // Keep host/serial as fallback for compatibility with custom views.
      this.log('[PAIR] Login payload received');

      const host = (data.username || data.host || '').trim();
      const serialRaw = (data.password || data.serial || '').toString().trim();

      const serial = Number.parseInt(serialRaw, 10);
      if (!host) {
        throw new Error('Host is required');
      }
      if (!Number.isFinite(serial)) {
        throw new Error('Serial must be a valid number');
      }

      pairData = {
        host,
        serial,
        port: Number.parseInt(data.port, 10) || 8899,
        slaveid: Number.parseInt(data.slaveid, 10) || 1,
        lookup: data.lookup || 'sofar_lsw3.yaml',
      };

      // Test connection
      const api = new SolarmanApi({
        host: pairData.host,
        port: pairData.port,
        serial: pairData.serial,
        mbSlaveId: pairData.slaveid,
        timeout: 10000,
        autoReconnect: false,
      });

      try {
        await api.connect();

        // Probe a few common Modbus read patterns. Different inverter families
        // expose different register maps/function codes, so a single fixed read
        // can falsely fail pairing even when the logger is reachable.
        const probes = [
          () => api.readHoldingRegisters(0, 1),
          () => api.readInputRegisters(0, 1),
          () => api.readHoldingRegisters(1, 1),
          () => api.readInputRegisters(1, 1),
        ];

        let onlyIllegalAddressErrors = false;
        let lastError = null;

        for (const probe of probes) {
          try {
            await probe();
            await api.disconnect();
            this.log('[PAIR] Connection test successful');
            return true;
          } catch (error) {
            lastError = error;
            const msg = String(error.message || '');
            const isIllegalAddress = /illegal data address|code=0x2|FC=0x10/i.test(msg);
            if (isIllegalAddress) {
              onlyIllegalAddressErrors = true;
              continue;
            }
            throw error;
          }
        }

        if (onlyIllegalAddressErrors) {
          this.log('[PAIR] Logger reachable but probe registers not valid for this inverter profile; allowing pairing');
          await api.disconnect();
          return true;
        }

        throw lastError || new Error('No valid response from inverter');
      } catch (error) {
        this.log('[PAIR] Connection test failed:', error.message);
        await api.disconnect().catch(() => {});
        throw new Error(`Connection failed: ${error.message}`);
      }
    };

    // login_credentials expects this handler name.
    session.setHandler('login', validateAndConnect);
    // Backward compatibility if this view id is emitted directly.
    session.setHandler('configure', validateAndConnect);

    // Handle device listing (return the configured device)
    session.setHandler('list_devices', async () => {
      this.log('[PAIR] Listing devices with config:', JSON.stringify(pairData));

      return [{
        name: `Solarman Inverter (${pairData.host})`,
        data: {
          id: `solarman_${pairData.serial}`,
        },
        store: {
          host: pairData.host,
          port: pairData.port,
          serial: pairData.serial,
          slaveid: pairData.slaveid,
          lookup: pairData.lookup,
        },
        settings: {
          inverter_host: pairData.host,
          inverter_port: pairData.port,
          inverter_serial: pairData.serial,
          inverter_mb_slaveid: pairData.slaveid,
          lookup_file: pairData.lookup,
          poll_interval: 60,
        },
      }];
    });
  }

  // Get list of available inverter definition files
  getAvailableLookupFiles() {
    const defsDir = path.join(__dirname, '..', '..', 'inverter_definitions');
    try {
      return fs.readdirSync(defsDir)
        .filter(f => f.endsWith('.yaml'))
        .sort();
    } catch {
      return ['sofar_lsw3.yaml'];
    }
  }

}

module.exports = InverterDriver;
