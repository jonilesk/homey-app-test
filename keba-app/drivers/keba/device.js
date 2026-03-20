'use strict';

const Homey = require('homey');
const { parseReport2, parseReport3, getResponseType, validateCurrent } = require('../../lib/KebaDataParser');

const POLL_INTERVAL_NORMAL = 30 * 1000;
const POLL_INTERVAL_QUICK = 15 * 1000;
const QUICK_POLL_COUNT = 3;
const MIN_POLL_INTERVAL = 10 * 1000;
const MAX_CONSECUTIVE_FAILURES = 5;
const COMMAND_TIMEOUT = 5000;

class KebaDevice extends Homey.Device {

  async onInit() {
    this._udpClient = this.homey.app.udpClient;
    this._host = this.getSetting('host');
    this._meterIntegrated = this.getStoreValue('meterIntegrated');
    this._consecutiveFailures = 0;
    this._lastChargingState = null;
    this._lastPlugState = null;
    this._lastPlugEV = null;
    this._lastStateOn = null;

    await this._ensureCapabilities();
    this._registerCapabilityListeners();

    // Register with UDP client for routed messages
    if (this._udpClient) {
      this._udpClient.registerDevice(this._host, (msg) => this._handleMessage(msg));
    }

    // Start polling with jitter (0–30s random delay)
    const jitter = Math.random() * 30000;
    this.pollTimeout = this.homey.setTimeout(async () => {
      await this.poll();
      const interval = this._getPollInterval();
      this.pollInterval = this.homey.setInterval(() => this.poll(), interval);
    }, jitter);

    this.log(`[device:${this._host}] Initialized (meter: ${this._meterIntegrated}, jitter: ${Math.round(jitter)}ms)`);
  }

  async _ensureCapabilities() {
    // Base capabilities are in driver.compose.json: onoff, keba_charging_state, keba_cable_state, keba_current_limit, keba_max_current

    // Dynamic capabilities based on model features
    if (this._meterIntegrated) {
      const meterCaps = [
        'measure_power',
        'meter_power',
        'meter_power.session',
        'measure_current.phase1',
        'measure_current.phase2',
        'measure_current.phase3',
        'measure_voltage.phase1',
        'measure_voltage.phase2',
        'measure_voltage.phase3',
        'keba_power_factor',
      ];
      for (const cap of meterCaps) {
        if (!this.hasCapability(cap)) {
          await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
        }
      }
    }
  }

  _registerCapabilityListeners() {
    // onoff → enable/disable charging
    this.registerCapabilityListener('onoff', async (value) => {
      if (value) {
        await this.enableCharging();
      } else {
        await this.disableCharging();
      }
    });

    // keba_current_limit → set charging current
    this.registerCapabilityListener('keba_current_limit', async (value) => {
      await this.setChargingCurrent(value);
    });
  }

  _getPollInterval() {
    const settingInterval = (this.getSetting('poll_interval') || 30) * 1000;
    return Math.max(settingInterval, MIN_POLL_INTERVAL);
  }

