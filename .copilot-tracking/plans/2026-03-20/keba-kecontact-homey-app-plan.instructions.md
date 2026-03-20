---
applyTo: '.copilot-tracking/changes/2026-03-20/keba-kecontact-homey-app-changes.md'
---
<!-- markdownlint-disable-file -->
# Implementation Plan: KEBA KeContact Homey App

## Overview

Build a Homey Pro app for KEBA KeContact EV chargers (P20, P30, BMW Wallbox) by porting the `keba-kecontact` Python library to Node.js, using the UDP protocol for local LAN communication and integrating with Homey Energy.

## Objectives

### User Requirements

* Analyze the `keba-kecontact` Python library (v4.3.0) as the authoritative source — Source: conversation + attached research
* Map the UDP protocol, data points, and services to Homey capabilities — Source: conversation
* Design a Homey app that integrates with Homey Energy (`measure_power`, `meter_power`, device class `evcharger`) — Source: conversation
* Follow the HA-to-Homey migration guide patterns — Source: conversation

### Derived Objectives

* Implement singleton UDP socket management shared across all charger devices — Derived from: KEBA protocol requires port 7090 binding (single port shared)
* Support dynamic capabilities per charger model (P20 vs P30 vs BMW) — Derived from: models have differing feature sets (meter, display, auth, data logger)
* Build CLI test tools to validate UDP communication before Homey deployment — Derived from: project convention (CLI-first development pattern from solarman-app)
* Implement flow cards for charging automation (triggers, conditions, actions) — Derived from: standard Homey app completeness for EV charger use case
* Configure failsafe mode to keep charger safe on app communication loss — Derived from: KEBA failsafe command exists and prevents uncontrolled charging

## Context Summary

### Project Files

* `source/keba-kecontact/` — Python source library (v4.3.0) containing the UDP protocol implementation, data models, and emulator
* `docs/14-ha-app-to-homey-migration.md` — Migration patterns from HA Python integrations to Homey Node.js apps
* `docs/05-drivers-devices-capabilities.md` — Driver conventions, capability patterns, device classes
* `docs/02-project-structure-homey-compose.md` — homeycompose structure, custom capabilities, flow cards
* `solarman-app/` — Primary reference implementation with identical architectural patterns (singleton protocol client, polling, pairing, CLI tools)
* `solcast-app/` — Secondary reference for AbortController timeout pattern and custom error classes

### References

* `.copilot-tracking/research/2026-03-20/keba-kecontact-homey-app-research.md` — Primary research document with full protocol specification, data point inventory, and capability mapping
* `.copilot-tracking/research/subagents/2026-03-20/keba-reference-patterns-research.md` — Reference patterns from solarman-app, solcast-app, and project conventions

### Standards References

* `.github/copilot-instructions.md` — Homey app development conventions (error handling, polling jitter, capability updates, cleanup)

## Implementation Checklist

### [ ] Implementation Phase 1: Protocol Client Library (`lib/`)

<!-- parallelizable: false -->

* [ ] Step 1.1: Create `lib/KebaUdpClient.js` — Singleton UDP socket manager
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 18-75)
* [ ] Step 1.2: Create `lib/KebaDataParser.js` — Report parsing and data scaling
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 77-140)
* [ ] Step 1.3: Create `lib/KebaDeviceInfo.js` — Product string parsing and feature detection
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 142-190)

### [ ] Implementation Phase 2: CLI Test Tools (`cli/`)

<!-- parallelizable: false -->
<!-- Depends on Phase 1 -->

* [ ] Step 2.1: Create `cli/discover.js` — UDP broadcast discovery tool
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 192-220)
* [ ] Step 2.2: Create `cli/read-status.js` — One-shot report reader
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 222-250)
* [ ] Step 2.3: Create `cli/monitor.js` — Continuous polling monitor
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 252-280)
* [ ] Step 2.4: Validate Phase 2 — Test CLI tools against real KEBA charger
  * Run `node cli/discover.js` and `node cli/read-status.js --host 10.1.1.13`

