# Drivers, Devices, Capabilities

## Concepts
- **Driver**: describes a *type* of device; owns pairing and device discovery.
- **Device**: represents an installed device instance; owns capability state and runtime behavior.
- **Capability**: a standardized attribute/action (e.g., `onoff`, `measure_power`, `dim`).

## Responsibilities
### Driver (`drivers/<driver_id>/driver.js`)
- Pairing flow (authenticate, discover, select)
- Device creation parameters (store device data needed later)
- Flow card registration (if scoped to driver)

### Device (`drivers/<driver_id>/device.js`)
- Initialize capability listeners
- Update capability values
- Maintain availability state
- Implement device-specific polling or subscriptions

## Capability best practices
- Prefer standard Homey capabilities whenever possible.
- Keep capability updates idempotent (same input -> same state).
- Use `setCapabilityValue()` only when value changes (reduce noise).
- Use availability properly:
  - `this.setUnavailable('...')` when upstream is down
  - `this.setAvailable()` when recovered

### Power & Energy Capabilities - Common Confusion!

| Capability | Type | Unit | Use Case |
|------------|------|------|----------|
| `measure_power` | Sensor | W (Watts) | Current power draw (instantaneous) |
| `meter_power` | Meter | kWh | Cumulative energy consumption |

```javascript
// Show current power draw (500W when heating, 0W when idle)
this._updateCapability('measure_power', isHeating ? powerWatts : 0);

// Show cumulative energy (increments over time)
this._updateCapability('meter_power', totalKwhConsumed);
```

### Dynamic Capability Management

Add/remove capabilities at runtime for device migration:

```javascript
async onInit() {
  // Add new capabilities without re-pairing
  const requiredCapabilities = ['measure_temperature', 'measure_power', 'custom_mode'];
  
  for (const cap of requiredCapabilities) {
    if (!this.hasCapability(cap)) {
      this.log(`Adding missing capability: ${cap}`);
      await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
    }
  }

  // Remove deprecated capabilities
  if (this.hasCapability('old_deprecated_capability')) {
    await this.removeCapability('old_deprecated_capability');
  }
}

## Pairing best practices
- Pairing must be resilient:
  - validate network connectivity
  - validate credentials
  - provide clear error messages in the pairing UI
- Store only what you need in device data/store (avoid secrets).
- If secrets are required, store them via Homey’s settings mechanism and redact logs.

## Data model
Define a consistent schema for:
- Device data (immutable identifiers)
- Store (mutable operational state)
- Settings (user-configurable)

Example schema:
- data: `{ deviceId, model, apiBaseUrl }`
- store: `{ lastSeen, firmwareVersion }`
- settings: `{ pollIntervalSeconds, debugLogging }`

## Migration considerations
- If you change device data schema, include a migration plan:
  - add new fields with defaults
  - never remove critical identifiers without a migration step
