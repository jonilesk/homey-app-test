# Solarman → Homey App Conversion Plan

## 1. Source Analysis

### 1.1 What is Solarman HA Integration?
A Home Assistant custom component that communicates **locally** (LAN) with Solarman WiFi data loggers (dongles) attached to solar inverters. It uses the **Solarman V5 protocol** over TCP (port 8899) to issue **Modbus** register reads, then parses the raw register data into meaningful sensor values using YAML definition files.

### 1.2 Source Architecture (Python)

| File | Role |
|------|------|
| `__init__.py` | HA integration entry point, platform setup |
| `const.py` | Constants: domain, defaults, config keys |
| `solarman.py` | **Core**: `Inverter` class — TCP connection via `pysolarmanv5`, Modbus read/write, register querying with retry |
| `parser.py` | **Core**: `ParameterParser` — parses raw register data (unsigned, signed, ASCII, bits, version, datetime, time, raw) |
| `sensor.py` | HA sensor entities, maps parsed values to HA state |
| `scanner.py` | UDP broadcast discovery of data loggers on LAN |
| `config_flow.py` | HA config flow UI (host, port, serial, slave ID, lookup file) |
| `services.py` | HA service calls for raw Modbus read/write |
| `services.yaml` | HA service definitions for UI |
| `inverter_definitions/*.yaml` | 17 YAML files defining register ranges & parameter schemas per inverter model |

### 1.3 Communication Protocol
- **Transport**: TCP socket to data logger IP on port 8899
- **Protocol**: Solarman V5 (wraps Modbus RTU over TCP)
- **Library**: `pysolarmanv5` (Python) — No direct Node.js equivalent exists
- **Operations**: `read_holding_registers` (FC3), `read_input_registers` (FC4), `write_holding_register` (FC6), `write_multiple_holding_registers` (FC16)
- **Discovery**: UDP broadcast on port 48899 with magic string `WIFIKIT-214028-READ`

### 1.4 Primary Target Inverter

> **User's inverter**: Sofar with LSW3 data logger at **10.1.1.97**, profile: `sofar_lsw3.yaml`

This is a **grid-tied string inverter** (no battery). Development and initial testing will target this profile.

### 1.5 Data Model — `sofar_lsw3.yaml` (603 lines, 37 parameters)

**Single register request**: 0x0000–0x0027 (40 registers), FC 0x03 (read holding registers)

| Group | Parameters | Key Sensors | Homey Relevance |
|-------|-----------|-------------|------------------|
| **Solar** (10) | PV1/PV2 Power, Voltage, Current; Daily/Total Production; Generation time | `measure_power`, `meter_power`, `measure_voltage`, `measure_current` |
| **Output** (9) | Active/Reactive Power; Grid Frequency; L1/L2/L3 Voltage & Current | `measure_power`, `measure_voltage`, `measure_current` |
| **Inverter** (13) | Status (lookup), Module/Inner temperature, Bus voltage, Alert message, Input mode, Country (lookup) | `measure_temperature`, custom enums |
| **Alert** (5) | Fault 1–5 (bitmask lookups with 16 error codes each) | Custom alert capability |

> **Note**: No battery group, no grid import/export energy tracking, no time-of-use. This is simpler than deye_hybrid.yaml.

### 1.6 Data Model Reference — `deye_hybrid.yaml` (830 lines, ~70 sensors)

For reference, the most complex supported profile includes:

| Group | Key Sensors | Homey Relevance |
|-------|-------------|-----------------|
| **Solar** | PV1/PV2 Power, Voltage, Current; Daily/Total Production; Micro-inverter Power | `measure_power`, `meter_power` |
| **Battery** | SOC, Power, Voltage, Current, Temperature, Charge/Discharge totals, Status | `measure_battery`, `measure_power`, `measure_temperature` |
| **Grid** | Total Grid Power, Voltage/Current L1/L2, CT Power, Energy Bought/Sold | `measure_power`, `meter_power` |
| **Upload (Load)** | Total Load Power, Load L1/L2, Voltage, Daily/Total Consumption | `measure_power`, `meter_power` |
| **Inverter** | Running Status, Total Power, Frequency, Temperatures, IDs, Versions, Work Mode | `measure_temperature`, custom caps |
| **Alert** | Alert code (bit field) | Custom capability |
| **Time of Use** | 6 time slots with power, SOC, enable flags | Custom capabilities / settings |

