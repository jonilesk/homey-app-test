'use strict';

const Homey = require('homey');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const SolarmanApi = require('../../lib/SolarmanApi');
const ParameterParser = require('../../lib/ParameterParser');

// Polling intervals
const POLL_INTERVAL_NORMAL = 60 * 1000;   // 60 seconds default, overridable via settings
const POLL_INTERVAL_QUICK = 15 * 1000;    // 15 seconds after change
const QUICK_POLL_COUNT = 3;               // Number of quick polls
const MIN_POLL_INTERVAL = 15 * 1000;      // Floor for user-configured interval
const POLL_INTERVAL_SLEEP = 5 * 60 * 1000; // 5 minutes when inverter is sleeping

// Instantaneous capabilities that should be zeroed when inverter sleeps at night
const SLEEP_ZERO_CAPABILITIES = [
  'measure_power', 'measure_power.pv1', 'measure_power.pv2',
  'measure_power.output', 'measure_power.grid', 'measure_power.load',
  'measure_power.battery',
  'measure_current.pv1', 'measure_current.pv2',
  'measure_current.l1', 'measure_current.l2', 'measure_current.l3',
];

// Map YAML parameter names → Homey capability IDs (null = skip)
const CAPABILITY_MAP = {
  // --- Sofar LSW3 profile names ---
  'PV1 Power': 'measure_power.pv1',
  'PV2 Power': 'measure_power.pv2',
  'PV1 Voltage': 'measure_voltage.pv1',
  'PV2 Voltage': 'measure_voltage.pv2',
  'PV1 Current': 'measure_current.pv1',
  'PV2 Current': 'measure_current.pv2',
  'Daily Production': 'meter_power.daily_production',
  'Total Production': 'meter_power.total_production',
  'Output active power': 'measure_power.output',
  'Output reactive power': null,
  'Grid frequency': 'solarman_grid_frequency',
  'L1 Voltage': 'measure_voltage.l1',
  'L1 Current': 'measure_current.l1',
  'L2 Voltage': 'measure_voltage.l2',
  'L2 Current': 'measure_current.l2',
  'L3 Voltage': 'measure_voltage.l3',
  'L3 Current': 'measure_current.l3',
  'Inverter module temperature': 'measure_temperature.module',
  'Inverter inner temperature': 'measure_temperature.inner',
  'Country': 'solarman_country',

  // --- Sofar G3 / HYD profile names ---
  'Grid Frequency': 'solarman_grid_frequency',
  'ActivePower_Output_Total': 'measure_power.output',
  'Voltage_Phase_R': 'measure_voltage.l1',
  'Current_Output_R': 'measure_current.l1',
  'Voltage_Phase_S': 'measure_voltage.l2',
  'Current_Output_S': 'measure_current.l2',
  'Voltage_Phase_T': 'measure_voltage.l3',
  'Current_Output_T': 'measure_current.l3',
  'Ambient temperature 1': 'measure_temperature.module',
  'Radiator temperature 1': 'measure_temperature.inner',
  'Daily PV Generation': 'meter_power.daily_production',
  'Total PV Generation': 'meter_power.total_production',
  'ActivePower_PCC_Total': 'measure_power.grid',
  'ActivePower_Load_Sys': 'measure_power.load',

  // --- Battery (G3 HYD / Deye hybrid names) ---
  'Battery 1 Power': 'measure_power.battery',
  'Battery 1 SOC': 'measure_battery',
  'Battery 1 Voltage': 'measure_voltage.battery',
  'Battery 1 Temperature': 'measure_temperature.battery',
  'Battery Power': 'measure_power.battery',
  'Battery SOC': 'measure_battery',
  'Battery Voltage': 'measure_voltage.battery',
  'Battery Temperature': 'measure_temperature.battery',
  'Battery Status': 'solarman_battery_status',

  // --- Grid / energy (shared across profiles) ---
  'Total Grid Power': 'measure_power.grid',
  'Total Load Power': 'measure_power.load',
  'Daily Energy Bought': 'meter_power.daily_bought',
  'Total Energy Bought': 'meter_power.total_bought',
  'Daily Energy Sold': 'meter_power.daily_sold',
  'Total Energy Sold': 'meter_power.total_sold',
  'Work Mode': 'solarman_work_mode',

  // --- Common across all profiles ---
  'Inverter status': 'solarman_inverter_status',
  'Fault 1': 'solarman_fault_1',
  'Fault 2': 'solarman_fault_2',
  'Fault 3': 'solarman_fault_3',
  'Fault 4': 'solarman_fault_4',
  'Fault 5': 'solarman_fault_5',
};

