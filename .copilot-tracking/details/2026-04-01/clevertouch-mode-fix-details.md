<!-- markdownlint-disable-file -->
# Implementation Details: CleverTouch Mode Mapping Fix

## Context Reference

Sources:
* .copilot-tracking/research/2026-04-01/clevertouch-mode-mapping-bug-research.md
* https://github.com/hemphen/clevertouch/blob/main/src/clevertouch/devices/radiator.py (SHA: 280d01bd)

## Implementation Phase 1: Fix Mode Mapping Constants

<!-- parallelizable: false -->

### Step 1.1: Replace HEAT_MODE_TO_VALUE and VALUE_TO_HEAT_MODE constants

Replace lines 10-28 of clevertouch-app/drivers/radiator/device.js.

Corrected values from Python library _HEAT_MODE_TO_DEVICE and _DEVICE_TO_MODE_TYPE:

HEAT_MODE_TO_VALUE: Comfort->0, Off->1, Frost->2, Eco->3, Boost->4, Program->11
VALUE_TO_HEAT_MODE: 0->Comfort, 1->Off, 2->Frost, 3->Eco, 4->Boost, 8->Program, 11->Program

Program has TWO API values (8 and 11). Write uses 11 (matches Python library default).
Value 5 is removed (actual Boost is value 4).

Files:
* clevertouch-app/drivers/radiator/device.js - Replace lines 10-28

### Step 1.2: Update target temperature switch case for Program mode

Update lines 175-178 of clevertouch-app/drivers/radiator/device.js.

Only the Program case changes. Check effectiveMode raw value:
- effectiveMode == 8: use consigne_confort (Program comfort schedule)
- effectiveMode == 11: use consigne_eco (Program eco schedule)

The effectiveMode variable is already in scope (line 134).

Files:
* clevertouch-app/drivers/radiator/device.js - Modify lines 175-178

### Step 1.3: Update homeGeneralMode override range

Update lines 136-142 of clevertouch-app/drivers/radiator/device.js.

Current: homeGeneralMode >= 1 && homeGeneralMode <= 5
Replace with: homeGeneralMode > 0 && VALUE_TO_HEAT_MODE[homeGeneralMode] !== undefined

This handles Program variants (8, 11). Value 0 stays as no-override (see DR-01).

Files:
* clevertouch-app/drivers/radiator/device.js - Modify lines 131-142

### Step 1.4: Update API client JSDoc comment

Update line 307 of clevertouch-app/lib/CleverTouchOAuth2Client.js.

Change: 0=Off, 1=Frost, 2=Eco, 3=Comfort, 4=Program, 5=Boost
To: 0=Comfort, 1=Off, 2=Frost, 3=Eco, 4=Boost, 8=Program(comfort), 11=Program(eco)

Files:
* clevertouch-app/lib/CleverTouchOAuth2Client.js - Modify line 307

## Implementation Phase 2: Validation

<!-- parallelizable: false -->

### Step 2.1: Run homey app validate --level debug

### Step 2.2: Verify mode constants consistency

### Step 2.3: Search for hardcoded mode values in flow cards and driver.js

### Step 2.4: Fix minor issues
