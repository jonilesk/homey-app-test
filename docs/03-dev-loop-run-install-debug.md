# Dev Loop: run vs install vs debug (Homey Pro 2023)

## Commands you will use most

### Run in dev mode (remote on device)
Recommended for rapid iteration on Homey Pro (2023):
```bash
homey app run --remote
```

**Behavior**
- Uploads your app to Homey and starts it.
- Streams logs to your terminal while the command is running.
- Stopping the command typically stops/uninstalls the dev session app (intended for fast loops).

### Install for longer testing / permanent use
Use when you want the app to persist across reboots without CLI:
```bash
homey app install
```

This is the recommended method for:
- Personal/private apps you want to use daily
- Long-running soak tests
- Apps you don't plan to publish to the App Store

### Uninstall
```bash
homey app uninstall
```

### Build only (validate without deploying)
```bash
homey app build
```
Generates `.homeybuild/` output and validates. Useful to check for errors before running.

## Suggested daily loop
1. `homey app run --remote`
2. Trigger behavior (device pairing, capability change, flow execution)
3. Watch logs; iterate code
4. If you need long soak-testing: `homey app install`

## Debugging: Node Inspector (VS Code attach)
If you start the app with inspector enabled (or your CLI enables it), you can attach a debugger.

### VS Code `.vscode/launch.json` (template)
Replace `YOUR_HOMEY_IP`.
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to Homey (Pro 2023)",
      "address": "YOUR_HOMEY_IP",
      "port": 9229,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "/app/",
      "protocol": "inspector",
      "restart": true,
      "timeout": 30000
    }
  ]
}
```

### Chrome attach (alternative)
- Open Chrome: `chrome://inspect`
- Add target host: `YOUR_HOMEY_IP:9229`
- Attach to the Node process

## Log hygiene
When iterating quickly, logs get noisy. Standardize:
- Prefix by subsystem (`[driver:meter]`, `[pairing]`, `[flow]`)
- Include device id when available
- Do not log secrets

## When remote dev is not enough
Some UI/widget/webview workflows may require Docker-based tooling (depending on your setup). If you hit limitations, document the specific case in `09-troubleshooting.md`.