### 1.7 Key Implementation Details
- **Polling**: Throttled to minimum 15 seconds between updates
- **Connection**: Persistent TCP with auto-reconnect, thread-locked for safety
- **Retry**: 2 attempts per register range query before aborting
- **Stale data**: Clears all cached values on connection failure (no stale reporting)
- **Multi-inverter**: Supports multiple inverter instances (each independently configured)
- **Lookup files**: 17 YAML inverter definitions (DEYE, Sofar, Solis, KStar, ZCS, Afore, etc.)

---

## 2. Homey App Design

### 2.1 App Identity
- **App ID**: `com.solarman.inverter`
- **Name**: Solarman
- **Category**: `energy`
- **SDK**: 3
- **Platforms**: `["local"]`

### 2.2 Architecture Overview

```
solarman-app/                         # Single project: CLI tools + Homey app
  app.js                          # Extends Homey.App, registers flow cards
  app.json                        # Root manifest (generated)
  package.json                    # Dependencies (no homey dep)
  .homeycompose/
    app.json                      # App manifest source
    capabilities/                 # Custom capability definitions
      solarman_inverter_status.json
      solarman_grid_frequency.json
      solarman_country.json
      solarman_fault_1.json       # ... through fault_5
      solarman_work_mode.json     # Hybrid profiles only
      solarman_battery_status.json # Hybrid profiles only
      ...
    flow/
      triggers/                   # Flow triggers
      conditions/                 # Flow conditions
      actions/                    # Flow actions (write registers)
  drivers/
    inverter/
      driver.js                   # Pairing: manual IP/serial entry + LAN discovery
      device.js                   # Polling, capability updates, register read
      driver.compose.json         # Capabilities list, pairing config, settings
      assets/
        icon.svg
  lib/
    SolarmanApi.js                # Solarman V5 protocol client (Node.js)
    ParameterParser.js            # Register data parser (ported from Python)
    InverterScanner.js            # UDP discovery (ported from Python)
  inverter_definitions/           # YAML definition files (copied from source)
  cli/                            # Step 1: Node.js CLI test tools (reuse lib/)
    discover.js                   # LAN discovery
    read-inverter.js              # One-shot register read + parse
    write-register.js             # Write single register
    monitor.js                    # Continuous polling monitor
  test_data/                      # Captured raw + parsed data (JSON fixtures)
    sofar_lsw3_capture.json       # Primary: user's inverter at 10.1.1.97
    ...
  assets/
    icon.svg
  locales/
    en.json
```

### 2.3 Key Technology Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Solarman V5 protocol | Implement in Node.js using `net` (TCP) module | No maintained Node.js equivalent; built & validated via CLI tools before Homey integration |
| Modbus framing | Implement within SolarmanApi.js | Solarman V5 wraps Modbus; we need the framing logic |
| Discovery | Port UDP broadcast using `dgram` | Simple broadcast/receive pattern |
| YAML parsing | Use `js-yaml` npm package | Inverter definitions are YAML |
| Inverter definitions | Copy YAML files from source | Reuse the community-maintained definitions |
| Connection model | Local LAN polling (no cloud) | Matches source — `iot_class: local_polling` |
| Pairing | Manual IP + serial entry with optional LAN scan | Same as HA config flow |
| Default lookup file | `sofar_lsw3.yaml` | User's inverter; development/testing primary target |
| Test device | `10.1.1.97` | User's data logger IP |

### 2.4 Capability Mapping

#### Capabilities for Sofar LSW3 (primary target)

