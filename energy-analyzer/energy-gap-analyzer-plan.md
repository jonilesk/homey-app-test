# Plan: Homey Energy Gap Analyzer App

## Overview

Build a Homey app that compares total home consumption (Energy Dongle) with tracked device consumption, showing the "gray area" of untracked energy. Uses a virtual device to display live metrics and Homey Insights for 1-month historical trends. Polls every 15 minutes, provides per-device breakdown.

## Architecture

```
energy-analyzer-app/
├── app.js                          # Main app - polling & analysis orchestration
├── app.json                        # Generated manifest (from homeycompose)
├── package.json
├── .homeycompose/
│   ├── app.json                    # App metadata, permissions
│   ├── capabilities/               # Custom capability definitions
│   │   ├── power_total.json
│   │   ├── power_tracked.json
│   │   ├── power_untracked.json
│   │   ├── untracked_percentage.json
│   │   └── tracked_device_count.json
│   └── flow/
│       └── triggers/               # Optional flow triggers
├── drivers/
│   └── energy-gap/
│       ├── driver.compose.json     # Virtual device definition
│       ├── driver.js               # Auto-creates single device
│       ├── device.js               # Receives updates from app
│       └── assets/
│           └── icon.svg
├── lib/
│   └── EnergyAnalyzer.js           # Core analysis logic
├── locales/
│   └── en.json
└── assets/
    └── icon.svg
```

## Implementation Steps

### Step 1: Create Project Scaffold

1. Create directory structure above
2. Configure `.homeycompose/app.json`:
   - App ID: `com.example.energy-gap-analyzer`
   - SDK version: 3
   - Permission: `homey:manager:api` (required to access all devices)
   - Category: `tools`

### Step 2: Define Custom Capabilities

Create in `.homeycompose/capabilities/`:

| Capability | Type | Unit | Title |
|------------|------|------|-------|
| `power_total` | number | W | Total Home Power |
| `power_tracked` | number | W | Tracked Devices |
| `power_untracked` | number | W | Untracked (Gray Area) |
| `untracked_percentage` | number | % | Untracked Percentage |
| `tracked_device_count` | number | - | Devices Reporting |

### Step 3: Create Virtual Device Driver

**drivers/energy-gap/driver.compose.json**:
- Class: `sensor`
- Capabilities: all custom capabilities above
- Single device, auto-paired on app install

**drivers/energy-gap/driver.js**:
- Override `onPairListDevices()` to return single device
- Check if already exists to prevent duplicates

**drivers/energy-gap/device.js**:
- Minimal - receives capability updates from app.js
- Implements `updateMetrics(data)` method called by app

### Step 4: Implement Core Analysis Logic

**lib/EnergyAnalyzer.js**:

```javascript
class EnergyAnalyzer {
  constructor(homey) {
    this.homey = homey;
  }

  async analyze() {
    const api = await this.homey.api.getApi();
    const devices = await api.devices.getDevices();
    
    let totalHome = 0;
    let trackedSum = 0;
    const deviceBreakdown = [];
    
    for (const device of Object.values(devices)) {
      const power = device.capabilitiesObj?.measure_power?.value;
      
      if (this.isEnergyDongle(device)) {
        // Energy Dongle provides total home consumption
        totalHome = power || 0;
      } else if (power != null && power > 0) {
        // Regular device reporting power
        trackedSum += power;
        deviceBreakdown.push({
          id: device.id,
          name: device.name,
          class: device.class,
          power: power
        });
      }
    }
    
    const untracked = Math.max(0, totalHome - trackedSum);
    const untrackedPercent = totalHome > 0 
      ? Math.round((untracked / totalHome) * 100) 
      : 0;
    
    return {
      total: totalHome,
      tracked: trackedSum,
      untracked: untracked,
      untrackedPercent: untrackedPercent,
      deviceCount: deviceBreakdown.length,
      devices: deviceBreakdown.sort((a, b) => b.power - a.power)
    };
  }

  isEnergyDongle(device) {
    // Identify by class or known patterns
    return device.class === 'homemeter' 
      || device.driverUri?.includes('energy-dongle')
      || device.name.toLowerCase().includes('energy dongle');
  }
}
```

### Step 5: Implement Polling in app.js

**app.js**:

