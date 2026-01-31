# Homey App Design for CleverTouch

## App Structure

```
clevertouch/
├── app.js                          # Main app entry point
├── app.json                        # App manifest
├── package.json
├── api/
│   └── clevertouch-api.js          # API client
├── drivers/
│   ├── radiator/
│   │   ├── device.js               # Radiator device
│   │   ├── driver.js               # Radiator driver
│   │   ├── driver.compose.json
│   │   └── assets/
│   │       └── icon.svg
│   ├── light/
│   │   ├── device.js
│   │   ├── driver.js
│   │   ├── driver.compose.json
│   │   └── assets/
│   └── outlet/
│       ├── device.js
│       ├── driver.js
│       ├── driver.compose.json
│       └── assets/
├── .homeycompose/
│   ├── capabilities/
│   │   ├── clevertouch_heat_mode.json
│   │   ├── clevertouch_heating_active.json
│   │   └── clevertouch_boost_remaining.json
│   ├── flow/
│   │   ├── triggers/
│   │   ├── conditions/
│   │   └── actions/
│   └── app.json
├── locales/
│   ├── en.json
│   └── fi.json
└── assets/
    └── icon.svg
```

---

## App Manifest (app.json)

```json
{
  "id": "com.clevertouch",
  "version": "1.0.0",
  "compatibility": ">=5.0.0",
  "sdk": 3,
  "name": {
    "en": "CleverTouch"
  },
  "description": {
    "en": "Control your CleverTouch radiators and smart devices"
  },
  "category": ["climate"],
  "brandColor": "#E74C3C",
  "permissions": [],
  "images": {
    "small": "/assets/images/small.png",
    "large": "/assets/images/large.png"
  },
  "author": {
    "name": "Your Name"
  },
  "support": "mailto:support@example.com",
  "api": {
    "getToken": {
      "method": "GET",
      "path": "/token"
    }
  }
}
```

---

## Homey SDK Constraints & Best Practices

This app should follow the Homey Pro (2023) guidelines in [docs/04-coding-guidelines.md](docs/04-coding-guidelines.md) and [docs/05-drivers-devices-capabilities.md](docs/05-drivers-devices-capabilities.md). Key constraints:

- **Lifecycle**: keep `onInit()` lightweight; defer I/O to pairing or device init.
- **Networking**: set timeouts on all HTTP calls; use retry with backoff + jitter.
- **Stability**: never throw uncaught exceptions from device callbacks; fail soft with `setUnavailable()` and recover with `setAvailable()`.
- **Secrets**: never log credentials or tokens; store refresh tokens in settings only.
- **Capabilities**: prefer standard capabilities; update only when values change.
- **Pairing**: validate connectivity/credentials and provide clear errors in the UI.
- **Polling**: avoid aggressive polling; honor limits and back off on failures.
- **Flows**: keep handlers fast; validate arguments early; log outcomes with redaction.

These constraints should be enforced in driver/device implementations and any Flow card handlers.

## API Client Design

### api/clevertouch-api.js

