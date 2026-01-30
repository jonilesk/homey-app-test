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
