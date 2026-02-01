'use strict';

const { OAuth2Device } = require('homey-oauth2app');

// Polling intervals
const POLL_INTERVAL_NORMAL = 180 * 1000;   // 3 minutes
const POLL_INTERVAL_QUICK = 15 * 1000;     // 15 seconds after change
const QUICK_POLL_COUNT = 3;                // Number of quick polls

// Heat mode mappings
const HEAT_MODE_TO_VALUE = {
  'Off': 0,
  'Frost': 1,
  'Eco': 2,
  'Comfort': 3,
  'Program': 4,
  'Boost': 5
};

const VALUE_TO_HEAT_MODE = {
  0: 'Off',
  1: 'Frost',
  2: 'Eco',
  3: 'Comfort',
  4: 'Program',
  5: 'Boost'
};

class RadiatorDevice extends OAuth2Device {

  /**
   * onOAuth2Init is called when the device is initialized.
   */
  async onOAuth2Init() {
    this.log('RadiatorDevice has been initialized');

    // Register capability listeners
    this.registerCapabilityListener('target_temperature', this.onSetTemperature.bind(this));
    this.registerCapabilityListener('clevertouch_heat_mode', this.onSetHeatMode.bind(this));

    // Add random jitter (0-30s) to avoid thundering herd when multiple devices init
    const jitter = Math.random() * 30000;
    this.log(`Starting polling with ${Math.round(jitter / 1000)}s jitter`);

    // Start polling after jitter
    this.pollTimeout = this.homey.setTimeout(async () => {
      await this.poll();  // Initial poll

      // Then start regular interval
      this.pollInterval = this.homey.setInterval(
        () => this.poll(),
        POLL_INTERVAL_NORMAL
      );
    }, jitter);
  }

  /**
   * Poll device data from API
   */
  async poll() {
    try {
      const { homeId, deviceLocalId } = this.getData();
      const oAuth2Client = this.oAuth2Client;

      this.log('Polling device data...');

      // Get all devices from home
      const devices = await oAuth2Client.getDevices(homeId);

      // Find our device
      const deviceData = devices.find(d => d.local_id === deviceLocalId);

      if (!deviceData) {
        throw new Error('Device not found in home');
      }

      // Track previous mode for boost detection
      const oldMode = this.getCapabilityValue('clevertouch_heat_mode');

      // Update capabilities
      if (deviceData.current_temp !== undefined) {
        this._updateCapability('measure_temperature', deviceData.current_temp / 10);
      }

      if (deviceData.target_temp !== undefined) {
        this._updateCapability('target_temperature', deviceData.target_temp / 10);
      }

      if (deviceData.gv_mode !== undefined) {
        const heatMode = VALUE_TO_HEAT_MODE[deviceData.gv_mode] || 'Off';
        this._updateCapability('clevertouch_heat_mode', heatMode);

        // Check if boost ended
        if (oldMode === 'Boost' && heatMode !== 'Boost') {
          this.log('Boost mode ended');
          await this.homey.flow.getDeviceTriggerCard('boost_ended')
            .trigger(this)
            .catch(err => this.error('Error triggering boost_ended:', err));
        }
      }

      if (deviceData.heating_up !== undefined) {
        const heatingActive = deviceData.heating_up === true || deviceData.heating_up === 1;
        this._updateCapability('clevertouch_heating_active', heatingActive);
      }

      // Boost remaining time (if available in API response)
      if (deviceData.boost_ends_at) {
        const remaining = Math.max(0, (deviceData.boost_ends_at - Date.now()) / 1000 / 60);
        this._updateCapability('clevertouch_boost_remaining', Math.round(remaining));
      } else if (this.getCapabilityValue('clevertouch_heat_mode') !== 'Boost') {
        this._updateCapability('clevertouch_boost_remaining', 0);
      }

      // Mark device as available if it was unavailable
      if (!this.getAvailable()) {
        await this.setAvailable();
        this.log('Device is available again');
      }

    } catch (error) {
      this.error('Poll failed:', error.message);

      // Only mark unavailable if was previously available
      if (this.getAvailable()) {
        await this.setUnavailable(error.message);
        this.log('Device marked unavailable due to error');
      }
      // Continue polling - will retry on next interval
    }
  }