// Inverter status enum → Homey enum ID (covers LSW3 + G3 + Deye status values)
const STATUS_ENUM = {
  'Stand-by': 'standby',
  'Self-checking': 'selfcheck',
  'Normal': 'normal',
  'FAULT': 'fault',
  'Permanent': 'permanent',
  'waiting': 'standby',
  'detection': 'selfcheck',
  'grid-connected': 'normal',
  'emergency power supply': 'normal',
  'recoverable fault': 'fault',
  'permanent fault': 'permanent',
  'upgrade': 'standby',
  'self-charging': 'normal',
};

class InverterDevice extends Homey.Device {

  async onInit() {
    this.log('InverterDevice initializing');

    // Initialize trigger tracking state
    this._lastPower = undefined;
    this._lastStatus = undefined;
    this._lastFault1 = undefined;
    this._lastFault2 = undefined;
    this._lastFault3 = undefined;
    this._lastFault4 = undefined;
    this._lastFault5 = undefined;

    // Night-sleep tracking: once we've had a successful poll, connection
    // failures are treated as the inverter sleeping (not a real error).
    // If the device already has cumulative data from a previous session,
    // assume it was connected before (survives app restarts at night).
    this._everConnected = this.getCapabilityValue('meter_power') != null
      || this.getCapabilityValue('meter_power.total_production') != null;
    this._sleeping = false;
    if (this._everConnected) {
      this.log('Device has previous data — treating connection failures as sleep');
    }

    // Load inverter YAML definition
    this._loadDefinition();

    // Ensure capabilities match the current profile (migration support)
    await this._ensureCapabilities();

    // Create Modbus-over-Solarman API client
    this._createApiClient();

    // Start polling with jitter (0-30s) to avoid thundering herd
    const jitter = Math.random() * 30000;
    this.log(`Starting polling with ${Math.round(jitter / 1000)}s jitter`);

    this.pollTimeout = this.homey.setTimeout(async () => {
      await this.poll();

      const interval = Math.max(
        (this.getSetting('poll_interval') || (POLL_INTERVAL_NORMAL / 1000)) * 1000,
        MIN_POLL_INTERVAL,
      );
      this.pollInterval = this.homey.setInterval(
        () => this.poll(),
        interval,
      );
    }, jitter);
  }

  /**
   * Load the YAML inverter definition that describes Modbus registers and parameters.
   * @param {string} [overrideFile] - Optional filename override (used during onSettings before settings are committed)
   */
  _loadDefinition(overrideFile) {
    const lookupFile = overrideFile
      || this.getSetting('lookup_file')
      || this.getStoreValue('lookup')
      || 'sofar_lsw3.yaml';
    const defsPath = path.join(__dirname, '..', '..', 'inverter_definitions', lookupFile);

    try {
      const content = fs.readFileSync(defsPath, 'utf8');
      this._definition = yaml.load(content);
      this.log(`Loaded inverter definition: ${lookupFile}`);
    } catch (error) {
      this.error(`Failed to load definition ${lookupFile}:`, error.message);
      this._definition = null;
    }
  }