```javascript
const Homey = require('homey');
const EnergyAnalyzer = require('./lib/EnergyAnalyzer');

class EnergyGapApp extends Homey.App {
  async onInit() {
    this.log('Energy Gap Analyzer starting...');
    
    this.analyzer = new EnergyAnalyzer(this.homey);
    
    // Initialize Insights logs
    await this.initInsights();
    
    // Start polling with 15-minute interval + jitter
    const jitter = Math.random() * 30000; // 0-30s random delay
    this.homey.setTimeout(() => {
      this.runAnalysis();
      this.pollInterval = this.homey.setInterval(
        () => this.runAnalysis(),
        15 * 60 * 1000 // 15 minutes
      );
    }, jitter);
  }

  async initInsights() {
    const logs = ['power-total', 'power-tracked', 'power-untracked', 'untracked-percent'];
    for (const logId of logs) {
      try {
        await this.homey.insights.createLog(logId, {
          title: { en: logId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
          type: 'number',
          units: logId.includes('percent') ? '%' : 'W',
          decimals: 1
        });
      } catch (e) {
        // Log may already exist
      }
    }
  }

  async runAnalysis() {
    try {
      const result = await this.analyzer.analyze();
      
      // Update virtual device
      const device = this.getEnergyGapDevice();
      if (device) {
        await device.updateMetrics(result);
      }
      
      // Log to Insights
      await this.logToInsights(result);
      
      // Store device breakdown in settings
      this.homey.settings.set('deviceBreakdown', result.devices);
      this.homey.settings.set('lastAnalysis', new Date().toISOString());
      
      this.log(`Analysis: ${result.total}W total, ${result.tracked}W tracked, ${result.untracked}W untracked (${result.untrackedPercent}%)`);
      
    } catch (error) {
      this.error('Analysis failed:', error);
    }
  }

  async logToInsights(result) {
    const logs = {
      'power-total': result.total,
      'power-tracked': result.tracked,
      'power-untracked': result.untracked,
      'untracked-percent': result.untrackedPercent
    };
    
    for (const [logId, value] of Object.entries(logs)) {
      try {
        const log = await this.homey.insights.getLog(logId);
        await log.createEntry(value);
      } catch (e) {
        this.error(`Failed to log ${logId}:`, e);
      }
    }
  }

  getEnergyGapDevice() {
    const driver = this.homey.drivers.getDriver('energy-gap');
    const devices = driver.getDevices();
    return devices[0] || null;
  }

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }
  }
}

module.exports = EnergyGapApp;
```

### Step 6: Set Up Homey Insights

Insights logs created in `initInsights()`:

| Log ID | Type | Units | Purpose |
|--------|------|-------|---------|
| `power-total` | number | W | Total home consumption trend |
| `power-tracked` | number | W | Sum of tracked devices trend |
| `power-untracked` | number | W | Gray area trend over time |
| `untracked-percent` | number | % | Untracked as % of total |

Retention: Homey Insights default (~1 month for detailed, longer for aggregated)

### Step 7: Per-Device Breakdown Storage

Stored in app settings for external access:

```javascript
// Write
this.homey.settings.set('deviceBreakdown', [
  { id: 'xxx', name: 'Living Room TV', class: 'tv', power: 120 },
  { id: 'yyy', name: 'Office PC', class: 'other', power: 85 },
  // ... sorted by power descending
]);

// Read (from app settings API or future settings page)
const breakdown = this.homey.settings.get('deviceBreakdown');
```

### Step 8: Localization

**locales/en.json**:

```json
{
  "capabilities": {
    "power_total": { "title": "Total Home" },
    "power_tracked": { "title": "Tracked Devices" },
    "power_untracked": { "title": "Untracked (Gray)" },
    "untracked_percentage": { "title": "Untracked %" },
    "tracked_device_count": { "title": "Devices Reporting" }
  },
  "drivers": {
    "energy-gap": {
      "name": "Energy Gap Analyzer"
    }
  }
}
```

## Verification

1. **Build & Run**: `homey app run` - app starts without errors
2. **Virtual Device**: Check Devices → "Energy Gap Analyzer" appears with capabilities
3. **Capability Updates**: Wait 15 minutes (or trigger manually), values update
4. **Insights**: Go to Insights → see new logs with data points
5. **Manual Verification**: Compare values:
   - Total should match Energy Dongle reading
   - Tracked should roughly match sum of visible device powers
   - Untracked = Total - Tracked

## Future Enhancements (Optional)

1. **Flow Cards**:
   - Trigger: "Untracked consumption exceeds X watts"
   - Condition: "Untracked is more than X% of total"

2. **Settings Page**: 
   - View per-device breakdown table
   - Configure polling interval
   - Set alert thresholds

3. **Energy Dongle WebSocket**:
   - Real-time total consumption (vs 15-min polling)
   - Requires dongle local API enabled

4. **Device Exclusions**:
   - Let user exclude specific devices from tracking
   - Handle solar/battery with negative power correctly

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Display method | Virtual device | Visible in main Homey UI, no extra app needed |
| History storage | Homey Insights | Native charting, automatic retention, no custom DB |
| Poll interval | 15 minutes | Balance of data resolution vs resource usage |
| Device breakdown | Settings storage | Keeps device UI clean, accessible via API |
| Energy Dongle detection | Class + name pattern | Flexible, handles various installation scenarios |
