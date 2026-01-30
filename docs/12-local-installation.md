# Local Installation (Private Apps)

## Overview
You can install Homey apps directly on your Homey Pro without publishing to the App Store. This is ideal for:
- Personal/private apps
- Testing before publishing
- Apps you don't want to share publicly

## Installation methods

### 1. Permanent local install (recommended for personal use)
```bash
cd your-app-folder
homey app install
```

This installs the app directly on your Homey:
- ✅ Persists across reboots
- ✅ Runs without CLI connected
- ✅ Only on your Homey (private)
- ✅ No App Store submission required
- ✅ No external server needed

### 2. Development mode (for active development)
```bash
homey app run --remote
```

This runs the app temporarily:
- Streams logs to your terminal
- Stops when you disconnect or press Ctrl+C
- Useful for debugging and testing changes

## Updating locally installed apps

After making code changes, reinstall:
```bash
homey app install
```

The new version overwrites the previous installation.

## Managing local apps

### Check installed apps
Open the Homey mobile app:
1. Go to **More** → **Apps**
2. Your app appears with a "Development" badge

### Uninstall
```bash
homey app uninstall
```

Or via the Homey mobile app:
1. **More** → **Apps** → Select your app
2. Tap **Delete**

## Multiple Homeys

Local installation is tied to a single Homey. To install on multiple devices:

1. Select a different Homey:
   ```bash
   homey select
   ```

2. Install on that Homey:
   ```bash
   homey app install
   ```

Repeat for each Homey you want to install on.

## Validation for local install

Local installation only requires `debug` level validation:
```bash
homey app validate --level debug
```

You don't need:
- PNG images (SVG icons are fine)
- Support URL
- Readme file
- Any App Store requirements

## When to use each method

| Scenario | Method |
|----------|--------|
| Personal app, daily use | `homey app install` |
| Active development, debugging | `homey app run --remote` |
| Share with friends/family | Test release via App Store |
| Public distribution | Full App Store publish |

## Comparison with App Store

| Feature | Local Install | Test Release | Public Release |
|---------|---------------|--------------|----------------|
| Runs permanently | ✅ | ✅ | ✅ |
| Private | ✅ | ✅ (link only) | ❌ |
| Multiple users | Manual per Homey | Share link | Anyone |
| Requires certification | ❌ | ❌ | ✅ |
| PNG images required | ❌ | ✅ | ✅ |
| Updates automatically | ❌ | ✅ | ✅ |

## Limitations of local install

- **No automatic updates:** You must manually reinstall after changes
- **Single Homey:** Must install separately on each device
- **No sharing:** Others can't install your app without CLI access
- **Development badge:** App shows as "Development" in Homey UI

## Troubleshooting

### App doesn't appear after install
1. Refresh the Homey app (pull down)
2. Check Homey is online: `homey list`
3. Verify installation succeeded (no errors in terminal)

### App stops working after Homey update
Reinstall the app:
```bash
homey app install
```

### Need to test on a different Homey
```bash
homey select        # Choose target Homey
homey app install   # Install on selected Homey
```

## References
- Homey CLI: https://apps.developer.homey.app/the-basics/getting-started/homey-cli
- Development workflow: https://apps.developer.homey.app/the-basics/getting-started/your-first-app
