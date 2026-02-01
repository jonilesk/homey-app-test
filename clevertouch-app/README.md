# CleverTouch Homey App

Control CleverTouch radiators, lights, and outlets from Homey Pro.

## Current Status - Phase 2 Complete 🎉

✅ **Phase 1: App Scaffold & API Client - COMPLETE**
- [x] Created app structure with Homey Compose
- [x] Implemented OAuth2Client class with CleverTouch API integration
- [x] Created app.js extending OAuth2App
- [x] Defined custom capabilities (heat_mode, heating_active, boost_remaining)
- [x] Set up dependencies (homey-oauth2app@3.7.2, node-fetch@2.6.9)
- [x] Configured package.json and app.json

✅ **Phase 2: Radiator Driver - COMPLETE**
- [x] Created radiator driver scaffold
- [x] Implemented pairing flow (login → list devices from all homes)
- [x] Registered standard capabilities (measure_temperature, target_temperature)
- [x] Custom capabilities (clevertouch_heat_mode, clevertouch_heating_active, clevertouch_boost_remaining)
- [x] Implemented capability setters with dynamic temperature type selection
- [x] Implemented polling with jitter (180s normal, 15s quick after changes)
- [x] Added device settings (comfort/eco/frost temperatures with onSettings handler)
- [x] Device lifecycle methods (onInit, onUninit, onDeleted, onSettings)
- [x] Created flow cards (triggers, conditions, actions)
- [x] Added locales (en.json, fi.json)
- [x] Placeholder icons added

## Architecture

**OAuth2 Strategy:** Using `homey-oauth2app` (v3.7.2)
- Automatic token lifecycle management
- Built-in token refresh
- App extends `OAuth2App`
- Devices will extend `OAuth2Device`

**Brand Selection:** App-wide
- Brand selected during first device pairing
- Stored in `homey.settings` as `model_id`
- Supports: Purmo, Frico, Fenix

## Project Structure

```
clevertouch-app/
├── app.js                                  ✅ OAuth2App entry point
├── app.json                                ✅ Root manifest
├── package.json                            ✅ Dependencies configured
├── .gitignore                              ✅ Git ignore file
├── lib/
│   └── CleverTouchOAuth2Client.js          ✅ OAuth2 client with API methods
├── .homeycompose/
│   ├── app.json                            ✅ Full app metadata
│   ├── capabilities/                       ✅ Custom capabilities defined
│   │   ├── clevertouch_heat_mode.json
│   │   ├── clevertouch_heating_active.json
│   │   └── clevertouch_boost_remaining.json
│   └── flow/                               ✅ Flow cards defined
│       ├── triggers.json
│       ├── conditions.json
│       └── actions.json
├── drivers/
│   └── radiator/                           ✅ Radiator driver complete
│       ├── driver.js                       ✅ Pairing logic
│       ├── device.js                       ✅ Device runtime with polling
│       ├── driver.compose.json             ✅ Driver manifest
│       └── assets/
│           └── icon.svg                    ✅ Driver icon
├── locales/                                ✅ Translations
│   ├── en.json
│   └── fi.json
├── assets/
│   └── icon.svg                            ✅ App icon
└── node_modules/                           ✅ Dependencies installed
```

## Next Steps - Ready for Testing!

📋 **Phase 3: Light & Outlet Drivers** (Optional)
- Light driver (class: light, capability: onoff)
- Outlet driver (class: socket, capability: onoff)
- Reuse pairing flow from radiator

⚡ **Testing & Deployment**
1. Install Homey CLI: `npm install -g homey`
2. Build app: `homey app build`
3. Validate: `homey app validate --level debug`
4. Test on Homey Pro: `homey app run`
5. Verify pairing flow works
6. Test temperature and mode control
7. Verify polling updates values
8. Test flow cards
9. Long-running stability test (24h+)

🎯 **Known Limitations**
- OAuth2 login credentials template is built-in (no custom HTML)
- Brand selection happens during first pairing (app-wide)
- API field names need verification (current_temp, gv_mode, etc.)
- Boost end time tracking requires API support for `boost_ends_at` field

## Dependencies

- `homey-oauth2app@^3.7.2` - OAuth2 framework
- `node-fetch@^2.6.9` - HTTP client
- `homey@^3.0.0` - (devDependency) SDK v3

## API Client Features

The `CleverTouchOAuth2Client` includes:
- ✅ Dynamic API base URL based on brand (Purmo/Frico/Fenix)
- ✅ Automatic token management via OAuth2App
- ✅ Retry logic with exponential backoff
- ✅ 10-second request timeout with AbortController
- ✅ User and home data fetching
- ✅ Device mode control (Off/Frost/Eco/Comfort/Program/Boost)
- ✅ Temperature preset management

## Development

### Prerequisites
- Node.js >= 18
- Homey CLI (for build & validation): `npm install -g homey`

### Build
```bash
cd clevertouch-app
npm install
homey app build      # Generates final app.json from .homeycompose
homey app validate --level debug
```

### Install on Homey
```bash
homey app run
```

## Implementation Plan

See [implementation-plan.md](../clevertouch/implementation-plan.md) for full details.

## Custom Capabilities

### clevertouch_heat_mode
- Type: enum
- Values: Off, Frost, Eco, Comfort, Program, Boost
- Getable/Setable
- UI: picker

### clevertouch_heating_active
- Type: boolean
- Indicates if radiator is actively heating
- Getable only
- UI: sensor

### clevertouch_boost_remaining
- Type: number
- Units: minutes
- Range: 0-180
- Getable only
- UI: sensor

## Radiator Driver Features

### Intelligent Polling
- **Normal interval**: 180 seconds (3 minutes)
- **Quick polling**: 15 seconds after changes, 3 times
- **Jitter**: 0-30 seconds on init to avoid thundering herd

### Dynamic Temperature Control
Temperature setter automatically selects the correct preset based on current mode:
- Comfort mode → Updates comfort temperature
- Eco mode → Updates eco temperature
- Frost mode → Updates frost temperature
- Program/Boost/Off → Defaults to comfort temperature

### Device Settings
Users can configure temperature presets in device settings:
- Comfort temperature (5-30°C, step 0.5)
- Eco temperature (5-30°C, step 0.5)
- Frost protection temperature (5-15°C, step 0.5)

Changes are automatically synced to the device via API.

### Flow Cards

**Triggers:**
- Boost mode ended

**Conditions:**
- Is heating
- Heat mode is [mode]

**Actions:**
- Set heat mode to [mode]
- Start boost mode

## License

MIT
