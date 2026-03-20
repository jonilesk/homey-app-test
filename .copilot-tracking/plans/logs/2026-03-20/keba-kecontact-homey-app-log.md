<!-- markdownlint-disable-file -->
# Planning Log: KEBA KeContact Homey App

## Discrepancy Log

Gaps and differences identified between research findings and the implementation plan.

### Unaddressed Research Items

* DR-01: Homey `dgram` sandbox restrictions not verified
  * Source: keba-kecontact-homey-app-research.md (Lines 703-704) — "Potential Next Research"
  * Reason: Cannot test locally without deploying to Homey hardware; documented as Phase 7 validation item
  * Impact: high — if `dgram.bind()` is blocked on Homey, entire UDP approach needs rework (e.g., raw socket via native module)

* DR-02: cp437 encoding for outgoing commands not validated in Node.js
  * Source: keba-kecontact-homey-app-research.md (Lines 700-702) — "Potential Next Research"
  * Reason: Python library uses cp437 encoding; all KEBA commands are ASCII-safe, so UTF-8 should work. Will validate via CLI tools in Phase 2
  * Impact: low — ASCII commands are identical in cp437 and UTF-8

* DR-03: Phase-switching `x2` command 5-minute hardware cooldown not implemented
  * Source: keba-kecontact-homey-app-research.md (Lines 709-711) — "Potential Next Research"
  * Reason: Phase switching is an advanced feature; deferred to follow-on work to keep initial scope manageable
  * Impact: medium — feature available but risky without cooldown enforcement

* DR-04: Report 100+ (session log / data logger) parsing not included
  * Source: keba-kecontact-homey-app-research.md (Lines 113-114) — Report 100 description
  * Reason: Data logger reports contain session history, not real-time data. Lower priority for initial release
  * Impact: low — no user-facing capability depends on this

* DR-05: `evcharger` device class built-in expectations not verified against Homey SDK
  * Source: keba-kecontact-homey-app-research.md (Lines 706-707) — "Potential Next Research"
  * Reason: No SDK documentation available in workspace; will verify during Phase 7 validation
  * Impact: medium — Homey may expect specific capabilities for `evcharger` class

* DR-06: Three protocol commands not addressed in plan or follow-on work (`currtime`, `unlock`, `output`)
  * Source: keba-kecontact-homey-app-research.md Protocol Commands table (Lines 120-140) — `currtime {mA} {seconds}`, `unlock`, `output {0|1|10-150}`
  * Reason: `currtime` (temporary current with timeout) overlaps with `curr` (permanent); `unlock` is emergency cable release; `output` is hardware-specific pin control. None map to common EV charging use cases
  * Impact: low — `curr` covers primary current-setting need; `unlock` and `output` are edge cases; all can be added as follow-on work if needed

* DR-07: `set_charging_power` service (calculate current from target power) not addressed
  * Source: keba-kecontact-homey-app-research.md const.py KebaService enum (Line 48) — `set_charging_power`; charging_station.py service implementation
  * Reason: This is a Python library convenience method that calculates required current from desired power, voltage, and phase count. Useful as "Set charging power in kW" flow action but not a raw protocol command
  * Impact: low — users can manually set current via the existing `set_charging_current` action; power-based setting is a UX convenience

### Plan Deviations from Research

* DD-01: Research recommends 30s default poll interval; plan allows 10s minimum via settings
  * Research recommends: 30s default poll interval
  * Plan implements: 30s default with 10s minimum configurable floor
  * Rationale: Solarman-app pattern uses configurable intervals; 10s floor prevents excessive load while allowing responsive updates during active charging

* DD-02: Research shows fast polling at 5s × 6 after commands; plan uses 15s × 3 quick poll
  * Research recommends: 5s interval, 6 cycles (~30s fast period) per Python source
  * Plan implements: 15s interval, 3 cycles (~45s fast period) per solarman-app convention
  * Rationale: Aligning with existing codebase convention; both approaches provide adequate post-command responsiveness

* DD-04: Research maps individual boolean plug capabilities; plan consolidates to single enum
  * Research recommends: `keba_plug_ev` (boolean) and `keba_plug_cs` (boolean) as separate capabilities per capability mapping table (Lines 215-245)
  * Plan implements: `keba_cable_state` (enum with 5 states: no_cable, cable_cs, cable_locked, cable_ev, cable_locked_ev) consolidating all plug information
  * Rationale: Enum provides richer state information in a single capability; decoded boolean values still available internally for flow trigger logic (cable_connected/disconnected)

