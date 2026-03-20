#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const KebaUdpClient = require('../lib/KebaUdpClient');
const { parseReport2, parseReport3 } = require('../lib/KebaDataParser');
const { parseProductInfo } = require('../lib/KebaDeviceInfo');

program
  .name('monitor')
  .description('Continuously monitor a KEBA KeContact charger')
  .requiredOption('-H, --host <ip>', 'Charger IP address')
  .option('-i, --interval <seconds>', 'Poll interval in seconds', '30')
  .option('-t, --timeout <ms>', 'Response timeout in milliseconds', '5000')
  .parse();

const opts = program.opts();

let running = true;
let previousValues = {};

async function main() {
  const client = new KebaUdpClient();
  const host = opts.host;
  const interval = parseInt(opts.interval, 10) * 1000;
  const timeout = parseInt(opts.timeout, 10);

  try {
    await client.init();
    console.log(`Monitoring KEBA charger at ${host} (interval: ${opts.interval}s)\n`);

    // Get device info first
    const report1Raw = await client.sendAndWait(host, 'report 1', { timeout });
    const report1Json = JSON.parse(report1Raw);
    const info = parseProductInfo(report1Json);
    console.log(`Connected: ${info.manufacturer} ${info.model} (${info.serial})\n`);

    while (running) {
      try {
        const report2Raw = await client.sendAndWait(host, 'report 2', { timeout });
        const report2 = parseReport2(JSON.parse(report2Raw));

        const values = {
          state: report2.stateDetail,
          plug: report2.plugDetail,
          enableSys: report2.enableSys,
          maxCurr: `${report2.maxCurr.toFixed(1)} A`,
          currUser: `${report2.currUser.toFixed(1)} A`,
        };

        if (info.meterIntegrated) {
          try {
            const report3Raw = await client.sendAndWait(host, 'report 3', { timeout });
            const report3 = parseReport3(JSON.parse(report3Raw));
            values.power = `${report3.power} W`;
            values.energySession = `${report3.energySession.toFixed(2)} kWh`;
            values.energyTotal = `${report3.energyTotal.toFixed(2)} kWh`;
            values.pf = report3.powerFactor.toFixed(3);
          } catch (err) {
            values.power = `error: ${err.message}`;
          }
        }

        // Show only changed values, or all on first poll
        const changes = {};
        let hasChanges = false;
        for (const [key, val] of Object.entries(values)) {
          if (previousValues[key] !== val) {
            changes[key] = val;
            hasChanges = true;
          }
        }

        if (hasChanges || Object.keys(previousValues).length === 0) {
          const ts = new Date().toLocaleTimeString();
          const display = Object.keys(previousValues).length === 0 ? values : changes;
          const pairs = Object.entries(display).map(([k, v]) => `${k}=${v}`).join('  ');
          console.log(`[${ts}] ${pairs}`);
        }

        previousValues = { ...values };
      } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] Poll error: ${err.message}`);
      }

      // Wait for next poll
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, interval);
        const checkRunning = setInterval(() => {
          if (!running) { clearTimeout(timer); clearInterval(checkRunning); resolve(); }
        }, 100);
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

process.on('SIGINT', () => {
  console.log('\nStopping monitor...');
  running = false;
});
main();