##### Standard Homey Capabilities
| Homey Capability | Type | Unit | Sofar LSW3 Source | Register |
|---|---|---|---|---|
| `measure_power` | number | W | Output active power | 0x000C |
| `meter_power` | number | kWh | Total Production | 0x0016+0x0015 |
| `measure_temperature` | number | °C | Inverter module temperature | 0x001B |

##### Sub-Capabilities (Solar)
| Capability | Type | Unit | Source | Register |
|---|---|---|---|---|
| `measure_power.pv1` | number | W | PV1 Power (×10) | 0x000A |
| `measure_power.pv2` | number | W | PV2 Power (×10) | 0x000B |
| `measure_voltage.pv1` | number | V | PV1 Voltage (×0.1) | 0x0006 |
| `measure_voltage.pv2` | number | V | PV2 Voltage (×0.1) | 0x0008 |
| `measure_current.pv1` | number | A | PV1 Current (×0.01) | 0x0007 |
| `measure_current.pv2` | number | A | PV2 Current (×0.01) | 0x0009 |
| `meter_power.daily_production` | number | kWh | Daily Production (×0.01) | 0x0019 |
| `meter_power.total_production` | number | kWh | Total Production | 0x0016+0x0015 |

##### Sub-Capabilities (Grid Output — 3-phase)
| Capability | Type | Unit | Source | Register |
|---|---|---|---|---|
| `measure_power.output` | number | W | Output active power (×10) | 0x000C |
| `measure_voltage.l1` | number | V | L1 Voltage (×0.1) | 0x000F |
| `measure_voltage.l2` | number | V | L2 Voltage (×0.1) | 0x0011 |
| `measure_voltage.l3` | number | V | L3 Voltage (×0.1) | 0x0013 |
| `measure_current.l1` | number | A | L1 Current (×0.01) | 0x0010 |
| `measure_current.l2` | number | A | L2 Current (×0.01) | 0x0012 |
| `measure_current.l3` | number | A | L3 Current (×0.01) | 0x0014 |
| `solarman_grid_frequency` | number | Hz | Grid frequency (×0.01) | 0x000E |

##### Sub-Capabilities (Inverter)
| Capability | Type | Unit | Source | Register |
|---|---|---|---|---|
| `measure_temperature.module` | number | °C | Module temperature | 0x001B |
| `measure_temperature.inner` | number | °C | Inner temperature | 0x001C |
| `solarman_inverter_status` | enum | — | Status (Stand-by/Self-checking/Normal/FAULT/Permanent) | 0x0000 |
| `solarman_country` | enum | — | Country setting | 0x0027 |

##### Alert Capabilities
| Capability | Type | Source | Register |
|---|---|---|---|
| `solarman_fault_1` | string | Fault 1 (bitmask → error text) | 0x0001 |
| `solarman_fault_2` | string | Fault 2 (bitmask → error text) | 0x0002 |
| `solarman_fault_3` | string | Fault 3 (bitmask → error text) | 0x0003 |
| `solarman_fault_4` | string | Fault 4 (bitmask → error text) | 0x0004 |
| `solarman_fault_5` | string | Fault 5 (bitmask → error text) | 0x0005 |

> **Note**: Homey supports sub-capabilities via the `measure_power.xxx` naming pattern. This allows showing multiple power values on a single device without creating separate virtual devices.

#### Extended Capabilities (for hybrid inverter profiles like deye_hybrid.yaml)
When a lookup file with battery/grid-import-export groups is used, the device will dynamically add:
| Capability | Type | Unit | Source |
|---|---|---|---|
| `measure_power.battery` | number | W | Battery Power (signed: +charge, -discharge) |
| `measure_power.grid` | number | W | Total Grid Power (signed: +import, -export) |
| `measure_power.load` | number | W | Total Load Power |
| `measure_battery` | number | % | Battery SOC |
| `measure_voltage.battery` | number | V | Battery Voltage |
| `measure_temperature.battery` | number | °C | Battery Temperature |
| `meter_power.daily_bought` | number | kWh | Daily Energy Bought |
| `meter_power.total_bought` | number | kWh | Total Energy Bought |
| `meter_power.daily_sold` | number | kWh | Daily Energy Sold |
| `meter_power.total_sold` | number | kWh | Total Energy Sold |
| `solarman_battery_status` | enum | — | Battery Status |
| `solarman_work_mode` | enum | — | Work Mode |

