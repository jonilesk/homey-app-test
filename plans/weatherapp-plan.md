# Plan: Homey Weather App (FMI Open Data)

## Goal
Create a Homey app that adds a “City Weather” device, fetches temperature from FMI Open Data (WFS), and updates `measure_temperature` on a schedule.

## API choice
- Use FMI Open Data WFS endpoint: http://opendata.fmi.fi/wfs
- Stored queries (examples):
  - `listStoredQueries` to discover available queries
  - `getFeature` with `storedquery_id` and `place=<city>`
- No API key required (public open data), but use conservative polling and backoff.

## App structure (Homey Compose)
```
fi.fmi.weather/
├── app.js                          # App entry point
├── package.json
├── .homeycompose/
│   ├── app.json                    # App manifest (id, name, permissions, etc.)
│   └── drivers/
│       └── weather_city.json       # Driver manifest (class, capabilities, pairing)
├── drivers/
│   └── weather_city/
│       ├── driver.js               # Pairing logic
│       ├── device.js               # FMI polling + capability updates
│       └── assets/
│           └── icon.svg
├── locales/
│   ├── en.json
│   └── fi.json
└── assets/
    └── icon.svg
```

## Device model
- **Driver**: handles pairing to capture `city` (setting or device data)
- **Device**: polls FMI and updates `measure_temperature`
- Capabilities: `measure_temperature` (+ optional `measure_humidity`, `measure_pressure` later)
- Device class: `sensor`

## How it works
1. **Pairing**: User adds "City Weather" device → enters city name in settings.
2. **Polling**: Device calls FMI WFS every 15 min (configurable) with jitter.
3. **Update**: Parses XML response, calls `setCapabilityValue('measure_temperature', temp)`.
4. **Availability**: Marks unavailable on API errors, recovers on success.

## Key file templates

### `.homeycompose/app.json`
```json
{
  "id": "fi.fmi.weather",
  "version": "1.0.0",
  "sdk": 3,
  "platforms": ["local"],
  "name": { "en": "FMI Weather", "fi": "FMI Sää" },
  "description": { "en": "Weather data from Finnish Meteorological Institute" },
  "category": ["climate"],
  "permissions": [],
  "author": { "name": "Your Name" }
}
```

### `.homeycompose/drivers/weather_city.json`
```json
{
  "name": { "en": "City Weather", "fi": "Kaupungin sää" },
  "class": "sensor",
  "capabilities": ["measure_temperature"],
  "settings": [
    { "id": "city", "type": "text", "label": { "en": "City", "fi": "Kaupunki" }, "value": "Helsinki" },
    { "id": "pollInterval", "type": "number", "label": { "en": "Poll interval (min)" }, "value": 15, "min": 5, "max": 60 }
  ],
  "pair": [
    { "id": "list_devices", "template": "list_devices", "navigation": { "next": "add_devices" } },
    { "id": "add_devices", "template": "add_devices" }
  ]
}
```

### `drivers/weather_city/device.js` (core logic outline)
```javascript
const Homey = require('homey');

class WeatherCityDevice extends Homey.Device {
  async onInit() {
    this.pollTimer = null;
    this.startPolling();
  }

  startPolling() {
    const interval = (this.getSetting('pollInterval') || 15) * 60 * 1000;
    const jitter = Math.random() * 30000;
    this.pollTimer = this.homey.setInterval(() => this.fetchWeather(), interval + jitter);
    this.fetchWeather(); // immediate first fetch
  }

  async fetchWeather() {
    const city = this.getSetting('city') || 'Helsinki';
    const url = `http://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::weather::simple&place=${encodeURIComponent(city)}&parameters=temperature`;

    try {
      const res = await fetch(url, { timeout: 10000 });
      const xml = await res.text();
      const temp = this.parseTemperature(xml);
      if (temp !== null) {
        await this.setCapabilityValue('measure_temperature', temp);
        await this.setAvailable();
      }
    } catch (err) {
      this.error('[weather_city] fetch failed', err.message);
      await this.setUnavailable('API unreachable');
    }
  }

  parseTemperature(xml) {
    const match = xml.match(/<BsWfs:ParameterValue>([0-9.-]+)<\/BsWfs:ParameterValue>/);
    return match ? parseFloat(match[1]) : null;
  }

  onDeleted() {
    if (this.pollTimer) this.homey.clearInterval(this.pollTimer);
  }
}

module.exports = WeatherCityDevice;
```

## Polling & reliability
- Interval: 10–15 minutes (configurable), add jitter
- HTTP request timeout (e.g., 8–10s)
- Retry with capped exponential backoff on transient failures
- Use `setUnavailable()` on repeated failures and recover with `setAvailable()`

## Planned steps
1. Create app manifest and driver manifest (compose files)
2. Implement pairing UI/logic for city selection
3. Implement FMI WFS client in `device.js` (fetch + parse temperature)
4. Implement polling loop with backoff and availability handling
5. Add optional Flow cards (manual refresh)
6. Validate on Homey Pro (2023) using `homey app run --remote`

## Implementation checklist
- [x] Install Homey CLI (`npm install -g homey`)
- [x] Login to Homey CLI (`homey login`)
- [ ] Create app skeleton with `homey app create`
- [ ] Add app manifest in `.homeycompose/app.json`
- [ ] Add driver manifest in `.homeycompose/drivers/weather_city.json`
- [ ] Create `drivers/weather_city/driver.js` (pairing)
- [ ] Create `drivers/weather_city/device.js` (FMI fetch + update capability)
- [ ] Add driver icon in `drivers/weather_city/assets/icon.svg`
- [ ] Add locales (en.json, fi.json)
- [ ] Test on device with `homey app run --remote`
- [ ] Verify temperature updates in Homey UI

## Prerequisites check
- [x] Node.js 18+ (found: v20.19.6)
- [x] npm (found: 10.8.2)
- [x] Homey CLI (found: 3.12.2)
- [x] Homey CLI logged in

## Status
**Not started** — run this plan to create the app

## References
- FMI Open Data manual (CSW/WFS): https://en.ilmatieteenlaitos.fi/open-data-manual-api-access-csw
- Homey Apps SDK: https://apps.developer.homey.app/
- Flows: https://apps.developer.homey.app/the-basics/flow
