'use strict';

const Homey = require('homey');
const {
  PROP, ACTION, VACUUM_STATE, CLEANING_STATES, CHARGING_STATES,
  SUCTION_LEVEL, SUCTION_LEVEL_REVERSE,
  CLEANING_MODE, CLEANING_MODE_REVERSE,
  decodeCleaningMode,
  WATER_VOLUME, WATER_VOLUME_REVERSE,
  POLL_PROPERTIES,
} = require('../../lib/MiOTProperties');

const POLL_INTERVAL_NORMAL = 120 * 1000;  // 2 minutes
const POLL_INTERVAL_QUICK = 15 * 1000;    // 15 seconds
const QUICK_POLL_COUNT = 5;
const MAX_CONSECUTIVE_FAILURES = 3;

class DreameVacuumDevice extends Homey.Device {

  async onInit() {
    this.log('[device:vacuum] initializing', { id: this.getData().id, model: this.getData().model });

    this._consecutiveFailures = 0;
    this._quickPollsRemaining = 0;
    this._previousStatus = null;

    // Ensure all required capabilities exist (for future migrations)
    const requiredCapabilities = [
      'onoff', 'measure_battery',
      'dreame_status', 'dreame_fan_speed', 'dreame_clean_mode', 'dreame_water_flow',
      'dreame_cleaned_area', 'dreame_cleaning_time',
      'dreame_main_brush', 'dreame_side_brush', 'dreame_filter',
    ];
    for (const cap of requiredCapabilities) {
      if (!this.hasCapability(cap)) {
        this.log(`[device:vacuum] adding missing capability: ${cap}`);
        await this.addCapability(cap).catch(err => this.error(`Failed to add ${cap}:`, err));
      }
    }

    // Register capability listeners
    this.registerCapabilityListener('onoff', this._onCapabilityOnOff.bind(this));
    this.registerCapabilityListener('dreame_fan_speed', this._onCapabilityFanSpeed.bind(this));
    this.registerCapabilityListener('dreame_clean_mode', this._onCapabilityCleanMode.bind(this));
    this.registerCapabilityListener('dreame_water_flow', this._onCapabilityWaterFlow.bind(this));

    // Start polling with jitter (0-20s initial delay)
    const jitter = Math.floor(Math.random() * 20000);
    this.log(`[device:vacuum] starting poll with ${Math.round(jitter / 1000)}s jitter`);

    this._pollTimeout = this.homey.setTimeout(async () => {
      await this.poll();
      this._pollInterval = this.homey.setInterval(() => this.poll(), POLL_INTERVAL_NORMAL);
    }, jitter);

    this.log('[device:vacuum] initialized');
  }

