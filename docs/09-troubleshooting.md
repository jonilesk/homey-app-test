# Troubleshooting Playbook

## CLI cannot find Homey / connection issues
- Confirm you are on the same LAN or connected via VPN.
- Confirm Homey IP is reachable (ping, router UI).
- Retry login: `homey logout` then `homey login`.

## App starts then stops immediately
- Look for uncaught exceptions in logs.
- Ensure `onInit()` does not throw.
- Wrap async startup with try/catch and log errors.

## Pairing fails
- Add temporary debug logs (redact secrets).
- Validate inputs before API calls.
- Add explicit timeouts to external calls.
- Verify Homey has outbound internet access (DNS, firewall).

## Capabilities not updating
- Ensure device is `available`.
- Ensure `setCapabilityValue()` is called with correct type.
- Update only when value changes.
- Verify that capability exists in driver manifest.

## Flow cards not visible
- Check compose definitions for flow cards.
- Confirm ids and locales are correct.
- Re-run `homey app run --remote` after changes (ensure deploy happened).

## Debugger cannot attach
- Confirm inspector port is open/forwarded.
- Confirm `remoteRoot` is `/app/` in VS Code attach config.
- If your CLI doesn’t expose inspector automatically, use the CLI/flags appropriate to your version.

## Widget/webview issues
- Some widget debugging workflows require Docker tooling.
- If the widget does not render, verify:
  - assets are included
  - correct paths in compose
  - browser console errors (if applicable)

## OAuth2 / Cloud API issues

### Token expiration causing "Device Unavailable"
- OAuth2App may not persist tokens reliably across restarts
- **Solution**: Backup tokens in `homey.settings` (access_token, refresh_token, expires_at)
- Implement proactive token refresh before expiration (at 80% lifetime)

### Data doesn't match official app
1. **Wrong temperature values**: API may use different units than expected
   - Many APIs use Celsius × 10, but some use **Fahrenheit × 10**
   - **Debug**: Log raw API value, compare to official app, calculate conversion
   - Example: Raw 470, official shows 8.3°C → 470/10=47°F → (47-32)×5/9=8.3°C ✓

2. **Wrong mode displayed**: Mode values may differ from documentation
   - **Debug**: Log raw mode value, compare to official app's display
   - Example: API gv_mode=2, official shows "Frost" → 2=Frost (not Eco!)

3. **Stale/cached data**: API may return data from different sources
   - Real-time data often in nested structures (zones[].devices[])
   - Summary/cached data in flat arrays (devices[])
   - **Debug**: Compare temperatures from both sources to official app

### Steps to verify API data accuracy
```javascript
// Add detailed logging during development
this.log(`Raw API data: ${JSON.stringify(deviceData)}`);
this.log(`Raw temp: ${deviceData.temperature_air} → ${convertedTemp}°C`);
this.log(`Raw mode: ${deviceData.gv_mode} → displayed as: ${modeString}`);
// Compare logged values to official app/website
```
