# Dreame Vacuum Homey App — Implementation Log

**App ID:** `tech.dreame.vacuum`  
**Version:** 1.0.0  
**Date:** 2025-02-10  
**Plan:** `dreame/dreame-app-for-homey.md` (rev 2)

---

## Phase 0: Plan Review & Fixes

### Issues Found in Original Plan

| # | Severity | Issue | Fix Applied |
|---|----------|-------|-------------|
| 1 | **CRITICAL** | §4.4 Signature used HMAC-SHA256; actual protocol uses plain SHA-1 | Replaced with `sha1(METHOD + \n + url_path + \n + sorted_params + \n + signedNonce)` |
| 2 | HIGH | Fixed 12-byte nonce; real implementation uses variable-length time encoding | Updated to match Python `bit_length()` logic |
| 3 | HIGH | Missing vacuum state enums 10, 11, 14 | Added `returning_washing`, `building`, `upgrading` |
| 4 | MEDIUM | No shared-home device discovery | Added `v2/user/get_device_cnt` call + MAC dedup |
| 5 | MEDIUM | OpenSSL 3.x rejects legacy RC4 | Added pure-JS RC4 fallback with `_rc4()` |
| 6 | LOW | `node-fetch` listed as dependency | Removed; using native `fetch` (Node 18+) |
| 7 | LOW | `dreame_status` capability missing values for drying/upgrading | Added all 14 enum values |
| 8 | LOW | No `alarm_generic` or `vacuumcleaner_state` capabilities mentioned | Noted as future enhancement |
| 9 | LOW | Wrong URL transform in signature | Fixed to `url.split('com')[1].replace('/app/', '/')` |

All fixes applied to plan document before implementation began.

---

## Phase 1: Project Scaffold

### Created Files

```
dreame-app/
├── package.json                    — Minimal: no dependencies, node >=18
├── .gitignore                      — node_modules, .homeybuild, env.*
├── .homeycompose/
│   └── app.json                    — App metadata, sdk:3, platforms:["local"]
└── assets/
    └── icon.svg                    — Placeholder blue circle with robot icon
```

### Decisions
- **No dependencies**: Native `fetch`, native `crypto`, pure-JS RC4 fallback
- **platforms: ["local"]** only — no Homey Cloud support in v1
- **EU region hardcoded** (`de.api.io.mi.com`) — multi-region is a future enhancement

---

## Phase 2: Capabilities & Flow Cards

### Custom Capabilities (4)

| Capability | Type | Settable | Values |
|-----------|------|----------|--------|
| `dreame_status` | enum | No (read-only) | 14 values: idle, sweeping, mopping, sweeping_and_mopping, paused, returning, charging, charging_completed, error, drying, washing, returning_washing, building, upgrading |
| `dreame_fan_speed` | enum | Yes (picker) | quiet, standard, strong, turbo |
| `dreame_clean_mode` | enum | Yes (picker) | sweeping, mopping, sweeping_and_mopping |
| `dreame_water_flow` | enum | Yes (picker) | low, medium, high |

### Standard Capabilities Used
- `onoff` — Maps to start/stop cleaning
- `measure_battery` — Battery percentage (0–100)

### Flow Cards (14 total)

| Type | ID | Notes |
|------|----|-------|
| Trigger | `cleaning_started` | Fires when state enters CLEANING_STATES |
| Trigger | `cleaning_finished` | Fires when state leaves CLEANING_STATES to idle/charging |
| Trigger | `error_occurred` | Fires when status === "error" |
| Trigger | `returned_to_dock` | Fires on state → charging/charging_completed |
| Condition | `is_cleaning` | Checks CLEANING_STATES set |
| Condition | `is_charging` | Checks CHARGING_STATES set |
| Condition | `fan_speed_is` | Dropdown comparison |
| Action | `start_cleaning` | Calls ACTION.START (SIID 4, AIID 1) |
| Action | `stop_cleaning` | Calls ACTION.STOP (SIID 4, AIID 3) |
| Action | `pause_cleaning` | Calls ACTION.PAUSE (SIID 4, AIID 2) |
| Action | `return_to_dock` | Calls ACTION.CHARGE (SIID 3, AIID 1) |
| Action | `set_fan_speed` | Calls setProperty SIID 4, PIID 4 |
| Action | `set_clean_mode` | Calls setProperty SIID 18, PIID 6 |
| Action | `locate` | Calls ACTION.LOCATE (SIID 17, AIID 1) |

All cards have English + Finnish translations.

---

## Phase 3: Core Libraries

### lib/MiOTProperties.js
- Complete SIID/PIID/AIID constant maps for Dreame vacuum
- State enum mapping (1→idle, 2→sweeping, etc.)
- Forward + reverse maps for suction level, cleaning mode, water volume
- POLL_PROPERTIES array (10 properties to poll each cycle)

### lib/MiCloudClient.js (~400 lines)
- **Authentication**: 3-step Xiaomi login flow
  1. GET `/serviceLogin` → extract `_sign`, `_callback`, `sid`
  2. POST `/serviceLoginAuth2` with MD5(password) → get `ssecurity`, `location`
  3. GET `location` URL → extract `serviceToken` from cookies
- **RC4 Encryption**: 
  - `generateNonce()` — variable-length time encoding
  - `signedNonce()` — SHA-256(base64(ssecurity) + base64(nonce))
  - `encryptRC4()` / `decryptRC4()` — 1024-byte keystream skip, IV=null
  - `_rc4()` — pure JavaScript fallback for OpenSSL 3.x
  - `generateEncSignature()` — SHA-1 hash (correct param order)