> **Design**: Capabilities are **dynamically added** based on the YAML profile. The Sofar LSW3 will have ~30 capabilities; a Deye Hybrid could have ~50+.

### 2.5 Pairing Flow

```
[Step 1: Configure Connection]
  - Inverter Host (IP address) — text input
  - Inverter Serial Number — number input
  - Inverter Port — number input (default: 8899)
  - Modbus Slave ID — number input (default: 1)
  - Inverter Model — dropdown (default: sofar_lsw3.yaml)
  
  Optional: "Scan Network" button to run UDP discovery
  
[Step 2: Test Connection]
  - Attempt TCP connection + read a known register
  - Show success/failure

[Step 3: Add Device]
  - Create device with data: { host, port, serial, slaveid, lookupFile }
```

### 2.6 Device Settings (user-configurable after pairing)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `inverter_host` | text | (from pairing) | IP address of data logger |
| `inverter_port` | number | 8899 | TCP port |
| `inverter_serial` | number | (from pairing) | Data logger serial number |
| `inverter_mb_slaveid` | number | 1 | Modbus slave ID |
| `lookup_file` | dropdown | sofar_lsw3.yaml | Inverter definition file |
| `poll_interval` | number | 30 | Polling interval in seconds (min 15) |

### 2.7 Flow Cards

#### Triggers (all profiles)
| ID | Title | Token(s) | Sofar LSW3 |
|----|-------|----------|------------|
| `solar_production_changed` | Solar production changed | `power` (W) | Yes |
| `inverter_status_changed` | Inverter status changed | `status` | Yes |
| `inverter_fault` | Inverter fault detected | `fault_code`, `fault_text` | Yes |
| `battery_soc_changed` | Battery SOC changed | `soc` (%) | Hybrid only |
| `grid_status_changed` | Grid connection status changed | `status` | Hybrid only |

#### Conditions
| ID | Title | Sofar LSW3 |
|----|-------|------------|
| `is_producing_solar` | Solar is producing power | Yes |
| `inverter_is_normal` | Inverter status is Normal | Yes |
| `battery_soc_above` | Battery SOC is above... | Hybrid only |
| `battery_soc_below` | Battery SOC is below... | Hybrid only |
| `is_exporting_to_grid` | Exporting power to grid | Hybrid only |

#### Actions
| ID | Title | Args |
|----|-------|------|
| `write_register` | Write Modbus register | register (number), value (number) |

---

## 3. Implementation Steps

### Step 1: Node.js CLI Test Tools + Core Libraries
**Build the core libraries (`lib/`) and CLI tools (`cli/`) first, tested from the command line before integrating with Homey.**

This step produces the reusable `lib/` code that the Homey app will use directly — no porting needed later.

Location: `solarman-app/lib/` (libraries) + `solarman-app/cli/` (CLI scripts)

#### 1a: Project Setup
- Create `solarman-app/` directory with `package.json`
- Add dependencies: `js-yaml` (YAML parsing), `commander` (CLI argument parsing)
- Copy inverter definition YAML files from source to `solarman-app/inverter_definitions/`
- Create `solarman-app/test_data/` for captured fixtures
- Run `npm install`