* DD-05: Research includes `keba_charging` boolean capability; plan omits dedicated boolean
  * Research recommends: `keba_charging` (boolean, true when actively charging) per capability mapping table (Lines 215-245)
  * Plan implements: `keba_charging_state` (enum) only; no dedicated boolean capability
  * Rationale: The `onoff` capability indicates enabled status; the enum covers 'charging' state; the `is_charging` condition flow card provides boolean check. A dedicated boolean would be redundant with the enum and the flow condition

* DD-06: Research includes `display_text` in proposed flow actions; plan defers to follow-on work
  * Research recommends: `display_text` action card in flow actions table (Lines 587-600)
  * Plan implements: 4 action cards (set_charging_current, set_energy_limit, enable_charging, disable_charging); display_text deferred to WI-05
  * Rationale: Display is P30-only feature; initial scope focuses on core charging functionality common to all models

## Implementation Paths Considered

### Selected: Single driver with dynamic capabilities and singleton UDP manager

* Approach: One `keba` driver for all KEBA models (P20, P30, BMW). Singleton `KebaUdpClient` in `lib/` owned by `app.js`. Dynamic capabilities added per model features detected from Report 1 product string
* Rationale: All models use identical UDP protocol on port 7090. Only feature availability differs. Singleton is required because only one process can bind to UDP port 7090. Matches Python source architecture
* Evidence: keba-kecontact-homey-app-research.md (Lines 280-345) — Technical Scenario analysis

### IP-01: Multiple drivers per model (keba-p20, keba-p30, keba-bmw)

* Approach: Separate driver directories per charger model
* Trade-offs: Clearer model separation but significant code duplication; protocol is identical across models
* Rejection rationale: Dynamic capabilities handle feature differences cleanly. One driver with feature flags is simpler and matches how the Python library handles model variations

### IP-02: One UDP socket per device

* Approach: Each device.js creates its own UDP socket
* Trade-offs: Simpler device isolation but impossible to implement — port 7090 can only be bound once
* Rejection rationale: KEBA protocol mandates port 7090 for both sending and receiving. Multiple sockets cannot bind to the same port. The singleton pattern matches the Python `KebaKeContact` class design

### IP-03: Discovery-based pairing (broadcast) instead of manual IP entry

* Approach: Broadcast "i" command to discover chargers on the LAN, present as selectable list
* Trade-offs: Better UX but requires broadcast to work on the Homey's network; may not reach chargers on different subnets/VLANs
* Rejection rationale: Not rejected — documented as future enhancement. Manual IP entry is more reliable as primary pairing method. Discovery can be added as optional Step 2 in pairing flow

## Suggested Follow-On Work

Items identified during planning that fall outside current scope.

* WI-01: Phase switching (x2/x2src) support — Add flow cards and capability for 1-phase/3-phase switching with 5-minute cooldown enforcement (medium priority)
  * Source: DR-03, keba-kecontact-homey-app-research.md Lines 139-140
  * Dependency: Core app must be functional first (Phase 7 complete)

* WI-02: Discovery-based pairing — Add broadcast discovery as optional first step in pairing flow (low priority)
  * Source: IP-03 above
  * Dependency: None beyond core pairing flow

* WI-03: Session data logging from Report 100 — Parse and expose charging session history (low priority)
  * Source: DR-04
  * Dependency: Phase 1 protocol client must support report 100 responses

* WI-04: RFID authorization flow actions — Add flow actions for start/stop with RFID tag parameters (medium priority)
  * Source: keba-kecontact-homey-app-research.md Lines 133-134, KebaService.start/stop
  * Dependency: Core app functional, models with auth support confirmed

* WI-05: Display text flow action — Show custom text on P30 display via flow card (low priority)
  * Source: keba-kecontact-homey-app-research.md Line 136, display command
  * Dependency: Core app functional, P30 model with display confirmed

* WI-06: Failsafe configuration settings — Expose failsafe timeout, current, and persistence as device settings (medium priority)
  * Source: keba-kecontact-homey-app-research.md Line 140, failsafe command
  * Dependency: Core app functional

* WI-07: Additional protocol commands (`currtime`, `unlock`, `output`) — Add flow actions for temporary current limit, socket unlock, and output pin control (low priority)
  * Source: DR-06, keba-kecontact-homey-app-research.md Lines 120-140
  * Dependency: Core app functional

* WI-08: Power-based current setting (`set_charging_power`) — Add convenience flow action to set charging power in kW, auto-calculating current from voltage and phases (low priority)
  * Source: DR-07, keba-kecontact-homey-app-research.md Line 48
  * Dependency: Core app functional, Report 3 voltage data available
