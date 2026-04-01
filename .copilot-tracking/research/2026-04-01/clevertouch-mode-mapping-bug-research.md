<!-- markdownlint-disable-file -->
# Task Research: CleverTouch Mode Mapping Bug

The CleverTouch Homey app displays wrong target temperature when changing modes.
Anti-freeze (Frost) works correctly, but ECO and other modes show incorrect setpoints.

## Root Cause

The gv_mode value mapping in device.js is almost entirely wrong.
Compared to the authoritative Python library (hemphen/clevertouch),
values 0, 1, 3, 4, 5 are all incorrectly mapped. Only value 2 (Frost) is correct.

## Correct Mode Mapping (from Python library)

| gv_mode | Python Library (CORRECT) | device.js (WRONG) |
|---------|------------------------|-------------------|
| 0       | Comfort                | Off               |
| 1       | Off                    | Eco               |
| 2       | Frost                  | Frost (correct!)  |
| 3       | Eco                    | Comfort           |
| 4       | Boost                  | Program           |
| 5       | (unmapped)             | Boost             |
| 8       | Program (comfort temp) | (unmapped)        |
| 11      | Program (eco temp)     | (unmapped)        |

Source: https://github.com/hemphen/clevertouch/blob/main/src/clevertouch/devices/radiator.py
SHA: 280d01bd560e9e2fd0bf098cf4761fa337ea8b1b

## Bug Mechanism

When user sets ECO mode in CleverTouch app:
1. API returns gv_mode=3 (ECO per Python library)
2. device.js maps 3 to Comfort (WRONG)
3. Switch reads consigne_confort = 22.0C (comfort setpoint)
4. Homey shows 22.0C instead of correct ECO setpoint 16.0C

Why anti-freeze works: Frost is gv_mode=2 in both Python library AND device.js.

## Impact - Reading State (Polling)

| Actual Mode | gv_mode | device.js sees | Reads from | Result |
|-------------|---------|---------------|------------|--------|
| Comfort     | 0       | Off           | consigne_hg | WRONG  |
| Off         | 1       | Eco           | consigne_eco | WRONG  |
| Frost       | 2       | Frost         | consigne_hg | OK     |
| Eco         | 3       | Comfort       | consigne_confort | WRONG |
| Boost       | 4       | Program       | consigne_confort | WRONG |
| Program     | 8/11    | Unknown       | default    | WRONG  |

## Impact - Writing Mode (from Homey UI)

| User selects | Sends | API interprets as | Result |
|-------------|-------|-------------------|--------|
| Off         | 0     | Comfort           | WRONG  |
| Eco         | 1     | Off               | WRONG  |
| Frost       | 2     | Frost             | OK     |
| Comfort     | 3     | Eco               | WRONG  |
| Program     | 4     | Boost             | WRONG  |
| Boost       | 5     | Unknown           | WRONG  |

## Fix Required

### Files to change

1. clevertouch-app/drivers/radiator/device.js (lines 10-28, 159-184)
2. clevertouch-app/lib/CleverTouchOAuth2Client.js (setDeviceMode JSDoc)

### New mode constants for device.js

API: 0=Comfort, 1=Off, 2=Frost, 3=Eco, 4=Boost, 8=Program(comfort), 11=Program(eco)

HEAT_MODE_TO_VALUE:
  Comfort -> 0, Off -> 1, Frost -> 2, Eco -> 3, Boost -> 4, Program -> 11

VALUE_TO_HEAT_MODE:
  0 -> Comfort, 1 -> Off, 2 -> Frost, 3 -> Eco, 4 -> Boost, 8 -> Program, 11 -> Program

### Program mode has two variants

gv_mode=8 uses comfort temperature, gv_mode=11 uses eco temperature.
The switch case for Program needs to check effectiveMode to pick the right setpoint.

### Temperature conversion is correct

Python formula (d - 320) / 18 equals device.js (d/10 - 32) * 5/9. No change needed.

## Potential Follow-up Research

1. The _homeGeneralMode override logic (device.js lines 138-142) may need review.
   If general_mode uses same numbering, 0=Comfort not no-override.
   The condition >= 1 and <= 5 misses Program variants (8, 11).

2. gv_mode values 5, 6, 13, 15, 16 are commented out in Python library.
   These modes exist in the API but are not fully understood.

## Rejected Alternatives

1. Partial fix (only swap Eco/Comfort): Rejected. Off, Boost, Program also wrong.
2. Add logging first: Rejected. Python library is proven reference, no delay needed.

## Evidence Sources

1. Python library source: hemphen/clevertouch radiator.py (authoritative)
2. CleverTouch Gen.2 official app screenshots (user-provided)
3. Homey app device.js current code (lines 10-28)
4. CleverTouchOAuth2Client.js setDeviceMode comment
5. Project docs: 02-api-endpoints.md, 03-api-library-analysis.md, 04-data-model.md