#### 1b: Implement `lib/SolarmanApi.js` — Solarman V5 Protocol Client
- Implement Solarman V5 frame encoding/decoding (header, serial, payload, checksum)
- Implement `connect()`, `disconnect()` using Node.js `net` module
- Implement `readHoldingRegisters(start, quantity)` — Modbus FC3
- Implement `readInputRegisters(start, quantity)` — Modbus FC4
- Implement `writeHoldingRegister(register, value)` — Modbus FC6
- Implement `writeMultipleHoldingRegisters(register, values)` — Modbus FC16
- Add socket timeout handling (15 second timeout)
- Add auto-reconnect logic
- Add mutex/lock for request serialization (prevent concurrent Modbus calls)
- Reference: study `pysolarmanv5` Python source for frame format

#### 1c: Implement `lib/ParameterParser.js` — Register Data Parser
- Port `ParameterParser` class from Python to JavaScript
- Implement all 10 parse rules (unsigned, signed, ASCII, bits, version, datetime, time, raw)
- Implement value scaling (scale, scale_division, offset)
- Implement validation (min, max, invalidate_all)
- Implement lookup table mapping + mask support
- Load YAML definitions using `js-yaml`

#### 1d: Implement `lib/InverterScanner.js` — LAN Discovery
- Port UDP broadcast scanner using Node.js `dgram` module
- Send `WIFIKIT-214028-READ` to broadcast port 48899
- Parse response (IP, MAC, Serial comma-separated)
- Timeout after 1 second, collect multiple responses

#### 1e: CLI Discovery Tool (`cli/discover.js`)
- Use `lib/InverterScanner.js`
- Print discovered data loggers: IP, MAC, Serial
- Usage: `node cli/discover.js`

#### 1f: CLI Read Tool (`cli/read-inverter.js`)
- Use `lib/SolarmanApi.js` + `lib/ParameterParser.js`
- Accept CLI args: `--host` (default `10.1.1.97`), `--serial`, `--port` (default 8899), `--slaveid` (default 1), `--lookup` (default `sofar_lsw3.yaml`)
- Load inverter YAML definition, execute all register range requests
- Parse responses and print all values grouped by category (Solar, Battery, Grid, Load, Inverter)
- Option `--save` to dump raw registers + parsed values to `test_data/` as JSON
- Usage: `node cli/read-inverter.js --host 10.1.1.97 --serial <YOUR_SERIAL>`
- Quick test (with defaults): `node cli/read-inverter.js --serial <YOUR_SERIAL>`

#### 1g: CLI Write Tool (`cli/write-register.js`)
- Use `lib/SolarmanApi.js`
- Accept CLI args: `--host` (default `10.1.1.97`), `--serial`, `--port`, `--slaveid`, `--register`, `--value`
- Write a single holding register, read back to confirm
- Usage: `node cli/write-register.js --host 10.1.1.97 --serial <YOUR_SERIAL> --register 16384 --value 1`

#### 1h: CLI Continuous Monitor (`cli/monitor.js`)
- Use `lib/SolarmanApi.js` + `lib/ParameterParser.js`
- Accept same connection args + `--interval` (default 30s)
- Poll in a loop, print updated values with timestamps
- Highlight changed values between polls
- Show connection status (connected/disconnected/reconnecting)
- Ctrl+C to stop gracefully
- Usage: `node cli/monitor.js --host 10.1.1.97 --serial <YOUR_SERIAL> --interval 15`

#### 1i: Capture Reference Data
- Run `node cli/read-inverter.js --host 10.1.1.97 --serial <YOUR_SERIAL> --save` against the Sofar inverter
- Saves raw register data + parsed values to `test_data/sofar_lsw3_capture.json`
- These fixtures serve as regression tests for parser changes
- Compare output with HA integration to verify correctness
- **First test**: Verify that the single register range (0x0000–0x0027, FC3) reads successfully

#### Validation Criteria (must pass before proceeding to Homey integration)
- [ ] Discovery finds data loggers on the network
- [ ] Read tool connects and retrieves all register ranges without errors
- [ ] Parser produces values that match the HA integration's output
- [ ] Monitor runs stably for 10+ minutes without connection drops
- [ ] Captured test data is saved as JSON fixtures

