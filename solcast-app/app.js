'use strict';

const Homey = require('homey');

class SolcastApp extends Homey.App {

  async onInit() {
    this.log('Solcast PV Forecast app initialized');
    this._registerFlowCards();
  }

  _registerFlowCards() {
    // Triggers
    this._forecastUpdatedTrigger = this.homey.flow.getDeviceTriggerCard('forecast_updated');

    // Conditions
    this.homey.flow.getConditionCard('forecast_producing')
      .registerRunListener(async (args) => {
        const power = args.device.getCapabilityValue('measure_power');
        return power !== null && power > 0;
      });

    this.homey.flow.getConditionCard('forecast_above_watts')
      .registerRunListener(async (args) => {
        const power = args.device.getCapabilityValue('measure_power');
        return power !== null && power > args.watts;
      });

    // Actions
    this.homey.flow.getActionCard('update_forecast')
      .registerRunListener(async (args) => {
        await args.device.updateForecast();
      });

    this.log('Flow cards registered');
  }
}

module.exports = SolcastApp;
