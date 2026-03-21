# KEBA KeContact — Homey App

Control and monitor KEBA KeContact EV chargers (P20, P30, BMW Wallbox) via local LAN using the UDP protocol on port 7090. Integrates with Homey Energy for power and energy tracking.

## Supported Chargers

| Manufacturer | Model | Meter | Display | Auth (RFID) | Phase Switch |
|---|---|---|---|---|---|
| KEBA | P30 | ✅ | ✅ | ✅ | ✅ |
| KEBA | P30-DE | ❌ | ❌ | ✅ | ✅ |
| KEBA | P20 (b/c-series) | ✅ | ❌ | per variant | ✅ |
| KEBA | P20 (e-series) | ❌ | ❌ | per variant | ✅ |
| BMW | Wallbox Connect | ✅ | ❌ | ✅ | ❌ |
| BMW | Wallbox Plus | ✅ | ❌ | ✅ | ❌ |

Features are auto-detected from the charger's product string during pairing.

## Installation

```bash
cd keba-app
npm install
```

### Requirements

- Homey Pro (2023) with firmware ≥ 12.0.0
- KEBA KeContact charger on the same local network
- Charger UDP interface enabled (default on port 7090)

## CLI Tools

Test tools for validating UDP communication before deploying to Homey.

### Discover Chargers

```bash
npm run discover
# or with options:
node cli/discover.js --broadcast 192.168.1.255 --timeout 5000
```

**Options:**
- `-b, --broadcast <address>` — Broadcast address (default: `255.255.255.255`)
- `-t, --timeout <ms>` — Discovery timeout (default: `3000`)

### Read Status

```bash
node cli/read-status.js --host 192.168.1.50
node cli/read-status.js --host 10.1.1.13 --save  # Save raw JSON to test_data/
```

**Options:**
- `-H, --host <ip>` — Charger IP address (required)
- `-s, --save` — Save raw JSON responses to `test_data/`
- `-t, --timeout <ms>` — Response timeout (default: `5000`)

### Continuous Monitor

```bash
node cli/monitor.js --host 192.168.1.50 --interval 10
```

**Options:**
- `-H, --host <ip>` — Charger IP address (required)
- `-i, --interval <seconds>` — Poll interval (default: `30`)
- `-t, --timeout <ms>` — Response timeout (default: `5000`)

Only changed values are displayed after the initial reading.

## Pairing

1. Open the Homey app → Devices → Add Device → KEBA KeContact
2. Enter the charger's IP address (e.g., `192.168.1.50`)
3. Serial number is optional — auto-detected from Report 1
4. The app verifies connectivity and detects the charger model
5. Device is created with capabilities matching the detected model features

## Capabilities

### Always Available

| Capability | Type | Description |
|---|---|---|
| `onoff` | boolean | Enable/disable charging |
| `keba_charging_state` | enum | starting, not_ready, ready, charging, error, auth_rejected |
| `keba_cable_state` | enum | no_cable, cable_cs, cable_locked, cable_ev, cable_locked_ev |
| `keba_current_limit` | number (slider) | User-settable current limit, 6–63 A |
| `keba_max_current` | number | System maximum current (read-only) |

### Meter Models Only (P30, BMW, P20 b/c-series)

| Capability | Type | Description |
|---|---|---|
| `measure_power` | number | Instantaneous charging power in W |
| `meter_power` | number | Cumulative total energy in kWh |
| `meter_power.session` | number | Current session energy in kWh |
| `measure_current.phase1/2/3` | number | Per-phase current in A |
| `measure_voltage.phase1/2/3` | number | Per-phase voltage in V |
| `keba_power_factor` | number | Power factor (0–1) |

## Device Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `host` | text | — | Charger IP address |
| `poll_interval` | number | 30 | Poll interval in seconds (min 10, max 300) |

## Flow Cards

### Triggers

| Card | Tokens | Description |
|---|---|---|
| Charging started | power (W) | When charger begins actively charging |
| Charging stopped | energy (kWh) | When charging ends |
| Car connected | — | When EV is plugged in |
| Car disconnected | — | When EV is unplugged |
| Charging state changed | state | On any state change |
| Charger error occurred | details | When charger reports error |

### Conditions

| Card | Description |
|---|---|
| Is currently charging | True when state = charging |
| Is car connected | True when cable is connected to EV |

### Actions

