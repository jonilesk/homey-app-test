'use strict';

const Homey = require('homey');
const KebaUdpClient = require('./lib/KebaUdpClient');

class KebaKeContactApp extends Homey.App {

  async onInit() {
    this.log('KEBA KeContact app initializing...');

    // Create singleton UDP client shared across all devices
    this.udpClient = new KebaUdpClient({ logger: this });

    try {
      await this.udpClient.init();
      this.log('UDP client initialized on port 7090');
    } catch (err) {
      this.error('Failed to initialize UDP client:', err.message);
      // App can still start — devices will retry on poll
    }

    this._registerFlowCards();
    this.log('KEBA KeContact app initialized');
  }

  async onUninit() {
    this.log('KEBA KeContact app shutting down...');
    if (this.udpClient) {
      await this.udpClient.close();
    }
  }

  _registerFlowCards() {
    // Triggers — get card references (fired from device.js)
    this._chargingStartedTrigger = this.homey.flow.getDeviceTriggerCard('charging_started');
    this._chargingStoppedTrigger = this.homey.flow.getDeviceTriggerCard('charging_stopped');
    this._cableConnectedTrigger = this.homey.flow.getDeviceTriggerCard('cable_connected');
    this._cableDisconnectedTrigger = this.homey.flow.getDeviceTriggerCard('cable_disconnected');
    this._chargingStateChangedTrigger = this.homey.flow.getDeviceTriggerCard('charging_state_changed');
    this._errorOccurredTrigger = this.homey.flow.getDeviceTriggerCard('error_occurred');

    // Conditions
    this.homey.flow.getConditionCard('is_charging')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('keba_charging_state') === 'charging';
      });

    this.homey.flow.getConditionCard('is_car_connected')
      .registerRunListener(async (args) => {
        const cable = args.device.getCapabilityValue('keba_cable_state');
        return cable === 'cable_ev' || cable === 'cable_locked_ev';
      });

    // Actions
    this.homey.flow.getActionCard('set_charging_current')
      .registerRunListener(async (args) => {
        await args.device.setChargingCurrent(args.current);
      });

    this.homey.flow.getActionCard('set_energy_limit')
      .registerRunListener(async (args) => {
        await args.device.setEnergyLimit(args.energy);
      });

    this.homey.flow.getActionCard('enable_charging')
      .registerRunListener(async (args) => {
        await args.device.enableCharging();
      });

    this.homey.flow.getActionCard('disable_charging')
      .registerRunListener(async (args) => {
        await args.device.disableCharging();
      });

    this.log('Flow cards registered');
  }

}

module.exports = KebaKeContactApp;
