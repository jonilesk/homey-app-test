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

### lib/CleverTouchOAuth2Client.js

```javascript
'use strict';

const { OAuth2Client, OAuth2Token } = require('homey-oauth2app');
const fetch = require('node-fetch');

// Brand configuration...
const BRAND_CONFIG = {
  'purmo': { host: 'e3.lvi.eu', realm: 'purmo' },
  // ...
};

class CleverTouchOAuth2Client extends OAuth2Client {

  static CLIENT_ID = 'app-front';

  // Handle password grant authentication
  async onGetTokenByCredentials({ username, password }) {
    // ... custom token fetch logic ...
    
    // Validate response and return OAuth2Token
    return new OAuth2Token({
       access_token: tokenData.access_token,
       // ...
    });
  }
  
  // Custom API wrapper handling exit codes (Code 8 = Success)
  async _apiCall(method, path, data) {
    // ... retry logic with jitter ...
  }
  
  async getDevices(homeId) {
    // ... implementation ...
  }
}

module.exports = CleverTouchOAuth2Client;
```

---

## Main App (app.js)

```javascript
'use strict';

const { OAuth2App } = require('homey-oauth2app');
const CleverTouchOAuth2Client = require('./lib/CleverTouchOAuth2Client');

class CleverTouchApp extends OAuth2App {

  static OAUTH2_CLIENT = CleverTouchOAuth2Client;
  static OAUTH2_DEBUG = true;

  async onOAuth2Init() {
    this.log('CleverTouch OAuth2 app initializing...');
    
    // Register flow cards
    this._registerFlowCards();
  }

  _registerFlowCards() {
    // Action: Set heat mode
    this.homey.flow.getActionCard('set_heat_mode')
      .registerRunListener(async (args) => {
        // ... (implementation)
        await args.device.setCapabilityValue('clevertouch_heat_mode', args.mode);
      });
      
    // ... (other cards)
  }
}

module.exports = CleverTouchApp;
```

---

## Pairing Flow Design

### List Devices Strategy

```javascript
// driver.js

const { OAuth2Driver } = require('homey-oauth2app');

class RadiatorDriver extends OAuth2Driver {
  
  // Important: Must call super.onInit()
  async onInit() {
    await super.onInit();
  }

  async onPairListDevices({ oAuth2Client }) {
    if (!oAuth2Client) throw new Error('No OAuth2 Client');

    const email = oAuth2Client._email || this.homey.settings.get('clevertouch_email');
    const userData = await oAuth2Client.getUser(email);
    
    const devices = [];
    
    for (const home of userData.smarthomes) {
      const homeData = await oAuth2Client.getHome(home.smarthome_id);
      
      // Build zone map
      const zoneMap = {};
      (homeData.zones || []).forEach(z => zoneMap[z.num_zone] = z.zone_label);

      for (const device of homeData.devices) {
        const id = device.id_device?.toUpperCase();

        // Filter: Exclude Lights (L) and Outlets (P)
        if (id.startsWith('L') || id.startsWith('P')) continue;

        // Smart Naming: Zone Name + Device Label
        const zoneName = zoneMap[device.num_zone] || '';
        const name = zoneName ? `${zoneName} ${device.label_interface}` : device.label_interface;

        devices.push({
          name: name,
          data: {
            id: `${home.smarthome_id}_${device.id_device}`,
            homeId: home.smarthome_id,
            deviceLocalId: device.id_device
          },
          store: {
            homeName: home.label,
            zoneName: zoneName,
            // CRITICAL: Cache OAuth2 session IDs
            OAuth2SessionId: oAuth2Client._sessionId,
            OAuth2ConfigId: oAuth2Client._configId
          }
        });
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

const { OAuth2Device } = require('homey-oauth2app');

const POLL_INTERVAL = 180000; // 3 minutes
const QUICK_POLL_INTERVAL = 15000; // 15 seconds
const QUICK_POLL_COUNT = 3;

class RadiatorDevice extends OAuth2Device {
  async onOAuth2Init() {
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
