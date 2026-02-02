'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class RadiatorDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('RadiatorDriver has been initialized');
    this.debug = true; // Enable extra debug output
  }

  /**
   * Called when pairing starts
   */
  async onPair(session) {
    this.log('[PAIR] Pairing session started');
    
    session.setHandler('showView', async (viewId) => {
      this.log(`[PAIR] Showing view: ${viewId}`);
    });

    return super.onPair(session);
  }

  /**
   * onPairListDevices is called when a user tries to pair a new device.
   * This should return an array with the data of devices available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    this.log('[PAIR] onPairListDevices called');
    this.log('[PAIR] oAuth2Client exists:', !!oAuth2Client);
    
    if (oAuth2Client) {
      this.log('[PAIR] Token exists:', !!oAuth2Client.getToken());
      try {
        const token = oAuth2Client.getToken();
        this.log('[PAIR] Token details:', JSON.stringify({
          hasAccessToken: !!token?.access_token,
          hasRefreshToken: !!token?.refresh_token,
          tokenType: token?.token_type
        }));
      } catch (e) {
        this.log('[PAIR] Could not get token info:', e.message);
      }
    }

    try {
      // Get stored email from pairing session
      const email = oAuth2Client._email || this.homey.settings.get('clevertouch_email');
      this.log('[PAIR] Using email:', email);
      
      if (!email) {
        throw new Error('No email found - please log in again');
      }

      // Get user data to access homes
      this.log('[PAIR] Calling getUser()...');
      const userData = await oAuth2Client.getUser(email);
      this.log('[PAIR] User data received:', JSON.stringify(userData, null, 2));
      this.log(`[PAIR] Found user: ${userData.user_id || 'unknown'}`);

      // For now, return all available devices from all homes
      const allDevices = [];

      if (userData.smarthomes && Array.isArray(userData.smarthomes)) {
        for (const home of userData.smarthomes) {
          this.log(`[PAIR] Fetching devices from home: ${home.label} (${home.smarthome_id})`);

          try {
            const homeData = await oAuth2Client.getHome(home.smarthome_id);
            const devices = homeData.devices || [];

            // Filter only radiator devices (id_device starts with 'R')
            const radiators = devices.filter(device => 
              device.id_device && device.id_device.startsWith('R')
            );

            this.log(`[PAIR] Found ${radiators.length} radiators in home ${home.label}`);

            // Map to Homey device format
            for (const device of radiators) {
              allDevices.push({
                name: device.label_interface || `Radiator ${device.id_device}`,
                data: {
                  id: `${home.smarthome_id}_${device.id_device}`,
                  homeId: home.smarthome_id,
                  deviceLocalId: device.id_device,
                  deviceId: device.id
                },
                store: {
                  homeName: home.label,
                  email: email
                },
                settings: {
                  comfortTemp: device.consigne_confort ? parseInt(device.consigne_confort) / 10 : 21,
                  ecoTemp: device.consigne_eco ? parseInt(device.consigne_eco) / 10 : 18,
                  frostTemp: device.consigne_hg ? parseInt(device.consigne_hg) / 10 : 7
                }
              });
            }
          } catch (error) {
            this.error(`[PAIR] Error fetching devices from home ${home.smarthome_id}:`, error);
          }
        }
      }

      this.log(`[PAIR] Total devices available for pairing: ${allDevices.length}`);
      return allDevices;

    } catch (error) {
      this.error('Error in onPairListDevices:', error);
      throw new Error(this.homey.__('pair.error.list_devices'));
    }
  }

}

module.exports = RadiatorDriver;