  /**
   * Instantiate (or re-create) the SolarmanApi TCP client from current settings/store.
   */
  _createApiClient() {
    const host = this.getSetting('inverter_host') || this.getStoreValue('host');
    const port = this.getSetting('inverter_port') || this.getStoreValue('port') || 8899;
    const serial = this.getSetting('inverter_serial') || this.getStoreValue('serial');
    const slaveid = this.getSetting('inverter_mb_slaveid') || this.getStoreValue('slaveid') || 1;

    this._api = new SolarmanApi({
      host,
      port,
      serial,
      mbSlaveId: slaveid,
      timeout: 15000,
      autoReconnect: true,
      logger: {
        log: (...args) => this.log('[API]', ...args),
        error: (...args) => this.error('[API]', ...args),
      },
    });
  }

  /**
   * Dynamically add/remove capabilities to match the loaded YAML profile.
   * Supports migration: users who paired on an older profile get new caps without re-pairing.
   */
  async _ensureCapabilities() {
    if (!this._definition) return;

    const neededCaps = new Set();

    for (const group of this._definition.parameters) {
      for (const item of group.items) {
        const cap = CAPABILITY_MAP[item.name];
        if (cap) {
          neededCaps.add(cap);
        }
      }
    }

    // Primary capabilities derived from sub-capabilities
    if (neededCaps.has('measure_power.output')) neededCaps.add('measure_power');
    if (neededCaps.has('meter_power.total_production')) neededCaps.add('meter_power');
    if (neededCaps.has('measure_temperature.module')) neededCaps.add('measure_temperature');

    // Add missing capabilities
    for (const cap of neededCaps) {
      if (!this.hasCapability(cap)) {
        this.log(`Adding missing capability: ${cap}`);
        await this.addCapability(cap).catch(err =>
          this.error(`Failed to add capability ${cap}:`, err));
      }
    }

    this._neededCapabilities = neededCaps;
  }