```javascript
'use strict';

const fetch = require('node-fetch');

const MODELS = {
  purmo: { host: 'e3.lvi.eu', manufacturer: 'purmo' },
  waltermeier: { host: 'www.smartcomfort.waltermeier.com', manufacturer: 'waltermeier' },
  frico: { host: 'fricopfsmart.frico.se', manufacturer: 'frico' },
  fenix: { host: 'v24.fenixgroup.eu', manufacturer: 'fenix' },
  vogelundnoot: { host: 'e3.vogelundnoot.com', manufacturer: 'vogelundnoot' },
  cordivari: { host: 'cordivarihome.com', manufacturer: 'cordivari' },
};

const CLIENT_ID = 'app-front';
const API_PATH = '/api/v0.1/';

class CleverTouchApi {
  constructor(homey, modelId = 'purmo') {
    this.homey = homey;
    this.modelId = modelId;
    this.model = MODELS[modelId];
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
  }

  get tokenUrl() {
    return `https://auth.${this.model.host}/realms/${this.model.manufacturer}/protocol/openid-connect/token`;
  }

  get apiBase() {
    return `https://${this.model.host}${API_PATH}`;
  }

  // Initialize from stored settings
  async init() {
    this.refreshToken = this.homey.settings.get('refresh_token');
    this.modelId = this.homey.settings.get('model_id') || 'purmo';
    this.model = MODELS[this.modelId];
    
    if (this.refreshToken) {
      try {
        await this.refreshAccessToken();
        return true;
      } catch (error) {
        this.homey.log('Failed to refresh token on init:', error);
        return false;
      }
    }
    return false;
  }

  // Authenticate with password
  async authenticate(email, password) {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        username: email,
        password: password,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Authentication failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    this._handleTokenResponse(data);
    
    // Store credentials
    this.homey.settings.set('refresh_token', this.refreshToken);
    this.homey.settings.set('email', email);
    this.homey.settings.set('model_id', this.modelId);
    
    return data;
  }

  // Refresh access token
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: this.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    this._handleTokenResponse(data);
    
    // Update stored refresh token
    this.homey.settings.set('refresh_token', this.refreshToken);
    
    return data;
  }

  _handleTokenResponse(data) {
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token || this.refreshToken;
    this.expiresAt = Date.now() + (data.expires_in * 1000) - 30000; // 30s buffer
  }

  // Ensure valid token before API call
  async _ensureValidToken() {
    if (Date.now() >= this.expiresAt) {
      await this.refreshAccessToken();
    }
  }

  // Make authenticated API request
  async _post(endpoint, payload = {}) {
    await this._ensureValidToken();

    const response = await fetch(`${this.apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(payload),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.code?.code !== 1 && data.code?.code !== 8) {
      throw new Error(`API error: ${data.code?.value || 'Unknown'}`);
    }

    return data.data;
  }

  // Get user data
  async getUserData(email) {
    return this._post('human/user/read/', { email });
  }

  // Get home data
  async getHomeData(homeId) {
    return this._post('human/smarthome/read/', { smarthome_id: homeId });
  }

  // Write device query
  async writeQuery(homeId, queryParams) {
    const payload = {
      smarthome_id: homeId,
      context: '1',
      peremption: '15000',
    };
    
    for (const [key, value] of Object.entries(queryParams)) {
      payload[`query[${key}]`] = String(value);
    }

    return this._post('human/query/push/', payload);
  }

  // Set heat mode
  async setHeatMode(homeId, deviceLocalId, mode) {
    const modeMap = {
      'Off': 0, 'Frost': 1, 'Eco': 2, 
      'Comfort': 3, 'Program': 4, 'Boost': 5
    };
    
    return this.writeQuery(homeId, {
      id_device: deviceLocalId,
      gv_mode: modeMap[mode],
      nv_mode: modeMap[mode],
    });
  }

  // Set temperature
  async setTemperature(homeId, deviceLocalId, tempType, celsius) {
    const fieldMap = {
      comfort: 'consigne_confort',
      eco: 'consigne_eco',
      frost: 'consigne_hg',
      boost: 'consigne_boost',
    };
    
    const deviceUnits = Math.round(celsius * 10);
    
    return this.writeQuery(homeId, {
      id_device: deviceLocalId,
      [fieldMap[tempType]]: deviceUnits,
    });
  }

  // Set on/off state
  async setOnOffState(homeId, deviceLocalId, isOn) {
    return this.writeQuery(homeId, {
      id_device: deviceLocalId,
      on_off: isOn ? '1' : '0',
    });
  }
}

module.exports = CleverTouchApi;
```

---

## Main App (app.js)

```javascript
'use strict';

const Homey = require('homey');
const CleverTouchApi = require('./api/clevertouch-api');

class CleverTouchApp extends Homey.App {
  async onInit() {
    this.log('CleverTouch app initializing...');
    
    // Initialize API client
    this.api = new CleverTouchApi(this.homey);
    
    // Try to restore session
    const hasSession = await this.api.init();
    if (hasSession) {
      this.log('Session restored from stored credentials');
    } else {
      this.log('No valid session, user needs to pair devices');
    }

    // Register flow cards
    this._registerFlowCards();

    this.log('CleverTouch app initialized');
  }

  _registerFlowCards() {
    // Action: Set heat mode
    this.homey.flow.getActionCard('set_heat_mode')
      .registerRunListener(async (args) => {
        await args.device.setHeatMode(args.mode);
      });

    // Action: Activate boost
    this.homey.flow.getActionCard('activate_boost')
      .registerRunListener(async (args) => {
        await args.device.activateBoost(args.duration, args.temperature);
      });

    // Condition: Is heating
    this.homey.flow.getConditionCard('is_heating')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('clevertouch_heating_active');
      });
  }

  getApi() {
    return this.api;
  }
}

module.exports = CleverTouchApp;
```

---

## Pairing Flow Design

### List Devices Strategy

```javascript
// driver.js

class RadiatorDriver extends Homey.Driver {
  async onPairListDevices() {
    const api = this.homey.app.getApi();
    
    if (!api.accessToken) {
      throw new Error('Please configure your CleverTouch account first');
    }

    const email = this.homey.settings.get('email');
    const userData = await api.getUserData(email);
    
    const devices = [];
    
    for (const homeInfo of userData.smarthomes) {
      const homeData = await api.getHomeData(homeInfo.smarthome_id);
      
      for (const deviceData of homeData.devices) {
        // Filter for radiators only
        if (deviceData.id_device?.startsWith('R')) {
          devices.push({
            name: `${deviceData.label_interface} (${homeData.label})`,
            data: {
              id: deviceData.id,
              homeId: homeInfo.smarthome_id,
              idLocal: deviceData.id_device,
              zoneId: deviceData.num_zone,
            },
            store: {
              label: deviceData.label_interface,
              zoneName: homeData.zones?.find(z => z.num_zone === deviceData.num_zone)?.zone_label,
            },
          });
        }
      }
    }

    return devices;
  }
}
```

### Login Pairing View

For initial authentication, use a custom pairing view:

```json
// driver.compose.json
{
  "pair": [
    {
      "id": "login_credentials",
      "template": "login_credentials",
      "options": {
        "title": { "en": "CleverTouch Login" },
        "usernameLabel": { "en": "Email" },
        "usernamePlaceholder": { "en": "your@email.com" },
        "passwordLabel": { "en": "Password" },
        "passwordPlaceholder": { "en": "Password" }
      }
    },
    {
      "id": "list_devices",
      "template": "list_devices",
      "navigation": { "next": "add_devices" }
    },
    {
      "id": "add_devices",
      "template": "add_devices"
    }
  ]
}
```

---

## Device Implementation

### device.js (Radiator)

```javascript
'use strict';

const Homey = require('homey');

const POLL_INTERVAL = 180000; // 3 minutes
const QUICK_POLL_INTERVAL = 15000; // 15 seconds
const QUICK_POLL_COUNT = 3;

class RadiatorDevice extends Homey.Device {
  async onInit() {
    this.log('Radiator device initializing:', this.getName());

    this._quickPollCount = 0;
    this._pollInterval = null;

    // Register capability listeners
    this.registerCapabilityListener('target_temperature', this.onTargetTemperature.bind(this));
    this.registerCapabilityListener('clevertouch_heat_mode', this.onHeatModeChange.bind(this));

    // Start polling
    await this._poll();
    this._startPolling();

    this.log('Radiator device initialized');
  }

  async onDeleted() {
    this._stopPolling();
  }

  _startPolling() {
    this._pollInterval = this.homey.setInterval(
      () => this._poll(),
      POLL_INTERVAL
    );
  }

  _stopPolling() {
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  async _requestQuickPoll() {
    this._quickPollCount = QUICK_POLL_COUNT;
    this._stopPolling();
    
    const quickPoll = async () => {
      await this._poll();
      this._quickPollCount--;
      
      if (this._quickPollCount > 0) {
        this.homey.setTimeout(quickPoll, QUICK_POLL_INTERVAL);
      } else {
        this._startPolling();
      }
    };
    
    this.homey.setTimeout(quickPoll, QUICK_POLL_INTERVAL);
  }

  async _poll() {
    try {
      const api = this.homey.app.getApi();
      const { homeId } = this.getData();
      
      const homeData = await api.getHomeData(homeId);
      const deviceData = homeData.devices.find(d => d.id === this.getData().id);
      
      if (deviceData) {
        await this._updateFromData(deviceData);
      }
    } catch (error) {
      this.error('Poll failed:', error);
    }
  }

  async _updateFromData(data) {
    // Current temperature
    const currentTemp = parseInt(data.sonde_temperature) / 10;
    await this.setCapabilityValue('measure_temperature', currentTemp).catch(this.error);

    // Heat mode
    const modeMap = ['Off', 'Frost', 'Eco', 'Comfort', 'Program', 'Boost'];
    const mode = modeMap[parseInt(data.gv_mode)] || 'Off';
    await this.setCapabilityValue('clevertouch_heat_mode', mode).catch(this.error);

    // Target temperature based on mode
    const tempFieldMap = {
      'Frost': 'consigne_hg',
      'Eco': 'consigne_eco',
      'Comfort': 'consigne_confort',
      'Boost': 'consigne_boost',
    };
    
    if (tempFieldMap[mode]) {
      const targetTemp = parseInt(data[tempFieldMap[mode]]) / 10;
      await this.setCapabilityValue('target_temperature', targetTemp).catch(this.error);
    }

    // Heating active
    const isHeating = data.heating_up === '1';
    await this.setCapabilityValue('clevertouch_heating_active', isHeating).catch(this.error);

    // Boost remaining (if in boost mode)
    if (data.time_boost_format_chrono) {
      const chrono = data.time_boost_format_chrono;
      const remainingMinutes = 
        parseInt(chrono.d || 0) * 24 * 60 +
        parseInt(chrono.h || 0) * 60 +
        parseInt(chrono.m || 0);
      
      if (this.hasCapability('clevertouch_boost_remaining')) {
        await this.setCapabilityValue('clevertouch_boost_remaining', remainingMinutes).catch(this.error);
      }
    }
  }

  async onTargetTemperature(value) {
    const api = this.homey.app.getApi();
    const { homeId, idLocal } = this.getData();
    const mode = this.getCapabilityValue('clevertouch_heat_mode');
    
    const tempTypeMap = {
      'Frost': 'frost',
      'Eco': 'eco',
      'Comfort': 'comfort',
      'Boost': 'boost',
    };
    
    const tempType = tempTypeMap[mode];
    if (!tempType) {
      throw new Error('Cannot set temperature in current mode');
    }

    await api.setTemperature(homeId, idLocal, tempType, value);
    await this._requestQuickPoll();
  }

  async onHeatModeChange(value) {
    const api = this.homey.app.getApi();
    const { homeId, idLocal } = this.getData();
    
    await api.setHeatMode(homeId, idLocal, value);
    await this._requestQuickPoll();
  }

  async activateBoost(durationMinutes, temperature) {
    const api = this.homey.app.getApi();
    const { homeId, idLocal } = this.getData();
    
    // Set boost temperature if provided
    if (temperature) {
      await api.setTemperature(homeId, idLocal, 'boost', temperature);
    }
    
    // Activate boost mode
    await api.setHeatMode(homeId, idLocal, 'Boost');
    await this._requestQuickPoll();
  }
}

module.exports = RadiatorDevice;
```

---

## Settings Screen Design

For app-level settings (account configuration):

```json
// .homeycompose/app.json
{
  "settings": [
    {
      "type": "group",
      "label": { "en": "Account" },
      "children": [
        {
          "id": "model_id",
          "type": "dropdown",
          "label": { "en": "Brand" },
          "value": "purmo",
          "values": [
            { "id": "purmo", "label": { "en": "Purmo CleverTouch" } },
            { "id": "waltermeier", "label": { "en": "Walter Meier Smart-Comfort" } },
            { "id": "frico", "label": { "en": "Frico FP Smart" } },
            { "id": "fenix", "label": { "en": "Fenix V24 Wifi" } },
            { "id": "vogelundnoot", "label": { "en": "Vogel & Noot E3" } },
            { "id": "cordivari", "label": { "en": "Cordivari My Way" } }
          ]
        },
        {
          "id": "email",
          "type": "text",
          "label": { "en": "Email" },
          "value": ""
        }
      ]
    }
  ]
}
```

---

## Polling Strategy

| Scenario | Interval | Notes |
|----------|----------|-------|
| Normal operation | 180 seconds | Default polling |
| After user action | 15 seconds | Quick refresh |
| Quick poll count | 3 | Number of quick polls |
| Error backoff | Exponential | Min 60s, max 1800s |
