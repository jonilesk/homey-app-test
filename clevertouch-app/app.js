'use strict';

const { OAuth2App } = require('homey-oauth2app');
const CleverTouchOAuth2Client = require('./lib/CleverTouchOAuth2Client');

class CleverTouchApp extends OAuth2App {

  static OAUTH2_CLIENT = CleverTouchOAuth2Client;
  static OAUTH2_DEBUG = true; // Enable debug logging

  /**
   * onOAuth2Init is called when the OAuth2App is initialized.
   */
  async onOAuth2Init() {
    this.log('[App] CleverTouch OAuth2 app initializing...');
    
    // Enable debugging
    this.enableOAuth2Debug();
    
    this.log('[App] CleverTouch app has been initialized');

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

    // Register boost_ended trigger (called from device)
    this._boostEndedTrigger = this.homey.flow.getDeviceTriggerCard('boost_ended');

    this.log('Flow cards registered');
  }

  /**
   * Trigger the boost_ended flow for a device
   */
  triggerBoostEnded(device) {
    this._boostEndedTrigger.trigger(device).catch(this.error);
  }

}

module.exports = CleverTouchApp;