  /**
   * Update capability value only if changed
   */
  _updateCapability(name, value) {
    if (this.hasCapability(name)) {
      const currentValue = this.getCapabilityValue(name);
      if (currentValue !== value) {
        this.setCapabilityValue(name, value)
          .catch(err => this.error(`Failed to set ${name}:`, err));
      }
    }
  }

  /**
   * Handle target temperature change
   */
  async onSetTemperature(value) {
    this.log(`Setting temperature to ${value}°C`);

    const currentMode = this.getCapabilityValue('clevertouch_heat_mode');

    // Map mode to temperature type - update the appropriate preset
    const tempType = {
      'Comfort': 'comfort',
      'Eco': 'eco',
      'Frost': 'frost',
      'Program': 'comfort',  // Update comfort as default for program
      'Boost': 'comfort',
      'Off': 'comfort'
    }[currentMode] || 'comfort';

    const { homeId, deviceLocalId } = this.getData();

    try {
      await this.oAuth2Client.setDeviceTemperature(
        homeId,
        deviceLocalId,
        tempType,
        Math.round(value * 10)  // Convert to device units (×10)
      );

      this.log(`Temperature set successfully to ${value}°C (${tempType} preset)`);

      // Quick poll after change
      this._scheduleQuickPoll();

    } catch (error) {
      this.error('Error setting temperature:', error);
      throw new Error(this.homey.__('errors.set_temperature_failed'));
    }
  }

  /**
   * Handle heat mode change
   */
  async onSetHeatMode(mode) {
    this.log(`Setting heat mode to ${mode}`);

    const modeValue = HEAT_MODE_TO_VALUE[mode];

    if (modeValue === undefined) {
      this.error(`Invalid heat mode: ${mode}`);
      throw new Error(this.homey.__('errors.invalid_mode'));
    }

    const { homeId, deviceLocalId } = this.getData();

    try {
      await this.oAuth2Client.setDeviceMode(
        homeId,
        deviceLocalId,
        modeValue
      );

      this.log(`Heat mode set successfully to ${mode} (${modeValue})`);

      // Quick poll after change
      this._scheduleQuickPoll();

    } catch (error) {
      this.error('Error setting heat mode:', error);
      throw new Error(this.homey.__('errors.set_mode_failed'));
    }
  }

  /**
   * Handle device settings changes
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    // Handle temperature preset changes
    if (changedKeys.includes('comfortTemp') ||
        changedKeys.includes('ecoTemp') ||
        changedKeys.includes('frostTemp')) {

      this.log('Updating device presets:', newSettings);

      const { homeId, deviceLocalId } = this.getData();

      try {
        await this.oAuth2Client.setDevicePresets(
          homeId,
          deviceLocalId,
          {
            comfort: Math.round(newSettings.comfortTemp * 10),
            eco: Math.round(newSettings.ecoTemp * 10),
            frost: Math.round(newSettings.frostTemp * 10)
          }
        );

        this.log('Device presets updated successfully');

        // Quick poll to confirm changes
        this._scheduleQuickPoll();

      } catch (error) {
        this.error('Error updating device presets:', error);
        throw new Error(this.homey.__('errors.set_presets_failed'));
      }
    }
  }

  /**
   * Schedule quick polling after a change
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
   * onOAuth2Uninit is called when the device is deleted or disabled.
   */
  async onOAuth2Uninit() {
    this.log('Device uninitializing');

    // Clear intervals and timeouts
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
  }

  /**
   * onOAuth2Deleted is called when the device is deleted.
   */
  async onOAuth2Deleted() {
    this.log('Device deleted from Homey');
  }

}

module.exports = RadiatorDevice;
