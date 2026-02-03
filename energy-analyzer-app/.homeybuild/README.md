# Homey Energy Gap Analyzer

This Homey app analyzes the gap between total home energy consumption (from the Homey Energy Dongle) and tracked device consumption, revealing the "gray area" of untracked energy usage.

## Features

- **Virtual Device**: Displays live metrics directly in the Homey UI
- **Homey Insights**: Tracks historical trends over 1 month
- **Automatic Polling**: Updates every 15 minutes
- **Per-Device Breakdown**: Stores detailed consumption data by device

## Capabilities

The Energy Gap Analyzer virtual device provides the following metrics:

- **Total Home Power** - Total household consumption from the Energy Dongle
- **Tracked Devices** - Sum of power from all devices reporting consumption
- **Untracked (Gray Area)** - The difference: unaccounted energy usage
- **Untracked %** - Percentage of total consumption that is untracked
- **Devices Reporting** - Number of devices actively reporting power

## Installation

### Using Homey CLI (Development)

1. Navigate to the app directory:
   ```bash
   cd energy-analyzer-app
   ```

2. Run the app on your Homey:
   ```bash
   homey app run
   ```

3. Or install it permanently:
   ```bash
   homey app install
   ```

### First Use

1. After installation, go to **Devices** in the Homey app
2. Add a new device and select **Energy Gap Analyzer**
3. The virtual device will be created automatically
4. Wait 0-30 seconds for the first analysis to run
5. Metrics will update every 15 minutes

## How It Works

### Energy Analysis

The app polls your Homey system every 15 minutes and:

1. Identifies the **Homey Energy Dongle** (whole-home meter)
2. Collects power readings from all devices with `measure_power`
3. Calculates the difference (gray area)
4. Updates the virtual device capabilities
5. Logs data to Homey Insights for historical tracking

### Energy Dongle Detection

The app identifies the Energy Dongle by:
- Device class: `homemeter`
- Driver URI containing: `energy-dongle`
- Device name containing: "energy dongle"

### Device Breakdown

Per-device consumption data is stored in app settings and can be accessed via the Homey API:

```javascript
// Get the device breakdown
const breakdown = homey.settings.get('deviceBreakdown');
// Returns: [{ id, name, class, power }, ...]
```

## Homey Insights Logs

The following metrics are logged to Insights:

- `power-total` - Total home consumption (W)
- `power-tracked` - Sum of tracked devices (W)
- `power-untracked` - Untracked gray area (W)
- `untracked-percent` - Untracked percentage (%)

Access these in the Homey app under **Insights**.

## Requirements

- **Homey Pro (2023)** or compatible
- **Homey Energy Dongle** installed and configured
- **Homey firmware** 5.0.0 or higher
- At least one device reporting `measure_power`

## Architecture

```
energy-analyzer-app/
├── app.js                   # Main app - polling orchestration
├── app.json                 # Compiled manifest
├── lib/
│   └── EnergyAnalyzer.js    # Core analysis logic
├── drivers/
│   └── energy-gap/          # Virtual device driver
└── .homeycompose/           # Source manifests
```

## Future Enhancements

Planned features for future versions:

- **Flow Cards**: Trigger flows when untracked energy exceeds thresholds
- **Settings Page**: View per-device breakdown and configure polling
- **Real-time Updates**: WebSocket integration with Energy Dongle
- **Device Exclusions**: Manually exclude devices from tracking
- **Solar/Battery Support**: Proper handling of negative power values

## Troubleshooting

### Virtual device not appearing
- Ensure the app is running: `homey app log`
- Try re-pairing the device from the Devices page

### No data or zeros showing
- Verify your Energy Dongle is connected and reporting
- Check that devices with `measure_power` are active
- Wait up to 15 minutes for the first poll cycle

### Insights not showing data
- Ensure the app has been running for at least one poll cycle
- Check Homey Insights for the logs listed above
- Restart the app if needed: `homey app restart`

## License

MIT

## Support

For issues or questions, please open an issue on the project repository.