  /**
   * Poll all Modbus register ranges, parse values, and update Homey capabilities.
   */
  async poll() {
    if (!this._definition) {
      this.error('[poll] No definition loaded');
      return;
    }

    // Connect first — connection failures are handled differently depending
    // on whether the inverter has been seen before (night-sleep vs real fault)
    try {
      await this._api.connect();
      // If we were sleeping and just reconnected, resume normal polling
      if (this._sleeping) {
        this.log('[poll] Inverter woke up — resuming normal operation');
        this._sleeping = false;
        this._restartPolling();
      }
    } catch (error) {
      this.error('[poll] Connection failed:', error.message);
      await this._api.disconnect().catch(() => {});

      if (this._everConnected) {
        // Inverter was reachable before → treat as night-sleep
        this._handleSleep();
      } else {
        // Never connected successfully → real configuration / network error
        if (this.getAvailable()) {
          await this.setUnavailable(`Connection failed: ${error.message}`);
        }
      }
      return;
    }

    const parser = new ParameterParser(this._definition);
    let successCount = 0;
    let failCount = 0;

    // Read each register range independently — skip ranges that fail
    for (const request of this._definition.requests) {
      const start = request.start;
      const end = request.end;
      const length = end - start + 1;
      const mbFc = request.mb_functioncode;

      try {
        let rawData;
        if (mbFc === 3) {
          rawData = await this._api.readHoldingRegisters(start, length);
        } else if (mbFc === 4) {
          rawData = await this._api.readInputRegisters(start, length);
        } else {
          this.log(`[poll] Skipping unsupported function code: ${mbFc}`);
          continue;
        }

        parser.parse(rawData, start, length);
        successCount++;
      } catch (error) {
        failCount++;
        const msg = String(error.message || '');
        const isModbusError = /illegal data|illegal function|modbus|crc/i.test(msg);

        if (isModbusError) {
          // Modbus-level error: logger is reachable but this register range is
          // unsupported by the inverter. Log once and continue to next range.
          this.log(`[poll] Register range 0x${start.toString(16)}-0x${end.toString(16)} (FC${mbFc}) skipped: ${msg}`);
        } else {
          // Connection-level error (timeout, socket closed, etc.)
          this.error(`[poll] Connection error reading registers: ${msg}`);
          await this._api.disconnect().catch(() => {});
          if (this._everConnected) {
            this._handleSleep();
          } else if (this.getAvailable()) {
            await this.setUnavailable(msg);
          }
          return;
        }
      }
    }

    if (successCount === 0 && failCount > 0) {
      // All register ranges failed with Modbus errors — logger reachable but
      // inverter CPU is off (sleeping at night) or wrong profile
      this.log(`[poll] All ${failCount} register range(s) failed — inverter may be sleeping`);
      if (this._everConnected) {
        this._handleSleep();
      }
      return;
    }

    try {
      const values = parser.getResult();

      // Map parsed values to capabilities
      for (const [paramName, value] of Object.entries(values)) {
        const capability = CAPABILITY_MAP[paramName];
        if (!capability) continue;

        if (capability === 'solarman_inverter_status') {
          const enumVal = STATUS_ENUM[value];
          if (enumVal) {
            this._updateCapability(capability, enumVal);
          } else {
            this.log(`[poll] Unknown inverter status value: ${value}, skipping enum update`);
          }
        } else {
          this._updateCapability(capability, value);
        }
      }

      // Set primary capabilities from sub-capabilities (support both LSW3 and G3 names)
      const outputPower = values['Output active power'] ?? values['ActivePower_Output_Total'];
      if (outputPower !== undefined) {
        this._updateCapability('measure_power', outputPower);
      }
      const totalProd = values['Total Production'] ?? values['Total PV Generation'];
      if (totalProd !== undefined) {
        this._updateCapability('meter_power', totalProd);
      }
      const moduleTemp = values['Inverter module temperature'] ?? values['Ambient temperature 1'];
      if (moduleTemp !== undefined) {
        this._updateCapability('measure_temperature', moduleTemp);
      }

      // Fire flow triggers for changed values
      this._fireTriggers(values);

      // Successful poll — mark that we have connected at least once
      this._everConnected = true;

      // Mark available if it was unavailable
      if (!this.getAvailable()) {
        await this.setAvailable();
        this.log('[poll] Device is available again');
      }
    } catch (error) {
      this.error('[poll] Parse error:', error.message);
    }
  }

