# CleverTouch Analysis Plan for Homey App Development

## Overview

This plan outlines the analysis of the `hass-clevertouch` Home Assistant integration to understand its architecture, API communication, and data models. The goal is to extract knowledge needed to build a similar Homey app for CleverTouch radiators.

## Source Reference

- **Source**: `./source/hass-clevertouch/`
- **External API Library**: `clevertouch` (PyPI package from https://github.com/hemphen/clevertouch)
- **Documentation Output**: `./clevertouch/`

---

## Analysis Tasks

### Phase 1: API & Authentication Analysis

| ID | Task | Output Document | Status |
|----|------|-----------------|--------|
| 1.1 | Analyze authentication flow (username/password → token) | `clevertouch/docs/01-authentication.md` | ✅ |
| 1.2 | Document API endpoints and hosts for different brands | `clevertouch/docs/02-api-endpoints.md` | ✅ |
| 1.3 | Analyze token refresh mechanism | `clevertouch/docs/01-authentication.md` | ✅ |
| 1.4 | Review external `clevertouch` Python library (GitHub) | `clevertouch/docs/03-api-library-analysis.md` | ✅ |

### Phase 2: Data Model Analysis

| ID | Task | Output Document | Status |
|----|------|-----------------|--------|
| 2.1 | Document Account/User/Home hierarchy | `clevertouch/docs/04-data-model.md` | ✅ |
| 2.2 | Document Device types (Radiator, OnOffDevice) | `clevertouch/docs/04-data-model.md` | ✅ |
| 2.3 | Analyze temperature handling (units, precision, min/max) | `clevertouch/docs/04-data-model.md` | ✅ |
| 2.4 | Document heat modes and their behavior | `clevertouch/docs/05-capabilities-mapping.md` | ✅ |

### Phase 3: Capabilities Mapping (HA → Homey)

| ID | Task | Output Document | Status |
|----|------|-----------------|--------|
| 3.1 | Map HA Climate entity → Homey thermostat capabilities | `clevertouch/docs/05-capabilities-mapping.md` | ✅ |
| 3.2 | Map HA Sensor entities → Homey measure capabilities | `clevertouch/docs/05-capabilities-mapping.md` | ✅ |
| 3.3 | Map HA Switch entities → Homey onoff capability | `clevertouch/docs/05-capabilities-mapping.md` | ✅ |
| 3.4 | Map HA Number entities → Homey settings/capabilities | `clevertouch/docs/05-capabilities-mapping.md` | ✅ |

### Phase 4: Homey App Architecture Design

| ID | Task | Output Document | Status |
|----|------|-----------------|--------|
| 4.1 | Design Homey app structure | `clevertouch/docs/06-homey-app-design.md` | ✅ |
| 4.2 | Define pairing flow for Homey | `clevertouch/docs/06-homey-app-design.md` | ✅ |
| 4.3 | Design polling/refresh strategy | `clevertouch/docs/06-homey-app-design.md` | ✅ |
| 4.4 | Plan Flow card triggers/actions/conditions | `clevertouch/docs/07-flow-cards.md` | ✅ |

---

## Key Findings from Initial Analysis

### Supported Brands/Hosts
From `const.py`, the integration supports multiple brands with different API hosts:

| Brand | App Name | API Host | Controller |
|-------|----------|----------|------------|
| Purmo | CleverTouch | e3.lvi.eu | Touch E3 |
| Walter Meier | Smart-Comfort | www.smartcomfort.waltermeier.com | Metalplast Smart-Comfort |
| Frico | Frico FP Smart | fricopfsmart.frico.se | Central Unit |
| Fenix | Fenix V24 Wifi | v24.fenixgroup.eu | Smart Home Controller |
| Vogel & Noot | Vogel & Noot E3 | e3.vogelundnoot.com | Touch E3 |
| Cordivari | Cordivari My Way | cordivarihome.com | My Way |

### Authentication Flow
1. User provides email + password + model/brand selection
2. `ApiSession.authenticate(username, password)` returns a refresh token
3. Token is stored and used for subsequent API calls
4. Token refresh happens automatically and is persisted

### Entity Types Created
- **Climate** (Radiator devices) - temperature control, preset modes
- **Sensor** - read-only temperature sensors, boost time remaining
- **Switch** - on/off devices (outlets, switches)
- **Number** - writable temperature settings, boost time preset

### Data Hierarchy
```
Account (email + token)
  └── User
        └── Homes[] (home_id)
              └── Devices[] (device_id)
                    └── Zones (zone.label)
```

### Temperature Settings
- Unit: Celsius
- Step: 0.5°C
- Min: 5°C
- Max: 30°C
- Precision: 0.1°C

### Heat Modes
- Off
- Frost
- Comfort
- Program
- Eco
- Boost (with duration)

### Polling Strategy
- Standard interval: 180 seconds (3 min)
- Quick interval after changes: 15 seconds
- Quick update count: 3 updates
- Backoff on errors: 60-1800 seconds

---

## Output Directory Structure

```
clevertouch/
├── docs/
│   ├── 01-authentication.md
│   ├── 02-api-endpoints.md
│   ├── 03-api-library-analysis.md
│   ├── 04-data-model.md
│   ├── 05-capabilities-mapping.md
│   ├── 06-homey-app-design.md
│   └── 07-flow-cards.md
├── api/
│   └── clevertouch-api.js       # JavaScript API client (when ready)
├── drivers/
│   └── radiator/                # Homey driver (when ready)
└── README.md                    # App overview
```

---

## Next Steps

1. **Capture live API traffic** - Skip for now.
2. **Homey SDK constraints review** - Done (documented in `clevertouch/docs/06-homey-app-design.md`).

---

## Dependencies

- Need to examine `clevertouch` Python package source code from https://github.com/hemphen/clevertouch (done)
- Homey SDK documentation reference for capability mapping (done)
- May need to capture actual API traffic for complete endpoint documentation (skipped for now)

---

## Notes

- IoT Class: `cloud_polling` - no local API, requires internet connection
- No official API documentation exists - reverse-engineered from mobile apps
- Multiple brands use the same API with different hostnames
