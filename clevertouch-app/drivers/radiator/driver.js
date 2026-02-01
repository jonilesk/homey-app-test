'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class RadiatorDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('RadiatorDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user tries to pair a new device.
   * This should return an array with the data of devices available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    this.log('Listing devices for pairing');

    try {
      // Get user data to access homes
      const userData = await oAuth2Client.getUser();
      this.log(`Found user: ${userData.email || 'unknown'}`);

      // For now, return all available devices from all homes
      // In a more sophisticated implementation, we could let user select home first
      const allDevices = [];

      if (userData.homes && Array.isArray(userData.homes)) {
        for (const home of userData.homes) {
          this.log(`Fetching devices from home: ${home.name} (${home.id})`);

          try {
            const devices = await oAuth2Client.getDevices(home.id);

            // Filter only radiators (type 'R')
            const radiators = devices.filter(device => device.type === 'R');

            this.log(`Found ${radiators.length} radiators in home ${home.name}`);

            // Map to Homey device format
            for (const device of radiators) {
              allDevices.push({
                name: device.name || `Radiator ${device.local_id}`,
                data: {
                  id: `${home.id}_${device.local_id}`, // Unique ID combining home and device
                  homeId: home.id,
                  deviceLocalId: device.local_id,
                  deviceType: device.type
                },
                store: {
                  homeName: home.name
                },
                settings: {
                  comfortTemp: device.setpoint_comfort ? device.setpoint_comfort / 10 : 21,
                  ecoTemp: device.setpoint_eco ? device.setpoint_eco / 10 : 18,
                  frostTemp: device.setpoint_frost ? device.setpoint_frost / 10 : 7
                }
              });
            }
          } catch (error) {
            this.error(`Error fetching devices from home ${home.id}:`, error);
          }
        }
      }

      this.log(`Total devices available for pairing: ${allDevices.length}`);
      return allDevices;

    } catch (error) {
      this.error('Error in onPairListDevices:', error);
      throw new Error(this.homey.__('pair.error.list_devices'));
    }
  }

}

module.exports = RadiatorDriver;