  /**
   * Update capability value only when it has actually changed.
   */
  _updateCapability(name, value) {
    if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
      this.setCapabilityValue(name, value)
        .catch(err => this.error(`Failed to set ${name}:`, err));
    }
  }

  /**
   * Fire flow triggers when polled values change.
   */
  _fireTriggers(values) {
    // Solar production changed (support both LSW3 and G3 parameter names)
    const power = values['Output active power'] ?? values['ActivePower_Output_Total'];
    if (power !== undefined && power !== this._lastPower) {
      this._lastPower = power;
      this.homey.flow.getDeviceTriggerCard('solar_production_changed')
        .trigger(this, { power })
        .catch(err => this.error('[trigger] solar_production_changed:', err));
    }

    // Inverter status changed
    const statusRaw = values['Inverter status'];
    if (statusRaw !== undefined && statusRaw !== this._lastStatus) {
      this._lastStatus = statusRaw;
      const statusStr = typeof statusRaw === 'string' ? statusRaw : String(statusRaw);
      this.homey.flow.getDeviceTriggerCard('inverter_status_changed')
        .trigger(this, { status: statusStr })
        .catch(err => this.error('[trigger] inverter_status_changed:', err));
    }

    // Fault detection
    for (let i = 1; i <= 5; i++) {
      const faultName = `Fault ${i}`;
      const faultValue = values[faultName];
      if (faultValue !== undefined && faultValue !== 'No error') {
        const prevKey = `_lastFault${i}`;
        if (faultValue !== this[prevKey]) {
          this[prevKey] = faultValue;
          this.homey.flow.getDeviceTriggerCard('inverter_fault')
            .trigger(this, { fault_code: faultName, fault_text: String(faultValue) })
            .catch(err => this.error('[trigger] inverter_fault:', err));
        }
      } else if (faultValue === 'No error') {
        // Reset tracking so the trigger fires again if the same fault recurs
        this[`_lastFault${i}`] = 'No error';
      }
    }
  }

  /**
   * Handle the inverter being unreachable after a previous successful connection.
   * Zeroes instantaneous power/current, sets status to standby, and keeps
   * the device available so the user still sees last cumulative values
   * (daily/total production, battery SOC, temperatures, etc.).
   */
  _handleSleep() {
    if (!this._sleeping) {
      this.log('[poll] Inverter appears to be sleeping — zeroing power, keeping last values');
      this._sleeping = true;

      // Zero out instantaneous power & current readings
      for (const cap of SLEEP_ZERO_CAPABILITIES) {
        this._updateCapability(cap, 0);
      }

      // Set inverter status to standby
      this._updateCapability('solarman_inverter_status', 'standby');

      // Slow down polling while sleeping
      this._restartPolling(POLL_INTERVAL_SLEEP);
    }

    // Keep the device available — user sees last known cumulative values
    if (!this.getAvailable()) {
      this.setAvailable().catch(err => this.error('[sleep] Failed to set available:', err));
    }
  }

  /**
   * Handle device settings changes from the Homey UI.
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    const connectionKeys = ['inverter_host', 'inverter_port', 'inverter_serial', 'inverter_mb_slaveid'];
    const needsReconnect = changedKeys.some(k => connectionKeys.includes(k));

    if (changedKeys.includes('lookup_file')) {
      this._loadDefinition(newSettings.lookup_file);
      await this._ensureCapabilities();
    }

    if (needsReconnect) {
      await this._api.disconnect().catch(() => {});
      this._createApiClient();
    }

    if (changedKeys.includes('poll_interval')) {
      this._restartPolling();
    }

    // Quick poll to verify new settings
    this._scheduleQuickPoll();
  }

  /**
   * Restart the normal polling interval (e.g. after poll_interval setting changes).
   * @param {number} [overrideInterval] - Optional interval in ms (used for sleep mode)
   */
  _restartPolling(overrideInterval) {
    if (this.pollTimeout) {
      this.homey.clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    const interval = overrideInterval || Math.max(
      (this.getSetting('poll_interval') || (POLL_INTERVAL_NORMAL / 1000)) * 1000,
      MIN_POLL_INTERVAL,
    );

    this.log(`[poll] Polling interval set to ${interval / 1000}s`);
    this.pollInterval = this.homey.setInterval(
      () => this.poll(),
      interval,
    );
  }

  /**
   * Schedule quick polling after a user-initiated change.
   */
  _scheduleQuickPoll() {
    this.quickPollsRemaining = QUICK_POLL_COUNT;

    if (!this.quickPollTimer) {
      this.log(`Starting quick poll (${POLL_INTERVAL_QUICK / 1000}s interval, ${QUICK_POLL_COUNT} times)`);

      this.quickPollTimer = this.homey.setInterval(() => {
        this.poll();
        this.quickPollsRemaining--;

        if (this.quickPollsRemaining <= 0) {
          this.log('Quick poll complete, returning to normal interval');
          this.homey.clearInterval(this.quickPollTimer);
          this.quickPollTimer = null;
        }
      }, POLL_INTERVAL_QUICK);
    }
  }

  /**
   * Clean up all timers and connections when the device is disabled or removed.
   */
  async onUninit() {
    this.log('Device uninitializing');

    if (this.pollTimeout) {
      this.homey.clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.quickPollTimer) {
      this.homey.clearInterval(this.quickPollTimer);
      this.quickPollTimer = null;
    }

    if (this._api) {
      await this._api.disconnect().catch(() => {});
    }
  }

  async onDeleted() {
    this.log('Device deleted');
  }

}

module.exports = InverterDevice;
