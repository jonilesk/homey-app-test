# Coding Guidelines

## Objectives
- **Stability:** never crash the app due to unhandled errors
- **Predictability:** deterministic behavior and clear logs
- **Maintainability:** separation of concerns, readable structure
- **Performance:** avoid busy loops and excessive polling

## App lifecycle
- Keep `onInit()` lightweight.
- Defer I/O until required (e.g., during pairing or device init).
- Always time-bound network operations (timeouts).

## REST API integration
- Set **explicit timeouts** for all HTTP requests.
- Use **retry with backoff** for transient failures (limit attempts; add jitter).
- Respect **rate limits** and cache where safe (avoid hammering APIs).
- Treat upstream outages as non-fatal: log, back off, and recover gracefully.
- Never log tokens or secrets; redact Authorization headers and OAuth codes.
- For OAuth2, prefer `homey-oauth2app` for token lifecycle and API calls.

### Common API Gotchas

**Response codes as strings:**
Many APIs return numeric codes as strings. Always parse before comparing:
```javascript
// BAD: "8" !== 8 (string vs number)
if (response.code !== 8) { ... }

// GOOD: Parse first
const code = parseInt(response.code);
if (code !== 8) { ... }
```

**Nested vs flat data structures:**
Real-time data often lives in nested structures:
```javascript
// Flat array might be cached/stale
const devices = apiResponse.devices;

// Nested data often has real-time values
for (const zone of apiResponse.zones) {
  for (const device of zone.devices) {
    // Fresh data here
  }
}
```

**Temperature unit assumptions:**
Don't assume units - verify with the official app:
- Some APIs use Celsius × 10
- Some APIs use **Fahrenheit × 10** (easy to confuse!)
- Log raw values and compare to official app to determine

References:
- https://apps.developer.homey.app/cloud/oauth2
- https://athombv.github.io/node-homey-oauth2app

## Error handling
### Rules
- Wrap all I/O in `try/catch`.
- Never throw uncaught exceptions from device callbacks.
- Use backoff for retries (linear/exponential) with caps.
- Fail soft: mark device unavailable rather than crashing.

### Pattern (pseudo)
- Validate input
- Perform action
- On error: log structured + set unavailable + schedule retry

## Logging
### Rules
- Never log credentials, tokens, OAuth codes, secrets.
- Use structured logs:
  - event name
  - driver_id / device_id
  - request correlation id (if applicable)

### Suggested log style
- `this.log('[driver:meter] reading updated', { deviceId, value })`
- `this.error('[pairing] failed to authenticate', { reason, statusCode })`

## Concurrency & async
- Avoid parallel writes to the same device state.
- Serialize state transitions when needed.
- Prefer debouncing frequent updates (e.g., rapid sensor events).

## Polling and rate limits
- Prefer push/webhooks where possible.
- If polling is required:
  - minimum sensible interval (e.g., >= 30s or more depending on device/API)
  - jitter to avoid thundering herd
  - honor API limits

## Configuration & settings
- Validate settings on save.
- Provide defaults.
- Consider migration path for renamed settings.

## Dependencies
- Keep dependencies minimal.
- Avoid heavy native modules unless required (Homey runtime constraints).