---

### Step 2: Homey Project Scaffolding
**Add Homey app structure to the existing `solarman-app/` project (lib/ and cli/ already exist from Step 1).**
- Add Homey-specific fields to `package.json` (no `homey` dependency)
- Create `.homeycompose/app.json` with app metadata
- Create root `app.json` with minimum fields
- Create `app.js` extending `Homey.App`
- Create `assets/icon.svg` (placeholder)
- Create `locales/en.json` with initial strings
- Update `.gitignore` (add .homeybuild)

### Step 3: Define Capabilities
**Create custom capability JSON files in `.homeycompose/capabilities/`.**

Sub-capabilities like `measure_power.pv1` use Homey's built-in `measure_power` type — only truly custom types need JSON definitions.

#### Custom capabilities to define:
- `solarman_inverter_status` — enum (Stand-by, Self-checking, Normal, FAULT, Permanent)
- `solarman_grid_frequency` — number, Hz
- `solarman_country` — enum (Germany, Australia, France, etc.)
- `solarman_fault_1` through `solarman_fault_5` — string (error text from bitmask lookup)

#### Hybrid-only capabilities (also define, used when deye_hybrid etc. profile selected):
- `solarman_work_mode` — enum
- `solarman_battery_status` — enum
- `solarman_grid_connected` — enum

#### Standard Homey sub-capabilities (no custom JSON needed):
- `measure_power.pv1`, `.pv2`, `.output` (Sofar) / `.battery`, `.grid`, `.load` (Hybrid)
- `measure_voltage.pv1`, `.pv2`, `.l1`, `.l2`, `.l3` / `.battery` (Hybrid)
- `measure_current.pv1`, `.pv2`, `.l1`, `.l2`, `.l3`
- `measure_temperature.module`, `.inner` / `.battery` (Hybrid)
- `meter_power.daily_production`, `.total_production` / `.daily_bought`, `.total_sold` (Hybrid)
- `measure_battery` (Hybrid only)

### Step 4: Implement Driver (Pairing)
**Create `drivers/inverter/driver.js` with pairing flow.**
- Extend `Homey.Driver`
- Implement manual pairing flow:
  - Step 1: Connection settings form (IP, serial, port, slave ID, inverter model)
  - Step 2: Connection test (try to connect and read registers)
  - Step 3: Device list / confirmation
- Implement optional LAN scan (`InverterScanner`)
- Create `driver.compose.json` with:
  - Full capabilities list
  - Pairing configuration
  - Device settings schema
  - Device class: `solarpanel` (or `other`)
  - Note: Capabilities are dynamically determined from YAML profile — Sofar LSW3 has ~30 caps, Deye Hybrid ~50+
- Create `drivers/inverter/assets/icon.svg`

### Step 5: Implement Device (Runtime)
**Create `drivers/inverter/device.js` — the main runtime logic (uses `lib/` from Step 1).**
- Extend `Homey.Device`
- `onInit()`:
  - Load inverter definition YAML based on `lookup_file` setting
  - Ensure all capabilities are present (migration support)
  - Create `SolarmanApi` client instance (from `lib/SolarmanApi.js` — already built & tested in Step 1)
  - Create `ParameterParser` instance (from `lib/ParameterParser.js` — already built & tested in Step 1)
  - Start polling with jitter (following CleverTouch pattern)
  - Register capability listeners for writable values
- `poll()`:
  - Iterate all request ranges from YAML definition
  - Call `readHoldingRegisters` / `readInputRegisters` per range
  - Feed raw data to `ParameterParser`
  - Map parsed values to Homey capabilities using `_updateCapability()`
  - Handle connection errors: `setUnavailable()` / `setAvailable()`
  - Clear stale data on failure (matching source behavior)
- `_updateCapability(name, value)`:
  - Only update if value changed (reduce noise)
  - Pattern from CleverTouch reference
