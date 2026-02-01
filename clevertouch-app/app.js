'use strict';

const { OAuth2App } = require('homey-oauth2app');
const CleverTouchOAuth2Client = require('./lib/CleverTouchOAuth2Client');

class CleverTouchApp extends OAuth2App {

  static OAUTH2_CLIENT = CleverTouchOAuth2Client;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('CleverTouch app has been initialized');

    // Register flow cards
    this._registerFlowCards();
  }

  /**
   * Register all flow cards
   */
  _registerFlowCards() {
    // Action: Set heat mode
    this.homey.flow.getActionCard('set_heat_mode')
      .registerRunListener(async (args) => {
        this.log(`[FlowAction] Setting heat mode to ${args.mode} for device ${args.device.getName()}`);
        await args.device.setCapabilityValue('clevertouch_heat_mode', args.mode);
        return true;
      });

    // Action: Start boost
    this.homey.flow.getActionCard('start_boost')
      .registerRunListener(async (args) => {
        this.log(`[FlowAction] Starting boost mode for device ${args.device.getName()}`);
        await args.device.setCapabilityValue('clevertouch_heat_mode', 'Boost');
        return true;
      });

    // Condition: Is heating
    this.homey.flow.getConditionCard('is_heating')
      .registerRunListener(async (args) => {
        const isHeating = args.device.getCapabilityValue('clevertouch_heating_active') === true;
        this.log(`[FlowCondition] Is heating check for ${args.device.getName()}: ${isHeating}`);
        return isHeating;
      });

    // Condition: Heat mode is
    this.homey.flow.getConditionCard('heat_mode_is')
      .registerRunListener(async (args) => {
        const currentMode = args.device.getCapabilityValue('clevertouch_heat_mode');
        const matches = currentMode === args.mode;
        this.log(`[FlowCondition] Heat mode check for ${args.device.getName()}: ${currentMode} === ${args.mode} = ${matches}`);
        return matches;
      });

    this.log('Flow cards registered');
  }

}

module.exports = CleverTouchApp;
