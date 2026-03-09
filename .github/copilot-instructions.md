# Copilot Instructions — Homey App Development

This monorepo contains documentation (`docs/`), reference implementations, and planning materials for building Homey Pro (2023) apps. Read `docs/00-overview.md` through `docs/13-oauth2-cloud-devices.md` for the complete guide.

## Architecture

A Homey app is a **Node.js application running on the Homey hub** (not a web app). Homey CLI uploads and executes it.

```
your-app/
├── app.js                        # Extends Homey.App (or OAuth2App)
├── app.json                      # Generated manifest — do not edit directly
├── package.json                  # NO homey dependency (runtime provides it)
├── .homeycompose/
│   ├── app.json                  # App manifest source-of-truth
│   ├── capabilities/             # Custom capability JSON definitions
│   └── flow/
│       ├── triggers/
│       ├── conditions/
│       └── actions/
├── drivers/<driver_id>/
│   ├── driver.js                 # Pairing & device discovery
│   ├── device.js                 # Device runtime, polling, capabilities
│   └── driver.compose.json       # Driver manifest (NOT in .homeycompose/drivers/)
├── lib/                          # API clients, shared utilities
├── locales/en.json               # Required; additional locales optional
└── assets/icon.svg               # 960×960, transparent background
```

**Key relationships:**
- `.homeycompose/` files are the **source of truth** — they generate `app.json`
- `driver.compose.json` lives **inside** `drivers/<id>/`, not under `.homeycompose/`
- `.homeybuild/` is generated output — must be in `.gitignore`
- Not every app needs `drivers/`; service-only apps use `app.js` + flow cards

**Class hierarchy for OAuth2 apps** (using `homey-oauth2app`):
- `app.js` → extends `OAuth2App`
- `lib/YourOAuth2Client.js` → extends `OAuth2Client`
- `drivers/*/driver.js` → extends `OAuth2Driver`
- `drivers/*/device.js` → extends `OAuth2Device`

## Commands

```bash
homey app run --remote              # Dev mode (live logs, stops when terminal closes)
homey app install                   # Permanent install (survives reboots)
homey app validate --level publish  # Full validation for App Store readiness
homey app validate --level debug    # Quick check during development
```

## Critical Conventions

### Error handling — wrap all I/O in try/catch

Never throw uncaught exceptions from device callbacks. Fail soft: mark device unavailable rather than crashing.

```javascript
try {
  const data = await this.apiCall();
  this._updateCapability('measure_power', data.power);
  if (!this.getAvailable()) await this.setAvailable();
} catch (error) {
  this.error('[poll] Failed:', error.message);
  if (this.getAvailable()) await this.setUnavailable(error.message);
}
```

### HTTP requests — always use AbortController timeouts

The `fetch()` timeout parameter does not work. Use AbortController instead. Retry with backoff + jitter, cap attempts at 3.

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch(url, { signal: controller.signal });
  // ...
} finally {
  clearTimeout(timeout);
}
```

### Polling — jitter to prevent thundering herd

Add 0–30s random jitter before first poll. Use quick-poll (15s × 3) after user changes, then return to normal interval (≥180s).

```javascript
const jitter = Math.random() * 30000;
this.pollTimeout = this.homey.setTimeout(async () => {
  await this.poll();
  this.pollInterval = this.homey.setInterval(() => this.poll(), POLL_INTERVAL_NORMAL);
}, jitter);
```

### Capability updates — only write when value changes

```javascript
_updateCapability(name, value) {
  if (this.hasCapability(name) && this.getCapabilityValue(name) !== value) {
    this.setCapabilityValue(name, value)
      .catch(err => this.error(`Failed to set ${name}:`, err));
  }
}
```

### OAuth2 token persistence — backup to Homey settings

`homey-oauth2app` does not reliably persist tokens across restarts. Always backup access_token, refresh_token, and expires_at to `this.homey.settings`. Proactively refresh at 80% of token lifetime.

### Cleanup in onUninit — clear all timers

```javascript
async onOAuth2Uninit() {
  if (this.pollTimeout) { this.homey.clearTimeout(this.pollTimeout); this.pollTimeout = null; }
  if (this.pollInterval) { this.homey.clearInterval(this.pollInterval); this.pollInterval = null; }
  if (this.quickPollTimer) { this.homey.clearInterval(this.quickPollTimer); this.quickPollTimer = null; }
}
```

### Dynamic capabilities — add/remove without re-pairing

```javascript
for (const cap of requiredCapabilities) {
  if (!this.hasCapability(cap)) {
    await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
  }
}
```

### Logging — structured with context prefix, never log secrets

```javascript
this.log('[driver:meter] reading updated', { deviceId, value });
this.error('[pairing] failed to authenticate', { reason, statusCode });
// NEVER log tokens, OAuth codes, API keys, or passwords
```

### Device data model — three tiers

- **data**: immutable identifiers set at pairing (`deviceId`, `homeId`)
- **store**: mutable cached state, refreshable (`firmwareVersion`, `zoneName`)
- **settings**: user-configurable via Homey UI (`pollInterval`, `debugLogging`)

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| API response codes are strings (`"8"` not `8`) | Always `parseInt()` before comparing |
| `measure_power` vs `meter_power` confusion | `measure_power` = instantaneous Watts; `meter_power` = cumulative kWh |
| Temperature units vary by API | Verify raw values against official app — some use Fahrenheit×10 |
| API docs wrong about mode mappings | Log raw values and compare to official app display |
| Flat device arrays may be stale | Extract real-time data from nested structures (`zones[].devices[]`) |
| `onInit()` doing heavy I/O | Keep lightweight — defer network calls to device init or pairing |
| IDs renamed after users paired | Never rename `driver_id` or capability IDs — breaks existing installs |