  async poll() {
    if (!this._udpClient) {
      this.error('[poll] UDP client not available');
      return;
    }

    try {
      // Report 2 — charging status
      const report2Raw = await this._udpClient.sendAndWait(this._host, 'report 2', { timeout: COMMAND_TIMEOUT });
      const report2Json = JSON.parse(report2Raw);
      const report2 = parseReport2(report2Json);
      this._processReport2(report2);

      // Report 3 — metering data (only if meter available)
      if (this._meterIntegrated) {
        try {
          const report3Raw = await this._udpClient.sendAndWait(this._host, 'report 3', { timeout: COMMAND_TIMEOUT });
          const report3Json = JSON.parse(report3Raw);
          const report3 = parseReport3(report3Json);
          this._processReport3(report3);
        } catch (err) {
          this.error(`[poll] Report 3 failed: ${err.message}`);
        }
      }

      // Reset failure count on success
      this._consecutiveFailures = 0;
      if (!this.getAvailable()) {
        await this.setAvailable();
        this.log(`[poll] Device back online at ${this._host}`);
      }
    } catch (err) {
      this._consecutiveFailures++;
      this.error(`[poll] Failed (${this._consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`);

      if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && this.getAvailable()) {
        await this.setUnavailable('Charger not responding');
      }
    }
  }

  _processReport2(data) {
    // Update capabilities
    this._updateCapability('keba_charging_state', data.stateDetail);
    this._updateCapability('keba_cable_state', data.plugDetail);
    this._updateCapability('keba_current_limit', data.currUser);
    this._updateCapability('keba_max_current', data.maxCurr);
    this._updateCapability('onoff', data.enableSys === 1);

    // Fire triggers on state transitions
    this._fireStateTransitionTriggers(data);

    // Update tracking state
    this._lastChargingState = data.stateDetail;
    this._lastPlugState = data.plugDetail;
    this._lastPlugEV = data.plugEV;
    this._lastStateOn = data.stateOn;
  }

  _processReport3(data) {
    this._updateCapability('measure_power', data.power);
    this._updateCapability('meter_power', data.energyTotal);
    this._updateCapability('meter_power.session', data.energySession);
    this._updateCapability('measure_current.phase1', data.i1);
    this._updateCapability('measure_current.phase2', data.i2);
    this._updateCapability('measure_current.phase3', data.i3);
    this._updateCapability('measure_voltage.phase1', data.u1);
    this._updateCapability('measure_voltage.phase2', data.u2);
    this._updateCapability('measure_voltage.phase3', data.u3);
    this._updateCapability('keba_power_factor', data.powerFactor);
  }

  _fireStateTransitionTriggers(data) {
    const app = this.homey.app;

    // Charging started: stateOn false → true
    if (data.stateOn && this._lastStateOn === false) {
      const power = this.getCapabilityValue('measure_power') || 0;
      app._chargingStartedTrigger.trigger(this, { power })
        .catch(err => this.error('[trigger] charging_started:', err));
    }

    // Charging stopped: stateOn true → false
    if (!data.stateOn && this._lastStateOn === true) {
      const energy = this.getCapabilityValue('meter_power.session') || 0;
      app._chargingStoppedTrigger.trigger(this, { energy })
        .catch(err => this.error('[trigger] charging_stopped:', err));
    }

    // Cable connected: plugEV false → true
    if (data.plugEV && this._lastPlugEV === false) {
      app._cableConnectedTrigger.trigger(this)
        .catch(err => this.error('[trigger] cable_connected:', err));
    }

    // Cable disconnected: plugEV true → false
    if (!data.plugEV && this._lastPlugEV === true) {
      app._cableDisconnectedTrigger.trigger(this)
        .catch(err => this.error('[trigger] cable_disconnected:', err));
    }

    // Charging state changed
    if (data.stateDetail !== this._lastChargingState && this._lastChargingState !== null) {
      app._chargingStateChangedTrigger.trigger(this, { state: data.stateDetail })
        .catch(err => this.error('[trigger] charging_state_changed:', err));
    }

    // Error occurred
    if (data.stateDetail === 'error' && this._lastChargingState !== 'error') {
      app._errorOccurredTrigger.trigger(this, { details: 'error' })
        .catch(err => this.error('[trigger] error_occurred:', err));
    }
  }

  _updateCapability(name, value) {
    if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
      this.setCapabilityValue(name, value)
        .catch(err => this.error(`Failed to set ${name}:`, err));
    }
  }

  _handleMessage(msg) {
    const type = getResponseType(msg);

    if (type === 'tch-ok') {
      this.log(`[device:${this._host}] Command acknowledged: ${msg.trim()}`);
    } else if (type === 'tch-err') {
      this.error(`[device:${this._host}] Command error: ${msg.trim()}`);
    } else if (type === 'push_update') {
      // Unsolicited update from charger
      try {
        const data = JSON.parse(msg);
        this.log(`[device:${this._host}] Push update received`);
        // Process as report if it contains relevant fields
        if (data.State !== undefined) {
          this._processReport2(parseReport2(data));
        }
        if (data.P !== undefined && this._meterIntegrated) {
          this._processReport3(parseReport3(data));
        }
      } catch (err) {
        this.error(`[device:${this._host}] Failed to process push update:`, err.message);
      }
    }
  }

  // --- Command methods (called from flow actions and capability listeners) ---

  async setChargingCurrent(amperes) {
    if (!validateCurrent(amperes)) {
      throw new Error(`Invalid current: ${amperes}A. Must be 0 or 6–63 A.`);
    }
    const milliamps = Math.round(amperes * 1000);
    await this._sendCommand(`curr ${milliamps}`);
    this._scheduleQuickPoll();
    this.log(`[device:${this._host}] Set current to ${amperes}A`);
  }

  async setEnergyLimit(energyKwh) {
    if (energyKwh < 0 || energyKwh > 10000) {
      throw new Error(`Invalid energy limit: ${energyKwh} kWh. Must be 0–10000.`);
    }
    const rawEnergy = Math.round(energyKwh * 10000);
    await this._sendCommand(`setenergy ${rawEnergy}`);
    this._scheduleQuickPoll();
    this.log(`[device:${this._host}] Set energy limit to ${energyKwh} kWh`);
  }

  async enableCharging() {
    await this._sendCommand('ena 1');
    this._scheduleQuickPoll();
    this.log(`[device:${this._host}] Charging enabled`);
  }

  async disableCharging() {
    await this._sendCommand('ena 0');
    this._scheduleQuickPoll();
    this.log(`[device:${this._host}] Charging disabled`);
  }

  async _sendCommand(command) {
    if (!this._udpClient) {
      throw new Error('UDP client not available');
    }
    await this._udpClient.send(this._host, command);
  }

  // --- Quick poll (15s × 3 after user commands) ---

  _scheduleQuickPoll() {
    this.quickPollsRemaining = QUICK_POLL_COUNT;

    if (!this.quickPollTimer) {
      this.quickPollTimer = this.homey.setInterval(() => {
        this.poll();
        this.quickPollsRemaining--;

        if (this.quickPollsRemaining <= 0) {
          this.homey.clearInterval(this.quickPollTimer);
          this.quickPollTimer = null;
        }
      }, POLL_INTERVAL_QUICK);
    }
  }

  _restartPolling() {
    if (this.pollTimeout) {
      this.homey.clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    const interval = this._getPollInterval();
    this.pollInterval = this.homey.setInterval(() => this.poll(), interval);
    this.log(`[device:${this._host}] Polling restarted at ${interval}ms`);
  }

  // --- Settings changed ---

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('host')) {
      const oldHost = oldSettings.host;
      const newHost = newSettings.host;

      if (this._udpClient) {
        this._udpClient.unregisterDevice(oldHost);
        this._udpClient.registerDevice(newHost, (msg) => this._handleMessage(msg));
      }
      this._host = newHost;
      this.log(`[device] Host changed from ${oldHost} to ${newHost}`);
    }

    if (changedKeys.includes('poll_interval')) {
      this._restartPolling();
    }

    this._scheduleQuickPoll();
  }

  // --- Cleanup ---

  async onUninit() {
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
    if (this._udpClient) {
      this._udpClient.unregisterDevice(this._host);
    }
    this.log(`[device:${this._host}] Uninitialized`);
  }

}

module.exports = KebaDevice;
