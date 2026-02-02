'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class RadiatorDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    await super.onInit();
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
      this.log('[PAIR] OAuth2 Session ID:', oAuth2Client._sessionId);
      this.log('[PAIR] OAuth2 Config ID:', oAuth2Client._configId);
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
            const zones = homeData.zones || [];

            this.log(`[PAIR] Zones in home:`, JSON.stringify(zones));

            // Build zone lookup map (num_zone -> zone_label)
            const zoneMap = {};
            for (const zone of zones) {
              zoneMap[zone.num_zone] = zone.zone_label || zone.label || `Zone ${zone.num_zone}`;
            }
            this.log(`[PAIR] Zone map:`, JSON.stringify(zoneMap));

            this.log(`[PAIR] All devices in home:`, JSON.stringify(devices.map(d => ({
              id_device: d.id_device,
              nom_appareil: d.nom_appareil,
              label_interface: d.label_interface,
              num_zone: d.num_zone
            }))));

            // Include all heating devices - they can have various id_device formats:
            // - "R1", "R2" etc for radiators
            // - "C001-000" etc for newer devices
            // Filter out lights (L) and outlets (P) but include everything else
            const radiators = devices.filter(device => {
              if (!device.id_device) return false;
              const id = device.id_device.toUpperCase();
              // Exclude lights and outlets
              if (id.startsWith('L') || id.startsWith('P')) return false;
              return true;
            });

            this.log(`[PAIR] Found ${radiators.length} heating devices in home ${home.label}`);

            // Map to Homey device format
            for (const device of radiators) {
              // Build name from zone label + device label (like Home Assistant integration)
              const zoneName = device.num_zone && zoneMap[device.num_zone] ? zoneMap[device.num_zone] : '';
              const deviceLabel = device.label_interface || device.nom_appareil || '';
              
              // Construct name: prefer zone name, append device label if not generic "Heating"
              let deviceName;
              if (zoneName && deviceLabel && deviceLabel !== 'Heating') {
                deviceName = `${zoneName} ${deviceLabel}`;
              } else if (zoneName) {
                deviceName = zoneName;
              } else if (deviceLabel) {
                deviceName = deviceLabel;
              } else {
                deviceName = `Heater ${device.id_device}`;
              }
              
              this.log(`[PAIR] Adding device: ${deviceName} (${device.id_device}, zone: ${device.num_zone} = ${zoneName})`);
              
              allDevices.push({
                name: deviceName,
                data: {
                  id: `${home.smarthome_id}_${device.id_device}`,
                  homeId: home.smarthome_id,
                  deviceLocalId: device.id_device,
                  deviceId: device.id
                },
                store: {
                  homeName: home.label,
                  email: email,
                  zoneName: zoneName || ''
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
