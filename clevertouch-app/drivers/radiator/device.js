'use strict';

const { OAuth2Device } = require('homey-oauth2app');

// Polling intervals
const POLL_INTERVAL_NORMAL = 180 * 1000;   // 3 minutes
const POLL_INTERVAL_QUICK = 15 * 1000;     // 15 seconds after change
const QUICK_POLL_COUNT = 3;                // Number of quick polls

// Heat mode mappings
// API values: 0=Off, 1=Eco, 2=Frost, 3=Comfort, 4=Program, 5=Boost
const HEAT_MODE_TO_VALUE = {
  'Off': 0,
  'Eco': 1,
  'Frost': 2,
  'Comfort': 3,
  'Program': 4,
  'Boost': 5
};

const VALUE_TO_HEAT_MODE = {
  0: 'Off',
  1: 'Eco',
  2: 'Frost',
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

    // Ensure all required capabilities are present (migration support)
    const requiredCapabilities = [
      'measure_temperature',
      'target_temperature',
      'clevertouch_heat_mode',
      'clevertouch_heating_active',
      'clevertouch_zone',
      'measure_power',
      'clevertouch_error'
    ];

    for (const cap of requiredCapabilities) {
      if (!this.hasCapability(cap)) {
        this.log(`Adding missing capability: ${cap}`);
        await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
      }
    }

    // Remove deprecated capabilities
    if (this.hasCapability('clevertouch_boost_remaining')) {
      this.log('Removing deprecated capability: clevertouch_boost_remaining');
      await this.removeCapability('clevertouch_boost_remaining').catch(err => this.error('Failed to remove boost_remaining:', err));
    }
    if (this.hasCapability('meter_power')) {
      this.log('Removing deprecated capability: meter_power (replaced by measure_power)');
      await this.removeCapability('meter_power').catch(err => this.error('Failed to remove meter_power:', err));
    }

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
      const deviceData = devices.find(d => d.id_device === deviceLocalId);

      if (!deviceData) {
        throw new Error('Device not found in home');
      }

      // Log available fields for debugging
      this.log(`Device data fields: ${Object.keys(deviceData).join(', ')}`);
      this.log(`Raw temps: air=${deviceData.temperature_air}, sol=${deviceData.temperature_sol}`);
      this.log(`Raw setpoints: comfort=${deviceData.consigne_confort}, eco=${deviceData.consigne_eco}, hg=${deviceData.consigne_hg}, boost=${deviceData.consigne_boost}`);
      this.log(`Raw modes: gv_mode=${deviceData.gv_mode}, nv_mode=${deviceData.nv_mode}, on_off=${deviceData.on_off}`);
      this.log(`Home modes: general_mode=${deviceData._homeGeneralMode}, holiday_mode=${deviceData._homeHolidayMode}`);

      // Track previous mode for boost detection
      const oldMode = this.getCapabilityValue('clevertouch_heat_mode');

      // Helper function: API returns temps in Fahrenheit × 10, convert to Celsius
      const toDeciCelsius = (deciF) => {
        const fahrenheit = parseInt(deciF, 10) / 10;
        const celsius = (fahrenheit - 32) * 5 / 9;
        return Math.round(celsius * 10) / 10; // Round to 1 decimal
      };

      // Update current temperature (API returns temperature_air in Fahrenheit × 10)
      if (deviceData.temperature_air !== undefined) {
        const currentTemp = toDeciCelsius(deviceData.temperature_air);
        this.log(`Current temperature: ${currentTemp}°C (raw: ${deviceData.temperature_air}°F×10)`);
        this._updateCapability('measure_temperature', currentTemp);
      }

      // Update heat mode
      // Home general_mode takes precedence over device gv_mode when set (1-5)
      // general_mode=0 means "no home-wide override" so use device's gv_mode
      let heatMode = 'Off';
      let effectiveMode = deviceData.gv_mode;
      
      // If home general_mode is set to an active mode (1-5), use it instead of device mode
      // 0 = no override, 1+ = active mode override
      const homeGeneralMode = parseInt(deviceData._homeGeneralMode, 10);
      if (!isNaN(homeGeneralMode) && homeGeneralMode >= 1 && homeGeneralMode <= 5) {
        effectiveMode = homeGeneralMode;
        this.log(`Using home general_mode: ${homeGeneralMode} instead of device gv_mode: ${deviceData.gv_mode}`);
      }
      
      if (effectiveMode !== undefined) {
        const modeValue = parseInt(effectiveMode, 10);
        heatMode = VALUE_TO_HEAT_MODE[modeValue] || 'Off';
        this.log(`Heat mode: ${heatMode} (effective: ${effectiveMode}, device gv_mode: ${deviceData.gv_mode}, home general: ${homeGeneralMode})`);
        this._updateCapability('clevertouch_heat_mode', heatMode);

        // Check if boost ended
        if (oldMode === 'Boost' && heatMode !== 'Boost') {
          this.log('Boost mode ended');
          await this.homey.flow.getDeviceTriggerCard('boost_ended')
            .trigger(this)
            .catch(err => this.error('Error triggering boost_ended:', err));
        }
      }

      // Calculate target temperature based on current mode
      // Each mode has its own setpoint: consigne_confort, consigne_eco, consigne_hg, consigne_boost
      let targetTemp = null;
      switch (heatMode) {
        case 'Comfort':
          targetTemp = deviceData.consigne_confort;
          break;
        case 'Eco':
          targetTemp = deviceData.consigne_eco;
          break;
        case 'Frost':
          targetTemp = deviceData.consigne_hg;
          break;
        case 'Boost':
          targetTemp = deviceData.consigne_boost;
          break;
        case 'Program':
          // Program mode uses scheduled setpoints, show comfort as reference
          targetTemp = deviceData.consigne_confort;
          break;
        case 'Off':
        default:
          // Off mode - show frost protection setpoint as minimum
          targetTemp = deviceData.consigne_hg;
          break;
      }

      if (targetTemp !== null && targetTemp !== undefined) {
        const targetTempC = toDeciCelsius(targetTemp);
        this.log(`Target temperature: ${targetTempC}°C (raw: ${targetTemp}°F×10, mode: ${heatMode})`);
        this._updateCapability('target_temperature', targetTempC);
      }

      // Determine heating status by comparing temperatures (more reliable than heating_up field)
      // Device is heating when current temp < target temp AND device is in an active mode
      const currentTempC = deviceData.temperature_air !== undefined ? toDeciCelsius(deviceData.temperature_air) : null;
      const targetTempC = targetTemp !== null ? toDeciCelsius(targetTemp) : null;
      const isActiveMode = heatMode !== 'Off';
      
      // Calculate heating based on temperature difference
      // Also check API's heating_up field as secondary indicator
      const apiHeatingUp = String(deviceData.heating_up) === '1';
      const tempBasedHeating = isActiveMode && currentTempC !== null && targetTempC !== null && currentTempC < targetTempC;
      const heatingActive = tempBasedHeating || apiHeatingUp;
      
      this.log(`Heating active: ${heatingActive} (temp-based: ${tempBasedHeating}, api: ${apiHeatingUp}, current: ${currentTempC}°C, target: ${targetTempC}°C, mode: ${heatMode})`);
      this._updateCapability('clevertouch_heating_active', heatingActive);

      // Update zone name
      if (deviceData._zoneName) {
        this._updateCapability('clevertouch_zone', deviceData._zoneName);
      }

      // Update power consumption (watts when heating, 0 when idle)
      // puissance_app contains the device wattage rating
      const powerWatts = parseInt(deviceData.puissance_app, 10) || 0;
      const currentPower = heatingActive ? powerWatts : 0;
      this._updateCapability('measure_power', currentPower);
      this.log(`Power: ${currentPower}W (device rating: ${powerWatts}W, heating: ${heatingActive})`);

      // Update error status
      const errorCode = parseInt(deviceData.error_code, 10) || 0;
      const hasError = errorCode !== 0;
      this._updateCapability('clevertouch_error', hasError);
      if (hasError) {
        this.log(`Error detected: code ${errorCode}`);
      }

      // Mark device as available if it was unavailable
      if (!this.getAvailable()) {
        await this.setAvailable();
        this.log('Device is available again');
      }

    } catch (error) {
      const errorMsg = error?.message || String(error) || 'Unknown error';
      this.error('Poll failed:', errorMsg);

      // Only mark unavailable if was previously available
      if (this.getAvailable()) {
        await this.setUnavailable(errorMsg);
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

    // Convert Celsius to Fahrenheit × 10 for API
    const fahrenheit = (value * 9 / 5) + 32;
    const deciFahrenheit = Math.round(fahrenheit * 10);

    try {
      await this.oAuth2Client.setDeviceTemperature(
        homeId,
        deviceLocalId,
        tempType,
        deciFahrenheit
      );

      this.log(`Temperature set successfully to ${value}°C (${deciFahrenheit}°F×10, ${tempType} preset)`);

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

    // Helper: convert Celsius to Fahrenheit × 10 for API
    const toDeciFahrenheit = (celsius) => {
      const fahrenheit = (celsius * 9 / 5) + 32;
      return Math.round(fahrenheit * 10);
    };

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
            comfort: toDeciFahrenheit(newSettings.comfortTemp),
            eco: toDeciFahrenheit(newSettings.ecoTemp),
            frost: toDeciFahrenheit(newSettings.frostTemp)
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
