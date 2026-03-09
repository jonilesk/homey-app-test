'use strict';

const Homey = require('homey');

class SolarmanApp extends Homey.App {

  async onInit() {
    this.log('Solarman app has been initialized');

    // Register flow card listeners
    this._registerFlowCards();
  }

  _registerFlowCards() {
    // Register trigger cards (triggers are fired from device.js)
    this._solarProductionChangedTrigger = this.homey.flow.getDeviceTriggerCard('solar_production_changed');
    this._inverterStatusChangedTrigger = this.homey.flow.getDeviceTriggerCard('inverter_status_changed');
    this._inverterFaultTrigger = this.homey.flow.getDeviceTriggerCard('inverter_fault');

    // Register condition cards
    this.homey.flow.getConditionCard('is_producing_solar')
      .registerRunListener(async (args) => {
        const power = args.device.getCapabilityValue('measure_power');
        return power !== null && power > 0;
      });

    this.homey.flow.getConditionCard('inverter_is_normal')
      .registerRunListener(async (args) => {
        const status = args.device.getCapabilityValue('solarman_inverter_status');
        return status === 'normal';
      });

    // Register action cards
    this.homey.flow.getActionCard('write_register')
      .registerRunListener(async (args) => {
        const { device, register, value } = args;

        if (!device._api) {
          throw new Error('Device not connected');
        }

        await device._api.connect();
        await device._api.writeHoldingRegister(register, value);
        device.log(`[flow] Write register ${register} = ${value}`);

        // Quick poll to reflect changes
        device._scheduleQuickPoll();
      });

    this.log('Flow cards registered');
  }

}

module.exports = SolarmanApp;
