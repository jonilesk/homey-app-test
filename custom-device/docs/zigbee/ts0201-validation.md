# TS0201 Validation Checklist (Homey Pro 2023)

## Pre-flight
- [ ] Homey Pro (2023) online and reachable
- [ ] Sensor reset available (know how to factory reset)
- [ ] Sensor within 1–2m of Homey (pairing + reporting setup)
- [ ] Fresh batteries in sensor

## Build & validate (local)
```bash
cd <app-folder>
npm ci
homey app validate --level debug
```
- [ ] Validation passes with no errors

## Deploy
```bash
homey app run --remote
```
- [ ] App installs without errors
- [ ] Logs show: `App initialized`, `Driver initialized`

## Pairing
- [ ] Remove old generic Zigbee device
- [ ] Pair via your app → driver `tuya_ts0201`
Expected:
- class: `sensor`
- capabilities: temperature (+ optional humidity), battery

## Probe inventory logs
Expected logs after pairing:
```
[ts0201] Endpoint 1 clusters: [...]
[ts0201] Input clusters: basic, powerConfiguration, temperatureMeasurement, ...
```

Look for these clusters:
- [ ] `basic` (0x0000) — Device info
- [ ] `powerConfiguration` (0x0001) — Battery
- [ ] `temperatureMeasurement` (0x0402) — Temperature
- [ ] `relativeHumidity` (0x0405) — Humidity (optional)

If `0xEF00` (Tuya manufacturer cluster) is present:
- [ ] Note for Phase 2: Tuya datapoint parsing needed

## Temperature
- [ ] Wake sensor
- [ ] Temperature updates within 1–5 minutes
- [ ] Values plausible

## Battery
- [ ] Battery value 0–100
- [ ] Low battery alarm at threshold

## Stability
- [ ] Idle 30–60 minutes
- [ ] No crashes, minimal availability flapping
- [ ] App memory stable (no leaks)

## Troubleshooting

### Device doesn't pair
1. Factory reset the sensor (usually hold button 5+ seconds)
2. Ensure no other Zigbee coordinator is nearby
3. Check fingerprint matches in `driver.compose.json`

### No temperature updates
1. Wake the sensor (button press)
2. Check logs for reporting configuration errors
3. Verify `temperatureMeasurement` cluster exists

### Battery always 0 or 200
1. Check scaling: `batteryPercentageRemaining` is 0.5% units → divide by 2
2. Some devices use `batteryVoltage` instead

### Device flaps unavailable
1. Normal for sleepy devices between reports
2. Increase reporting max interval
3. Don't mark unavailable on single missed report

## Pass/Fail summary
- [ ] **PASS:** All checks above completed successfully
- [ ] **FAIL:** Document issues and iterate