- **Device Discovery**: 
  - Own-home devices via `v2/homeroom/gethome`
  - Shared-home devices via `v2/user/get_device_cnt`
  - Per-home device list via `v2/home/home_device_list`
  - Fallback: `home/device_list` (all devices)
  - MAC-based deduplication
- **MiOT RPC**: `getProperties()` (batched ≤15), `setProperty()`, `callAction()`
- **Session**: Persist to Homey settings, restore on app start, dual-purpose `checkLogin()`
- **Retry**: 3 attempts, linear backoff + jitter, 10s timeout per request

### Key Design Decisions
- No `homey-oauth2app` — Xiaomi auth uses cookie-based session, not OAuth2
- Shared `MiCloudClient` instance stored on `this.homey.app.miCloud`
- Session persisted as single `authKey` string: `"serviceToken ssecurity userId clientId"`

---

## Phase 4: App & Driver

### app.js
- Creates shared `MiCloudClient` instance
- Restores session from `this.homey.settings.get('xiaomi_auth')`
- Registers all 14 flow card `runListener` callbacks
- Condition cards delegate to `CLEANING_STATES.has()` / `CHARGING_STATES.has()`
- Action cards delegate to device methods (e.g., `args.device.startCleaning()`)

### drivers/vacuum/driver.js
- Pairing: `login_credentials` → `list_devices` → `add_devices`
- Login handler: calls `miCloud.login(username, password)`
- List devices handler: calls `miCloud.getDevices()`, filters `dreame.vacuum.*`
- Device data: `{ id, mac, model }` in `data`, `{ token, localIp, uid }` in `store`

### drivers/vacuum/device.js (~280 lines)
- **Polling**: 120s interval with 0-20s initial jitter
- **Quick-poll**: 15s × 5 polls after any command
- **State mapping**: MiOT property values → capability values via lookup maps
- **State transitions**: Tracks previous state, fires appropriate flow triggers
- **Capability listeners**: `onoff`, `dreame_fan_speed`, `dreame_clean_mode`, `dreame_water_flow`
- **Fail-soft**: 3 consecutive poll failures → `setUnavailable()`; recovery on next success
- **Public methods**: `startCleaning()`, `stopCleaning()`, `pauseCleaning()`, `returnToDock()`, `setFanSpeed()`, `setCleanMode()`, `locate()`

---

## Phase 5: Localization

- `locales/en.json` — Pair error messages, device unavailable text
- `locales/fi.json` — Finnish translations
- All capability values have inline `en` + `fi` translations in compose files

---

## Validation Results

```
✓ homey app build — SUCCESS
✓ homey app validate --level debug — SUCCESS
  - 14 flow cards registered
  - 1 driver (vacuum) registered
  - 4 custom capabilities registered
  - 709-line composed app.json generated
```

---

## File Inventory (24 source files)

```
dreame-app/
├── .gitignore
├── .homeycompose/
│   ├── app.json
│   ├── capabilities/
│   │   ├── dreame_clean_mode.json
│   │   ├── dreame_fan_speed.json
│   │   ├── dreame_status.json
│   │   └── dreame_water_flow.json
│   └── flow/
│       ├── actions/
│       │   ├── locate.json
│       │   ├── pause_cleaning.json
│       │   ├── return_to_dock.json
│       │   ├── set_clean_mode.json
│       │   ├── set_fan_speed.json
│       │   ├── start_cleaning.json
│       │   └── stop_cleaning.json
│       ├── conditions/
│       │   ├── fan_speed_is.json
│       │   ├── is_charging.json
│       │   └── is_cleaning.json
│       └── triggers/
│           ├── cleaning_finished.json
│           ├── cleaning_started.json
│           ├── error_occurred.json
│           └── returned_to_dock.json
├── app.js
├── app.json                         (generated — do not edit)
├── assets/
│   ├── icon.png                    (250x175 - app small)
│   ├── icon_large.png               (500x350 - app large)
│   └── icon.svg                     (fallback for debug validation)
├── drivers/
│   └── vacuum/
│       ├── assets/
│       │   ├── icon.png             (75x75 - driver small)
│       │   ├── icon_large.png       (500x500 - driver large)
│       │   └── icon.svg             (fallback for debug validation)
│       ├── device.js
│       ├── driver.compose.json
│       └── driver.js
├── lib/
│   ├── MiCloudClient.js
│   └── MiOTProperties.js
├── locales/
│   ├── en.json
│   └── fi.json
└── package.json
```

---

## Known Limitations (v1)

1. **EU region only** — `de.api.io.mi.com` hardcoded; CN/US/SG users need multi-region support
2. **No room/zone cleaning** — only whole-house start/stop in v1
3. **No map display** — Homey has no native map widget
4. **No unit tests** — RC4 crypto should be tested against known values from Python HA integration
5. **No Homey Cloud support** — `platforms: ["local"]` only
6. **Polling only** — no push notifications from Xiaomi Cloud (not available in MiOT API)

---

## Icons

Icons sourced from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum/tree/master/docs/media):
- `robot_idle.png` → App icon (idle state robot)
- `robot_active.png` → Driver icon (active state robot)

Resized to Homey requirements:
- App small: 250×175
- App large: 500×350
- Driver small: 75×75
- Driver large: 500×500

---

## Next Steps

- [ ] Test with real Dreame vacuum + Xiaomi account
- [ ] Add multi-region support (settings page)
- [ ] Add room/zone cleaning (SIID 4, AIID 4 with room params)
- [ ] Add consumable tracking (filter hours, brush life, etc.)
- [ ] Add `alarm_generic` capability for error states
- [ ] Unit test RC4 encryption against Python reference values
- [ ] Publish to Homey App Store