  async onUninit() {
    this.log('[device:vacuum] uninitializing');
    if (this._pollTimeout) {
      this.homey.clearTimeout(this._pollTimeout);
      this._pollTimeout = null;
    }
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._quickPollTimer) {
      this.homey.clearInterval(this._quickPollTimer);
      this._quickPollTimer = null;
    }
  }

  // ─── Cloud client accessor ───────────────────────────────────

  get _dreameCloud() {
    return this.homey.app.dreameCloud;
  }

  get _did() {
    return this.getData().id;
  }

  get _host() {
    return this.getStoreValue('bindDomain') || '';
  }

  // ─── Polling ─────────────────────────────────────────────────

  async poll() {
    try {
      if (!this._dreameCloud.isLoggedIn) {
        this.log('[device:vacuum] skipping poll: not logged in');
        return;
      }

      this.log('[device:vacuum] polling properties...');
      const results = await this._dreameCloud.getProperties(this._did, POLL_PROPERTIES, this._host);
      this.log('[device:vacuum] poll got', results?.length, 'results');

      // Parse results into a lookup map
      const values = {};
      for (const r of results) {
        if (r.code === 0 && r.value !== undefined) {
          const key = `${r.siid}.${r.piid}`;
          values[key] = r.value;
        }
      }
      this.log('[device:vacuum] poll values:', JSON.stringify(values));

      // Map STATE → dreame_status
      const stateInt = values[`${PROP.STATE.siid}.${PROP.STATE.piid}`];
      const statusStr = VACUUM_STATE[stateInt] || 'idle';
      this.log('[device:vacuum] setting dreame_status →', statusStr, '(raw:', stateInt, ')');
      this._updateCapability('dreame_status', statusStr);

      // Detect state transitions for flow triggers
      this._handleStateTransitions(statusStr);

      // Map battery
      const battery = values[`${PROP.BATTERY_LEVEL.siid}.${PROP.BATTERY_LEVEL.piid}`];
      if (battery !== undefined) {
        this.log('[device:vacuum] setting measure_battery →', battery);
        this._updateCapability('measure_battery', battery);
      }

      // Map suction level → dreame_fan_speed
      const suctionInt = values[`${PROP.SUCTION_LEVEL.siid}.${PROP.SUCTION_LEVEL.piid}`];
      if (suctionInt !== undefined && SUCTION_LEVEL[suctionInt]) {
        this.log('[device:vacuum] setting dreame_fan_speed →', SUCTION_LEVEL[suctionInt], '(raw:', suctionInt, ')');
        this._updateCapability('dreame_fan_speed', SUCTION_LEVEL[suctionInt]);
      }

      // Map cleaning mode → dreame_clean_mode (handles grouped values for self-wash-base devices)
      const modeInt = values[`${PROP.CLEANING_MODE.siid}.${PROP.CLEANING_MODE.piid}`];
      if (modeInt !== undefined) {
        const modeStr = decodeCleaningMode(modeInt);
        this.log('[device:vacuum] setting dreame_clean_mode →', modeStr, '(raw:', modeInt, ')');
        if (modeStr) {
          this._updateCapability('dreame_clean_mode', modeStr);
        }
      }

      // Map water volume → dreame_water_flow
      const waterInt = values[`${PROP.WATER_VOLUME.siid}.${PROP.WATER_VOLUME.piid}`];
      if (waterInt !== undefined && WATER_VOLUME[waterInt]) {
        this.log('[device:vacuum] setting dreame_water_flow →', WATER_VOLUME[waterInt], '(raw:', waterInt, ')');
        this._updateCapability('dreame_water_flow', WATER_VOLUME[waterInt]);
      }

      // Map cleaning statistics
      const cleanedArea = values[`${PROP.CLEANED_AREA.siid}.${PROP.CLEANED_AREA.piid}`];
      if (cleanedArea !== undefined) {
        this._updateCapability('dreame_cleaned_area', cleanedArea);
      }

      const cleaningTime = values[`${PROP.CLEANING_TIME.siid}.${PROP.CLEANING_TIME.piid}`];
      if (cleaningTime !== undefined) {
        this._updateCapability('dreame_cleaning_time', cleaningTime);
      }

      // Map consumable levels
      const mainBrush = values[`${PROP.MAIN_BRUSH_LEFT.siid}.${PROP.MAIN_BRUSH_LEFT.piid}`];
      if (mainBrush !== undefined) {
        this._updateCapability('dreame_main_brush', mainBrush);
      }

      const sideBrush = values[`${PROP.SIDE_BRUSH_LEFT.siid}.${PROP.SIDE_BRUSH_LEFT.piid}`];
      if (sideBrush !== undefined) {
        this._updateCapability('dreame_side_brush', sideBrush);
      }

      const filter = values[`${PROP.FILTER_LEFT.siid}.${PROP.FILTER_LEFT.piid}`];
      if (filter !== undefined) {
        this._updateCapability('dreame_filter', filter);
      }

      // Map onoff based on cleaning state
      const isCleaning = CLEANING_STATES.has(statusStr);
      this._updateCapability('onoff', isCleaning);

      // Reset failure counter and mark available
      this._consecutiveFailures = 0;
      if (!this.getAvailable()) {
        await this.setAvailable();
        this.log('[device:vacuum] device available again');
      }

    } catch (err) {
      this._consecutiveFailures++;
      this.error(`[device:vacuum] poll failed (${this._consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, err.message);

      if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && this.getAvailable()) {
        await this.setUnavailable('Cannot reach device').catch(() => {});
        this.log('[device:vacuum] marked unavailable');
      }
    }
  }

  // ─── State transition detection (flow triggers) ──────────────

  _handleStateTransitions(newStatus) {
    const prev = this._previousStatus;
    this._previousStatus = newStatus;

    if (prev === null) return; // First poll, no transition
    if (prev === newStatus) return; // No change

    // Cleaning started: non-cleaning → cleaning
    if (!CLEANING_STATES.has(prev) && CLEANING_STATES.has(newStatus)) {
      this.homey.flow.getDeviceTriggerCard('cleaning_started')
        .trigger(this).catch(err => this.error('[flow] cleaning_started trigger failed:', err));
    }

    // Cleaning finished: cleaning → non-cleaning (but not error)
    if (CLEANING_STATES.has(prev) && !CLEANING_STATES.has(newStatus) && newStatus !== 'error') {
      this.homey.flow.getDeviceTriggerCard('cleaning_finished')
        .trigger(this).catch(err => this.error('[flow] cleaning_finished trigger failed:', err));
    }

    // Error occurred: anything → error
    if (newStatus === 'error' && prev !== 'error') {
      this.homey.flow.getDeviceTriggerCard('error_occurred')
        .trigger(this).catch(err => this.error('[flow] error_occurred trigger failed:', err));
    }

    // Returned to dock: returning → charging/idle
    if (prev === 'returning' && CHARGING_STATES.has(newStatus)) {
      this.homey.flow.getDeviceTriggerCard('returned_to_dock')
        .trigger(this).catch(err => this.error('[flow] returned_to_dock trigger failed:', err));
    }
  }

  // ─── Quick polling after commands ────────────────────────────

  _scheduleQuickPoll() {
    this._quickPollsRemaining = QUICK_POLL_COUNT;

    if (!this._quickPollTimer) {
      this.log('[device:vacuum] starting quick poll');
      this._quickPollTimer = this.homey.setInterval(() => {
        this.poll();
        this._quickPollsRemaining--;

        if (this._quickPollsRemaining <= 0) {
          this.log('[device:vacuum] quick poll complete');
          this.homey.clearInterval(this._quickPollTimer);
          this._quickPollTimer = null;
        }
      }, POLL_INTERVAL_QUICK);
    }
  }

  // ─── Capability update helper ────────────────────────────────

  _updateCapability(name, value) {
    if (this.hasCapability(name)) {
      const current = this.getCapabilityValue(name);
      if (current !== value) {
        this.setCapabilityValue(name, value)
          .catch(err => this.error(`[device:vacuum] failed to set ${name}:`, err));
      }
    }
  }

  // ─── Capability listeners ────────────────────────────────────

  async _onCapabilityOnOff(value) {
    this.log('[device:vacuum] onoff →', value);
    if (value) {
      await this.startCleaning();
    } else {
      await this.returnToDock();
    }
  }

  async _onCapabilityFanSpeed(value) {
    this.log('[device:vacuum] fan_speed →', value);
    await this.setFanSpeed(value);
  }

  async _onCapabilityCleanMode(value) {
    this.log('[device:vacuum] clean_mode →', value);
    await this.setCleanMode(value);
  }

  async _onCapabilityWaterFlow(value) {
    this.log('[device:vacuum] water_flow →', value);
    const intVal = WATER_VOLUME_REVERSE[value];
    if (intVal === undefined) throw new Error(`Unknown water flow: ${value}`);
    await this._dreameCloud.setProperty(this._did, PROP.WATER_VOLUME.siid, PROP.WATER_VOLUME.piid, intVal, this._host);
    this._scheduleQuickPoll();
  }

  // ─── Public command methods (used by flow cards) ─────────────

  async startCleaning() {
    this.log('[device:vacuum] action: start');
    await this._dreameCloud.callAction(this._did, ACTION.START.siid, ACTION.START.aiid, [], this._host);
    this._scheduleQuickPoll();
  }

  async stopCleaning() {
    this.log('[device:vacuum] action: stop');
    await this._dreameCloud.callAction(this._did, ACTION.STOP.siid, ACTION.STOP.aiid, [], this._host);
    this._scheduleQuickPoll();
  }

  async pauseCleaning() {
    this.log('[device:vacuum] action: pause');
    await this._dreameCloud.callAction(this._did, ACTION.PAUSE.siid, ACTION.PAUSE.aiid, [], this._host);
    this._scheduleQuickPoll();
  }

  async returnToDock() {
    this.log('[device:vacuum] action: return to dock');
    await this._dreameCloud.callAction(this._did, ACTION.CHARGE.siid, ACTION.CHARGE.aiid, [], this._host);
    this._scheduleQuickPoll();
  }

  async setFanSpeed(speed) {
    const intVal = SUCTION_LEVEL_REVERSE[speed];
    if (intVal === undefined) throw new Error(`Unknown fan speed: ${speed}`);
    this.log('[device:vacuum] set fan speed:', speed, '→', intVal);
    await this._dreameCloud.setProperty(this._did, PROP.SUCTION_LEVEL.siid, PROP.SUCTION_LEVEL.piid, intVal, this._host);
    this._scheduleQuickPoll();
  }

  async setCleanMode(mode) {
    const intVal = CLEANING_MODE_REVERSE[mode];
    if (intVal === undefined) throw new Error(`Unknown clean mode: ${mode}`);
    this.log('[device:vacuum] set clean mode:', mode, '→', intVal);
    await this._dreameCloud.setProperty(this._did, PROP.CLEANING_MODE.siid, PROP.CLEANING_MODE.piid, intVal, this._host);
    this._scheduleQuickPoll();
  }

  async locate() {
    this.log('[device:vacuum] action: locate');
    await this._dreameCloud.callAction(this._did, ACTION.LOCATE.siid, ACTION.LOCATE.aiid, [], this._host);
  }

  // ─── Room/segment methods ─────────────────────────────────────

  /**
   * Default rooms (segments 1–15). Users can customize names
   * via Homey device settings or use the Dreame app to check room IDs.
   * Segment IDs match what the Dreame mobile app shows on the map.
   */
  static get DEFAULT_ROOMS() {
    return [
      { id: 1, name: 'Kitchen' },
      { id: 2, name: 'Dining Room' },
      { id: 3, name: 'Living Room' },
      { id: 4, name: 'Hallway' },
      { id: 5, name: 'Stairs' },
      { id: 6, name: 'Bathroom' },
      { id: 7, name: 'Study' },
      { id: 8, name: 'Closet' },
      { id: 9, name: 'Bathroom2' },
    ];
  }

  /**
   * Get the room/segment list.
   * Reads from app-level settings (configured via Settings page),
   * falls back to device settings, then to built-in defaults.
   */
  async getRooms() {
    // 1. App-level settings (configured via the Settings page UI)
    const appRooms = this.homey.settings.get('rooms');
    if (appRooms) {
      try {
        const parsed = typeof appRooms === 'string' ? JSON.parse(appRooms) : appRooms;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(r => ({ name: r.name || `Room ${r.id}`, id: String(r.id) }));
        }
      } catch { /* fall through */ }
    }

    // 2. Device-level settings (legacy / per-device override)
    const deviceRooms = this.getSetting('rooms_config');
    if (deviceRooms) {
      try {
        const parsed = typeof deviceRooms === 'string' ? JSON.parse(deviceRooms) : deviceRooms;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(r => ({ name: r.name || `Room ${r.id}`, id: String(r.id) }));
        }
      } catch { /* fall through */ }
    }

    // 3. Built-in defaults
    return DreameVacuumDevice.DEFAULT_ROOMS.map(r => ({ name: r.name, id: String(r.id) }));
  }

  /**
   * Start cleaning specific rooms/segments.
   * @param {number[]} segmentIds - Array of segment IDs to clean
   * @param {object} [options] - Optional cleaning parameters
   * @param {number} [options.repeat=1] - Number of cleaning repeats (1-3)
   * @param {number} [options.suction] - Suction level (0-3). Defaults to current setting.
   * @param {number} [options.water] - Water volume (1-3). Defaults to current setting.
   */
  async cleanSegments(segmentIds, options = {}) {
    if (!Array.isArray(segmentIds) || segmentIds.length === 0) {
      throw new Error('At least one segment ID is required');
    }

    const repeat = Math.min(Math.max(options.repeat || 1, 1), 3);

    // Use current settings as defaults for suction and water
    const currentSuction = SUCTION_LEVEL_REVERSE[
      this.getCapabilityValue('dreame_fan_speed') || 'standard'
    ] ?? 1;
    const currentWater = WATER_VOLUME_REVERSE[
      this.getCapabilityValue('dreame_water_flow') || 'medium'
    ] ?? 2;

    const suction = options.suction !== undefined ? options.suction : currentSuction;
    const water = options.water !== undefined ? options.water : currentWater;

    // Build selects array: [[seg_id, repeat, suction, water, order], ...]
    const selects = segmentIds.map((segId, index) => [
      segId,
      repeat,
      suction,
      water,
      index + 1,  // order (1-based)
    ]);

    const cleaningProperties = JSON.stringify({ selects });
    this.log('[device:vacuum] cleanSegments:', cleaningProperties);

    // Call START_CUSTOM action with STATUS=18 (segment cleaning) and cleaning properties
    await this._dreameCloud.callAction(
      this._did,
      ACTION.START_CUSTOM.siid,
      ACTION.START_CUSTOM.aiid,
      [
        { piid: 1, value: 18 },
        { piid: 10, value: cleaningProperties },
      ],
      this._host
    );

    this._scheduleQuickPoll();
  }
}

module.exports = DreameVacuumDevice;
