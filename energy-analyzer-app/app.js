'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');
const EnergyAnalyzer = require('./lib/EnergyAnalyzer');

class EnergyGapApp extends Homey.App {

  async onInit() {
    this.log('Energy Gap Analyzer starting...');

    // Debug: Log platform info
    this.log('[DEBUG] Homey platform:', this.homey.platform);
    this.log('[DEBUG] Homey version:', this.homey.version);

    try {
      // Create Web API client for system-wide device access
      this.homeyApi = await HomeyAPI.createAppAPI({ homey: this.homey });
      this.log('[DEBUG] homeyApi created successfully');
      this.log('[DEBUG] homeyApi.devices exists:', !!this.homeyApi.devices);
    } catch (error) {
      this.error('[ERROR] Failed to create HomeyAPI:', error);
      throw error;
    }

    // Pass homeyApi to analyzer
    this.analyzer = new EnergyAnalyzer(this.homey, this.homeyApi);

    // Initialize Insights logs
    await this.initInsights();

    // Run analysis immediately for fast feedback
    await this.runAnalysis();

    // Start polling schedule
    this.startPolling();
  }

  startPolling() {
    // Add jitter to polling start
    const jitter = Math.random() * 30000; // 0-30s random delay
    this.homey.setTimeout(() => {
      this.runAnalysis();
      this.pollInterval = this.homey.setInterval(
        () => this.runAnalysis(),
        15 * 60 * 1000 // 15 minutes
      );
    }, jitter);
  }

  async initInsights() {
    const logs = ['power-total', 'power-tracked', 'power-untracked', 'untracked-percent'];
    for (const logId of logs) {
      try {
        await this.homey.insights.createLog(logId, {
          title: { en: logId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
          type: 'number',
          units: logId.includes('percent') ? '%' : 'W',
          decimals: 1
        });
      } catch (e) {
        // Log may already exist
        this.log(`Log ${logId} already exists or could not be created`);
      }
    }
  }

  async runAnalysis() {
    try {
      const result = await this.analyzer.analyze();

      // Update virtual device
      const device = this.getEnergyGapDevice();
      if (device) {
        await device.updateMetrics(result);
      }

      // Log to Insights
      await this.logToInsights(result);

      // Store device breakdown in settings
      this.homey.settings.set('deviceBreakdown', result.devices);
      this.homey.settings.set('lastAnalysis', new Date().toISOString());

      this.log(`Analysis: ${result.total}W total, ${result.tracked}W tracked, ${result.untracked}W untracked (${result.untrackedPercent}%)`);

    } catch (error) {
      this.error('Analysis failed:', error);
    }
  }

  async logToInsights(result) {
    const logs = {
      'power-total': result.total,
      'power-tracked': result.tracked,
      'power-untracked': result.untracked,
      'untracked-percent': result.untrackedPercent
    };

    for (const [logId, value] of Object.entries(logs)) {
      try {
        const log = await this.homey.insights.getLog(logId);
        await log.createEntry(value);
      } catch (e) {
        this.error(`Failed to log ${logId}:`, e);
      }
    }
  }

  getEnergyGapDevice() {
    const driver = this.homey.drivers.getDriver('energy-gap');
    const devices = driver.getDevices();
    return devices[0] || null;
  }

  async onUninit() {
    if (this.pollInterval) {
      this.homey.clearInterval(this.pollInterval);
    }
  }

}

module.exports = EnergyGapApp;