- `onSettings({ changedKeys })`:
  - Handle host/port/serial changes → reconnect
  - Handle lookup_file change → reload definitions, adjust capabilities
  - Handle poll_interval change → restart polling timer
- `onDeleted()`:
  - Disconnect from inverter
  - Clear all timers

### Step 6: Implement Flow Cards
**Define and register flow cards.**
- Create trigger card definitions in `.homeycompose/flow/triggers/`
- Create condition card definitions in `.homeycompose/flow/conditions/`
- Create action card definitions in `.homeycompose/flow/actions/`
- Register trigger card listeners in `app.js`
- Register condition card listeners in `app.js`
- Register action card listeners in `app.js` (write register action)
- Add localization strings in `locales/en.json`

### Step 7: Homey Energy Support
**Enable Homey's built-in energy dashboard integration.**
- Set appropriate `energy` config in `driver.compose.json`
- Use `measure_power` as primary power capability (Homey uses this for energy insights)
- Use `meter_power` for cumulative energy (Homey energy dashboard)
- Test with Homey Energy tab

### Step 8: Polish & Testing
**Finalize the app for use.**
- Add comprehensive logging (following docs/04-coding-guidelines.md)
- Add error handling for all I/O paths
- Run `homey app validate --level debug`
- Test pairing flow on real Homey
- **Primary test target**: Sofar LSW3 at `10.1.1.97` with `sofar_lsw3.yaml` profile
- Test with multiple inverter definition files (if additional hardware available)
- Test flow cards
- Test device settings changes
- Test reconnection after network disruption
- Add README.md
- Verify `.homeybuild/` generation

---

## 4. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| No Node.js pysolarmanv5 library | High — must implement protocol from scratch | Protocol is documented in pysolarmanv5 source; Step 1 builds & tests the Node.js implementation directly via CLI before Homey integration |
| Solarman V5 frame format complexity | Medium | CLI tools (Step 1) allow rapid iteration and debugging against real hardware (Sofar at 10.1.1.97) before adding Homey complexity |
| Testing without hardware | Low — user has hardware | Sofar LSW3 at 10.1.1.97 available for testing; Step 1i also captures JSON fixtures for offline regression |
| Primary profile is simpler | Low | Sofar LSW3 has 1 register range and no battery; good for initial development but must also test with complex profiles (deye_hybrid) |
| Dynamic capabilities across profiles | Medium | Capabilities added/removed based on YAML profile; must handle capability migration gracefully |
| Many inverter definitions | Low | YAML files are data-only; copied unchanged from source |
| Homey capability limits | Low | Sub-capabilities handle multi-sensor well; Sofar LSW3 ~30 caps is reasonable |
| Socket stability on Homey hub | Medium | Use reconnect logic with backoff; mark device unavailable on persistent failure |

---

## 5. Dependencies

### npm packages
| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing (for cli/ tools) |
| `js-yaml` | Parse inverter definition YAML files |

### Node.js built-in modules
| Module | Purpose |
|--------|---------|
| `net` | TCP socket for Solarman V5 protocol |
| `dgram` | UDP broadcast for LAN discovery |
| `buffer` | Binary data manipulation for Modbus frames |

### No `homey` dependency
As per Homey guidelines, do not add `homey` to package.json — it's provided by the runtime.

---

## 6. Reference Material

| Resource | Location |
|----------|----------|
| Solarman HA source code | `./source/home_assistant_solarman/custom_components/solarman/` |
| Inverter definitions | `./source/home_assistant_solarman/custom_components/solarman/inverter_definitions/` |
| pysolarmanv5 docs | https://pysolarmanv5.readthedocs.io/ |
| Solarman V5 protocol | Documented in pysolarmanv5 source |
| CleverTouch reference (Homey) | `./clevertouch-app/` |
| Homey development docs | `./docs/` |
| Homey capabilities reference | https://apps.developer.homey.app/the-basics/devices/capabilities |
| Homey driver reference | https://apps.developer.homey.app/the-basics/drivers |
