'use strict';

const Homey = require('homey');
const SolcastApi = require('../../lib/SolcastApi');

class ForecastDriver extends Homey.Driver {

  async onInit() {
    this.log('ForecastDriver initialized');
  }

  async onPair(session) {
    this.log('[PAIR] Pairing session started');

    let pairData = {};

    // login_credentials template emits 'login' with username/password
    session.setHandler('login', async (data) => {
      const apiKey = data.username;
      const quota = parseInt(data.password, 10) || 10;

      this.log('[PAIR] Validating API key...');

      if (!apiKey || apiKey.length < 10) {
        throw new Error('Invalid API key');
      }

      // Validate by fetching sites
      const api = new SolcastApi({ apiKey, timeout: 15000 });
      let sites;
      try {
        sites = await api.getSites();
      } catch (error) {
        this.error('[PAIR] API validation failed:', error.message);
        throw new Error(`Solcast API error: ${error.message}`);
      }

      if (!sites || sites.length === 0) {
        throw new Error('No rooftop sites found for this API key');
      }

      this.log(`[PAIR] Found ${sites.length} site(s)`);
      pairData = { apiKey, quota, sites };

      return true;
    });

    session.setHandler('list_devices', async () => {
      this.log('[PAIR] Listing devices');

      const totalCapacity = pairData.sites.reduce((sum, s) => sum + (s.capacity || 0), 0);

      return [{
        name: `Solcast Forecast (${totalCapacity}kW)`,
        data: {
          id: `solcast_${pairData.sites.map(s => s.resource_id).join('_')}`,
        },
        store: {
          sites: pairData.sites.map(s => ({
            resource_id: s.resource_id,
            name: s.name,
            capacity: s.capacity,
            latitude: s.latitude,
            longitude: s.longitude,
          })),
        },
        settings: {
          api_key: pairData.apiKey,
          api_quota: pairData.quota,
          update_mode: 'daily',
          fetch_hour: 3,
          estimate_type: 'pv_estimate',
          hard_limit: 0,
        },
      }];
    });
  }
}

module.exports = ForecastDriver;