### [ ] Implementation Phase 3: App Scaffold and Compose Files

<!-- parallelizable: true -->
<!-- Can run in parallel with Phase 4 after Phase 2 validated -->

* [ ] Step 3.1: Create project scaffold (`package.json`, `.homeycompose/app.json`, `app.js`, `assets/icon.svg`)
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 282-340)
* [ ] Step 3.2: Create custom capabilities in `.homeycompose/capabilities/`
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 342-430)
* [ ] Step 3.3: Create `drivers/keba/driver.compose.json` — Driver manifest with capabilities, energy, pairing, settings
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 432-510)

### [ ] Implementation Phase 4: Driver and Device

<!-- parallelizable: false -->
<!-- Depends on Phase 3 (driver.compose.json, custom capabilities) -->

* [ ] Step 4.1: Create `drivers/keba/driver.js` — Pairing flow with IP entry and connection validation
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 512-580)
* [ ] Step 4.2: Create `drivers/keba/device.js` — Polling lifecycle, capability updates, command handlers
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 582-720)

### [ ] Implementation Phase 5: Flow Cards

<!-- parallelizable: false -->
<!-- Depends on Phase 3 compose files + Phase 4 device.js -->

* [ ] Step 5.1: Create flow trigger cards (`.homeycompose/flow/triggers/`)
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 722-790)
* [ ] Step 5.2: Create flow condition cards (`.homeycompose/flow/conditions/`)
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 792-830)
* [ ] Step 5.3: Create flow action cards (`.homeycompose/flow/actions/`)
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 832-890)
* [ ] Step 5.4: Register flow cards in `app.js`
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 892-940)

### [ ] Implementation Phase 6: Localization

<!-- parallelizable: true -->

* [ ] Step 6.1: Create `locales/en.json` with all user-facing strings
  * Details: .copilot-tracking/details/2026-03-20/keba-kecontact-homey-app-details.md (Lines 942-980)

### [ ] Implementation Phase 7: Validation

<!-- parallelizable: false -->

* [ ] Step 7.1: Run full project validation
  * Execute `homey app validate --level publish`
  * Execute `homey app run --remote` on test Homey
  * Verify Homey Energy integration shows correct power/energy readings
* [ ] Step 7.2: Fix minor validation issues
  * Iterate on validation errors, compose file issues, capability mismatches
* [ ] Step 7.3: Report blocking issues
  * Document issues requiring additional research (UDP sandbox restrictions, encoding edge cases)
  * Provide next steps and recommended testing

## Planning Log

See [keba-kecontact-homey-app-log.md](.copilot-tracking/plans/logs/2026-03-20/keba-kecontact-homey-app-log.md) for discrepancy tracking, implementation paths considered, and suggested follow-on work.

## Dependencies

* Node.js `dgram` module (built-in) — UDP communication
* `commander` npm package — CLI tool argument parsing
* Homey SDK runtime (provided by Homey, not in `package.json`)
* Homey CLI (`homey`) for app validation, running, and installation
* Access to KEBA charger on local LAN for live testing (Airaksela `10.1.1.13`, Riitekatu `192.168.42.1`)

## Success Criteria

* UDP communication working: discover, report, and command round-trips confirmed via CLI tools — Traces to: Protocol Specification in research
* `measure_power` and `meter_power` correctly reporting in Homey Energy panel — Traces to: Energy Integration Design in research
* Device pairs via IP entry and shows correct model/serial — Traces to: Device Model Variations in research
* Dynamic capabilities added per model features (meter, display, auth) — Traces to: Device Model Variations in research
* Polling with jitter, quick-poll after commands, cleanup on uninit — Traces to: Homey app conventions in copilot-instructions.md
* Flow cards functional: charging started/stopped triggers, is_charging condition, set_current action — Traces to: Services and Action Mapping in research
* `homey app validate --level publish` passes with no errors — Traces to: user requirement for App Store readiness
