'use strict';

const Homey = require('homey');
const DreameCloudClient = require('./lib/DreameCloudClient');

class DreameApp extends Homey.App {

  async onInit() {
    this.log('[DreameApp] initializing...');

    this.dreameCloud = new DreameCloudClient(this.homey, 'eu');

    // Restore session from settings if available
    const authKey = this.homey.settings.get('authKey');
    if (authKey) {
      await this.dreameCloud.restoreSession(authKey);
    }

    this._registerFlowCards();

    this.log('[DreameApp] initialized');
  }

  // ─── Flow card registration ───────────────────────────────────

  _registerFlowCards() {
    // --- Triggers ---
    // Triggers are fired from device.js via this.homey.flow.getDeviceTriggerCard().trigger(device, tokens, state)
    // No run listeners needed for basic device triggers — they just need to exist.

    // --- Conditions ---
    this.homey.flow.getConditionCard('is_cleaning')
      .registerRunListener(async (args) => {
        const status = args.device.getCapabilityValue('dreame_status');
        const { CLEANING_STATES } = require('./lib/MiOTProperties');
        return CLEANING_STATES.has(status);
      });

    this.homey.flow.getConditionCard('is_charging')
      .registerRunListener(async (args) => {
        const status = args.device.getCapabilityValue('dreame_status');
        const { CHARGING_STATES } = require('./lib/MiOTProperties');
        return CHARGING_STATES.has(status);
      });

    this.homey.flow.getConditionCard('fan_speed_is')
      .registerRunListener(async (args) => {
        const currentSpeed = args.device.getCapabilityValue('dreame_fan_speed');
        return currentSpeed === args.speed;
      });

    // --- Actions ---
    this.homey.flow.getActionCard('start_cleaning')
      .registerRunListener(async (args) => {
        await args.device.startCleaning();
      });

    this.homey.flow.getActionCard('stop_cleaning')
      .registerRunListener(async (args) => {
        await args.device.stopCleaning();
      });

    this.homey.flow.getActionCard('pause_cleaning')
      .registerRunListener(async (args) => {
        await args.device.pauseCleaning();
      });

    this.homey.flow.getActionCard('return_to_dock')
      .registerRunListener(async (args) => {
        await args.device.returnToDock();
      });

    this.homey.flow.getActionCard('set_fan_speed')
      .registerRunListener(async (args) => {
        await args.device.setFanSpeed(args.speed);
      });

    this.homey.flow.getActionCard('set_clean_mode')
      .registerRunListener(async (args) => {
        await args.device.setCleanMode(args.mode);
      });

    this.homey.flow.getActionCard('locate')
      .registerRunListener(async (args) => {
        await args.device.locate();
      });

    // Clean specific rooms — with autocomplete for room selection
    const cleanRoomsCard = this.homey.flow.getActionCard('clean_rooms');
    cleanRoomsCard.registerRunListener(async (args) => {
      // args.rooms is the autocomplete result: { id: "1,3,5", name: "Living Room, Kitchen, ..." }
      const segmentIds = String(args.rooms.id).split(',').map(Number).filter(n => !isNaN(n));
      if (segmentIds.length === 0) throw new Error('No valid rooms selected');
      const repeat = parseInt(args.repeat, 10) || 1;
      await args.device.cleanSegments(segmentIds, { repeat });
    });
    cleanRoomsCard.registerArgumentAutocompleteListener('rooms', async (query, args) => {
      const rooms = await args.device.getRooms();
      if (rooms.length === 0) {
        return [{ name: 'No rooms found — ensure the map is available', id: '' }];
      }
      // Filter by query
      const filtered = query
        ? rooms.filter(r => r.name.toLowerCase().includes(query.toLowerCase()))
        : rooms;
      // Build individual room items + "All rooms" option
      const items = filtered.map(r => ({
        name: r.name,
        id: String(r.id),
        description: `Segment ${r.id}`,
      }));
      // Add "All rooms" option at the top
      if (!query || 'all rooms'.includes(query.toLowerCase())) {
        items.unshift({
          name: 'All rooms',
          id: rooms.map(r => r.id).join(','),
          description: `Clean all ${rooms.length} rooms`,
        });
      }
      return items;
    });

    this.log('[DreameApp] flow cards registered');
  }
}

module.exports = DreameApp;
