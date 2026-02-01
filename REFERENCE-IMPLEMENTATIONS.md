# Reference Implementations

This directory contains complete example implementations demonstrating various Homey app patterns.

## CleverTouch App - OAuth2 Cloud-Connected Radiators

**Location:** `clevertouch-app/`

**Type:** OAuth2-based cloud-connected thermostat app

**Demonstrates:**
- ✅ OAuth2 authentication with `homey-oauth2app`
- ✅ Cloud API integration with retry logic and timeouts
- ✅ Thermostat device with temperature control
- ✅ Custom enum capability (heat modes)
- ✅ Polling strategy with jitter (180s normal, 15s quick)
- ✅ Dynamic temperature type selection based on mode
- ✅ Device settings synced to cloud API
- ✅ Complete device lifecycle (init, uninit, deleted, settings)
- ✅ Flow cards (triggers, conditions, actions)
- ✅ Multi-language support (English, Finnish)
- ✅ AbortController for request timeouts
- ✅ Exponential backoff with jitter for retries

**Key Files:**
- `lib/CleverTouchOAuth2Client.js` - OAuth2 client implementation
- `drivers/radiator/device.js` - Complete device implementation (276 lines)
- `drivers/radiator/driver.js` - Pairing flow with device discovery
- `.homeycompose/capabilities/` - Custom capability definitions

**Documentation:**
- [Implementation Plan](clevertouch/implementation-plan.md) - Complete planning document
- [README](clevertouch-app/README.md) - Project overview and features

**Use as template when building:**
- Cloud-connected thermostats or climate devices
- Any OAuth2-based integrations
- Devices requiring polling with cloud APIs
- Apps with custom enum capabilities (modes, presets)
- Multi-language Homey apps

---

## Adding Your Reference Implementation

When you create a new example app that demonstrates valuable patterns:

1. Create a dedicated directory (e.g., `your-app/`)
2. Include comprehensive README.md
3. Document key patterns used
4. Add entry to this file
5. Link from relevant docs (e.g., `13-oauth2-cloud-devices.md`)

**Good candidates for reference implementations:**
- Local network devices (Zigbee, Z-Wave, local HTTP)
- Webhook/push notification integrations
- Timer/scheduler apps (no devices)
- Multi-driver apps (different device types)
- Apps with complex settings/configuration
