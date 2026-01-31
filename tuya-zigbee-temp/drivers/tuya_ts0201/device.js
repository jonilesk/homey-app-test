'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class TuyaTS0201Device extends ZigBeeDevice {
  async onNodeInit({ zclNode }) {
    // Enable debug logging during development
    this.enableDebug();
    this.log('[ts0201] Device initialized:', this.getName());

    // Probe: Log endpoint and cluster inventory
    this._probeEndpoints(zclNode);

    // Register temperature capability
    if (this.hasCapability('measure_temperature')) {
      this.registerCapability('measure_temperature', CLUSTER.TEMPERATURE_MEASUREMENT, {
        get: 'measuredValue',
        report: 'measuredValue',
        reportParser: (value) => {
          // Temperature is in 0.01°C units
          const temp = value / 100;
          this.log('[ts0201] Temperature:', temp, '°C');
          return temp;
        },
        getOpts: {
          getOnStart: false, // Sleepy device - don't poll on start
        },
      });

      // Configure reporting for temperature
      this._configureReporting(zclNode, CLUSTER.TEMPERATURE_MEASUREMENT, 'measuredValue', {
        minInterval: 300,    // 5 minutes minimum
        maxInterval: 3600,   // 1 hour maximum
        minChange: 10,       // 0.1°C change threshold
      });
    }

    // Register humidity capability
    if (this.hasCapability('measure_humidity')) {
      this.registerCapability('measure_humidity', CLUSTER.RELATIVE_HUMIDITY_MEASUREMENT, {
        get: 'measuredValue',
        report: 'measuredValue',
        reportParser: (value) => {
          // Humidity is in 0.01% units
          const humidity = value / 100;
          this.log('[ts0201] Humidity:', humidity, '%');
          return humidity;
        },
        getOpts: {
          getOnStart: false,
        },
      });

      // Configure reporting for humidity
      this._configureReporting(zclNode, CLUSTER.RELATIVE_HUMIDITY_MEASUREMENT, 'measuredValue', {
        minInterval: 300,
        maxInterval: 3600,
        minChange: 100,      // 1% change threshold
      });
    }

    // Register battery capability
    if (this.hasCapability('measure_battery')) {
      this.registerCapability('measure_battery', CLUSTER.POWER_CONFIGURATION, {
        get: 'batteryPercentageRemaining',
        report: 'batteryPercentageRemaining',
        reportParser: (value) => {
          // Battery percentage is in 0.5% units
          const battery = Math.round(value / 2);
          this.log('[ts0201] Battery:', battery, '%');

          // Update battery alarm
          if (this.hasCapability('alarm_battery')) {
            const lowBattery = battery < 20;
            this.setCapabilityValue('alarm_battery', lowBattery).catch(this.error);
          }

          return battery;
        },
        getOpts: {
          getOnStart: false,
        },
      });

      // Configure reporting for battery (less frequent)
      this._configureReporting(zclNode, CLUSTER.POWER_CONFIGURATION, 'batteryPercentageRemaining', {
        minInterval: 3600,    // 1 hour minimum
        maxInterval: 21600,   // 6 hours maximum
        minChange: 2,         // 1% change threshold (0.5% units)
      });
    }

    this.log('[ts0201] Capability registration complete');
  }

  /**
   * Probe and log endpoint/cluster inventory for debugging
   */
  _probeEndpoints(zclNode) {
    this.log('[ts0201] === Endpoint/Cluster Inventory ===');

    for (const [endpointId, endpoint] of Object.entries(zclNode.endpoints)) {
      this.log(`[ts0201] Endpoint ${endpointId}:`);

      // Log input clusters (server clusters)
      if (endpoint.clusters) {
        const clusterNames = Object.keys(endpoint.clusters);
        this.log(`[ts0201]   Input clusters: ${clusterNames.join(', ')}`);

        // Check for Tuya manufacturer cluster
        if (endpoint.clusters.tuya || endpoint.clusters[0xEF00]) {
          this.log('[ts0201]   ⚠️ Tuya manufacturer cluster (0xEF00) detected - may need custom datapoint parsing');
        }
      }

      // Log bound clusters
      if (endpoint.bindings) {
        const bindingNames = Object.keys(endpoint.bindings);
        this.log(`[ts0201]   Bindings: ${bindingNames.join(', ')}`);
      }
    }

    this.log('[ts0201] === End Inventory ===');
  }

  /**
   * Configure attribute reporting with error handling for sleepy devices
   */
  async _configureReporting(zclNode, cluster, attribute, options) {
    try {
      const endpoint = zclNode.endpoints[1];
      if (!endpoint || !endpoint.clusters[cluster.NAME]) {
        this.log(`[reporting] Cluster ${cluster.NAME} not available on endpoint 1`);
        return;
      }

      await endpoint.clusters[cluster.NAME].configureReporting({
        [attribute]: {
          minInterval: options.minInterval,
          maxInterval: options.maxInterval,
          minChange: options.minChange,
        },
      });

      this.log(`[reporting] Configured ${cluster.NAME}.${attribute}: min=${options.minInterval}s, max=${options.maxInterval}s`);
    } catch (error) {
      // Sleepy devices may not respond immediately - this is expected
      this.log(`[reporting] Could not configure ${cluster.NAME}.${attribute} (device may be asleep):`, error.message);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('[ts0201] Settings changed:', changedKeys);
  }

  onDeleted() {
    this.log('[ts0201] Device deleted');
  }
}

module.exports = TuyaTS0201Device;
