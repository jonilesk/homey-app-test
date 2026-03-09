# Solcast PV Forecast

Homey Pro app for solar production forecasting powered by Solcast satellite data.

## Features

- Satellite-based solar production forecasts (up to 14 days)
- Power now, 30-min, 1-hour predictions
- Daily forecasts (today, tomorrow, remaining)
- Peak power and timing predictions
- Three confidence levels (10%, 50%, 90%)
- Smart update scheduling (sunrise/sunset aware)
- API quota management
- Flow cards for automation

## Setup

1. Get a free API key at [toolkit.solcast.com.au](https://toolkit.solcast.com.au)
2. Add your rooftop site(s) in the Solcast dashboard
3. Install this app on Homey and pair with your API key

## CLI Tools

Test before deploying to Homey:

```bash
cd solcast-app

# One-shot forecast (uses 1 API call)
SOLCAST_API_KEY=your_key node cli/fetch-forecast.js

# Continuous monitoring
SOLCAST_API_KEY=your_key node cli/monitor.js
```

## Install on Homey

```bash
homey app run --remote    # Dev mode
homey app install         # Permanent install
```

## Project Structure

```
lib/
  SolcastApi.js           HTTPS client (fetch + AbortController)
  ForecastAggregator.js   Forecast math (power, energy, peak)
cli/                      Command-line test tools
drivers/forecast/         Virtual forecast device
.homeycompose/            Capabilities + flow cards
```

## API Usage

Free tier: ~10 calls/day. Each site forecast fetch = 1 call. The app distributes calls intelligently between sunrise and sunset.