| Card | Arguments | Description |
|---|---|---|
| Set charging current | current (6–63 A) | Set max charging current |
| Set session energy limit | energy (0–100 kWh) | Limit session energy (0 = disable) |
| Enable charging | — | Enable the charger |
| Disable charging | — | Disable the charger |

## Homey Energy Integration

The app registers as device class `evcharger` with cumulative energy tracking:
- `measure_power` — real-time power consumption shown in Energy dashboard
- `meter_power` — cumulative imported energy for historical tracking

## Architecture

```
keba-app/
├── app.js                        # Homey.App — UDP client init, flow card registration
├── app.json                      # Generated manifest (do not edit)
├── package.json
├── .homeycompose/
│   ├── app.json                  # App manifest source-of-truth
│   ├── capabilities/             # 5 custom capability definitions
│   └── flow/
│       ├── triggers/             # 6 trigger cards
│       ├── conditions/           # 2 condition cards
│       └── actions/              # 4 action cards
├── drivers/keba/
│   ├── driver.js                 # Pairing flow (IP entry → Report 1 → model detection)
│   ├── device.js                 # Polling, capability updates, command handlers
│   ├── driver.compose.json       # Driver manifest with capabilities, energy, settings
│   └── assets/images/            # Driver images
├── lib/
│   ├── KebaUdpClient.js          # Singleton UDP socket (port 7090, send queue, discovery)
│   ├── KebaDataParser.js         # Report 2/3 parsing, state decoding, data scaling
│   └── KebaDeviceInfo.js         # Product string parsing, feature detection
├── cli/
│   ├── discover.js               # UDP broadcast discovery
│   ├── read-status.js            # One-shot report reader
│   └── monitor.js                # Continuous polling monitor
├── locales/en.json               # English translations
└── assets/
    ├── icon.svg                  # App icon (960×960)
    └── images/                   # App store images
```

### Component Overview

| Component | Description |
|---|---|
| **KebaUdpClient** | Singleton UDP socket on port 7090. Serialized sends with 100ms minimum spacing. Routes incoming datagrams to registered devices by source IP. Supports broadcast discovery. |
| **KebaDataParser** | Parses Report 2 (status) and Report 3 (metering) JSON. Applies KEBA scaling factors: currents ÷1000 (mA→A), energy ÷10000 (0.1Wh→kWh), power ÷1000000 (µW→kW). |
| **KebaDeviceInfo** | Parses product strings (e.g., `KC-P30-ES230001-00R`) to determine manufacturer, model, and feature flags. |
| **device.js** | Polls Report 2 + Report 3 on interval with jitter. Updates capabilities only on value change. Fires flow triggers on state transitions. Marks device unavailable after 5 consecutive failures. Quick-polls (15s × 3) after user commands. |

## UDP Protocol

| Command | Response | Description |
|---|---|---|
| `i` (broadcast) | Firmware string | Device discovery |
| `report 1` | JSON (ID=1) | Device info (product, serial, firmware) |
| `report 2` | JSON (ID=2) | Charging status (state, plug, currents) |
| `report 3` | JSON (ID=3) | Metering data (power, energy, voltages) |
| `ena 1` / `ena 0` | `TCH-OK` / `TCH-ERR` | Enable / disable charging |
| `curr <mA>` | `TCH-OK` / `TCH-ERR` | Set max current (milliamps) |
| `setenergy <0.1Wh>` | `TCH-OK` / `TCH-ERR` | Set session energy limit |

All communication is UDP on port 7090 with 100ms minimum spacing between sends.

## Troubleshooting

| Problem | Solution |
|---|---|
| Discovery finds no chargers | Ensure charger and Homey are on the same subnet. Try specifying `--broadcast` with your subnet broadcast address. |
| Pairing fails with timeout | Verify the IP address. Check that UDP port 7090 is not blocked by firewall. |
| Device shows "Charger not responding" | Check network connectivity. Device is marked unavailable after 5 consecutive poll failures and recovers automatically. |
| Power/energy values are zero | Only available on models with integrated meter (P30, BMW). P20 e-series and P30-DE have no meter. |
| Current limit slider doesn't respond | KEBA requires current values of 0 or 6–63 A. Values 1–5 are invalid. |

## Validation

```bash
# Quick check
npx homey app validate --level debug

# Full App Store validation
npx homey app validate --level publish

# Deploy to Homey for testing
npx homey app run --remote
```
