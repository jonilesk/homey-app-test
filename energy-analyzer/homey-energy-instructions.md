# Homey Energy support — implementation guide for AI coding agents

> Assumption: every Homey has a **Homey Energy Dongle** (whole-home smart meter input is always available).  
> Goal: ensure that **devices capable of measuring consumption** are included in **Homey Energy** and show correct power/energy.

---

## 1) How Homey Energy works (mental model)

### A. Two measurement layers

1) **Whole‑home (total) energy**
- Total household import/export comes from a whole-home meter (in your scenario always the **Homey Energy Dongle**).

2) **Per‑device energy**
Homey Energy uses per-device data from:
- **Instantaneous power (W)** via `measure_power`
- **Cumulative energy (kWh)** via `meter_power` (or `meter_power.*` subcapabilities)

If a device cannot truly measure power, it can still be included via **approximation** based on state (e.g., `onoff`, `dim`) and/or developer-provided constants.

### B. Inclusion in Energy is capability + metadata driven
A device is “Energy-aware” if it has any of:
- `measure_power` and/or `meter_power` (incl. `meter_power.*`)
- `energy.approximation` config (so Homey can compute usage)

Device **class** affects grouping and semantics (e.g., `socket`, `solarpanel`, `battery`, `evcharger`, `car`).

---

## 2) What your app must do so metering-capable devices are included

### Rule 1 — If the physical device reports watts: expose `measure_power`
If your integration can read real power (W):
- Add `measure_power` in the driver `capabilities`
- Keep it updated whenever telemetry changes (push reports, polling, etc.)

**Requirement**
- Do **not** publish computed values as “real” measurements.

### Rule 2 — If the physical device reports kWh: expose `meter_power` (cumulative)
If your device reports cumulative energy:
- Add `meter_power` or `meter_power.*` to capabilities
- Keep it **monotonically increasing** (except device resets/re-pairing)

**Import/export separation**
If you have both directions, use:
- `meter_power.imported`
- `meter_power.exported`
And set in driver `energy` object:
- `meterPowerImportedCapability`
- `meterPowerExportedCapability`

### Rule 3 — If it’s not measured: still include it via approximation
If the device can’t measure W:

**3A) Static approximation in driver manifest**
Add `energy.approximation` defaults like:
- `usageOn` / `usageOff`  
or  
- `usageConstant`

**3B) Dynamic approximation in code**
If you compute watts at runtime:
- Publish `measure_power`
- Set `capabilitiesOptions.measure_power.approximated = true`

### Rule 4 — Use correct device class (critical for producers/storage/chargers)
Common expectations:
- Smart plug: class `socket`, typically `onoff`, `measure_power`, optionally `meter_power.*`
- Solar: class `solarpanel`, `measure_power` positive when generating; `meter_power` cumulative generation
- Home battery: class `battery`, `energy.homeBattery=true`; power sign convention **+ charging / − discharging**
- EV charger: class `evcharger`
- EV: class `car` with `energy.electricCar=true`

---

## 3) AI coding agent instructions (actionable build plan)

### Step A — Build an “Energy Capability Map” for your integration
For each device type, classify into one of:

1) **Metered power only (has W)**
- Capabilities: `measure_power` (+ control/state caps)

2) **Metered power + metered energy (has W and kWh total)**
- Capabilities: `measure_power`, `meter_power` (or `meter_power.*`)

3) **Energy-only (has kWh total but no W)**
- Capabilities: `meter_power` (or `meter_power.*`)

4) **Not metered (no W/kWh)**
- Provide `energy.approximation` **or** computed `measure_power` with `approximated=true`

**Definition of “included into Energy” for acceptance tests**
A device is included if it appears in the Energy UI and contributes power/usage unless the user excludes it.

---

### Step B — Implement drivers so Energy gets the right metadata

#### B1) Metered device driver template (device reports watts)
Agent must:
- Add `measure_power` to `capabilities`
- Update `measure_power` in runtime code
- If computed: set `capabilitiesOptions.measure_power.approximated=true`

#### B2) Import/export template (bidirectional metering)
Agent must:
- Add `meter_power.imported`, `meter_power.exported` to `capabilities`
- Set in the driver manifest:
  - `energy.meterPowerImportedCapability: "meter_power.imported"`
  - `energy.meterPowerExportedCapability: "meter_power.exported"`

#### B3) Non-metered approximation template (lights, appliances with known wattage)
Agent must:
- Add `energy.approximation` defaults (usageOn/usageOff or usageConstant)
- Ensure device has state capabilities that drive approximation (commonly `onoff`, optionally `dim`)

---

### Step C — Runtime logic requirements (must implement)

1) **Telemetry ingestion**
- Update capability values when telemetry changes
- Avoid spamming updates (apply thresholds / debouncing)

2) **Monotonic counters** (`meter_power*`)
- Never decrease in normal operation
- If device resets counters, handle reconciliation (persist last known, detect resets)

3) **Imported/exported correctness**
- Keep separate monotonic counters for imported vs exported
- Map them in the driver `energy` object

4) **Device class correctness**
- Ensure class matches semantics (especially producer/storage/charger)

---

### Step D — Testing checklist (definition-of-done)

#### D1) Device-level verification
Add test devices for each category (metered W, metered kWh, import/export, approximated) and verify:
- `measure_power` updates reflect live changes
- `meter_power` stays cumulative (no random resets)
- Approximated devices show usage as approximation (or are marked approximated)

#### D2) Energy UI inclusion
Verify devices appear under Energy and contribute to totals unless explicitly excluded.

#### D3) Whole-home consistency (Energy Dongle present)
Compare “sum of major consumers” vs whole-home import to catch sign/mapping bugs.
- Do not expect perfect equality (not all loads represented)
- Do catch obviously incorrect values (e.g., negative consumption on a heater)

---

## 4) Optional: Using the Homey Energy Dongle Local API
Not required for Energy inclusion (Homey supports the dongle natively), but useful for:
- debugging whole-home readings
- building external analytics

High level:
- enable the dongle Local API
- connect to its WebSocket
- consume raw smart-meter telegram data

---

## 5) Paste-ready coding-agent prompt

Implement Homey Energy support for this app:

- For each driver, ensure Energy inclusion by implementing either:
  (a) `measure_power` updates,
  (b) `meter_power` cumulative counters, or
  (c) `energy.approximation` defaults.
- Use correct device class (`socket`, `light`, `solarpanel`, `battery`, `evcharger`, `car`) and energy flags (`homeBattery`, `evCharger`, `electricCar`) where relevant.
- If device supports import/export, implement `meter_power.imported` and `meter_power.exported` and set `energy.meterPowerImportedCapability` / `energy.meterPowerExportedCapability`.
- If power values are computed, set `capabilitiesOptions.measure_power.approximated=true`.
- Provide tests validating: monotonic `meter_power`, correct sign conventions, and device appears in Energy UI.

