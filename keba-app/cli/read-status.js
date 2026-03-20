#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const KebaUdpClient = require('../lib/KebaUdpClient');
const { parseReport1, parseReport2, parseReport3 } = require('../lib/KebaDataParser');
const { parseProductInfo } = require('../lib/KebaDeviceInfo');

program
  .name('read-status')
  .description('Read status from a KEBA KeContact charger')
  .requiredOption('-H, --host <ip>', 'Charger IP address')
  .option('-s, --save', 'Save raw JSON responses to test_data/')
  .option('-t, --timeout <ms>', 'Response timeout in milliseconds', '5000')
  .parse();

const opts = program.opts();

async function main() {
  const client = new KebaUdpClient();
  const host = opts.host;
  const timeout = parseInt(opts.timeout, 10);

  try {
    await client.init();
    console.log(`Reading status from KEBA charger at ${host}...\n`);

    // Report 1 — Device info
    let report1Raw;
    try {
      report1Raw = await client.sendAndWait(host, 'report 1', { timeout });
    } catch (err) {
      console.error(`Failed to get Report 1: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    const report1Json = JSON.parse(report1Raw);
    const report1 = parseReport1(report1Json);
    const info = parseProductInfo(report1);

    console.log(`Model: ${info.manufacturer} ${info.model} (${info.product})`);
    console.log(`Serial: ${info.serial}`);
    console.log(`Firmware: ${info.firmware}`);
    console.log(`Features: meter=${yn(info.meterIntegrated)} display=${yn(info.displayAvailable)} auth=${yn(info.authAvailable)} dataLogger=${yn(info.dataLogger)} phaseSwitch=${yn(info.phaseSwitch)}`);

    // Report 2 — Charging status
    let report2Raw;
    try {
      report2Raw = await client.sendAndWait(host, 'report 2', { timeout });
    } catch (err) {
      console.error(`Failed to get Report 2: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    const report2Json = JSON.parse(report2Raw);
    const report2 = parseReport2(report2Json);

    console.log(`\nStatus (Report 2):`);
    console.log(`  State: ${report2.stateDetail} (${report2.stateOn ? 'charging' : 'not charging'})`);
    console.log(`  Plug: ${report2.plugDetail}`);
    console.log(`  Enable sys: ${report2.enableSys}  Enable user: ${report2.enableUser}`);
    console.log(`  Max current: ${report2.maxCurr.toFixed(1)} A`);
    console.log(`  HW current: ${report2.currHW.toFixed(1)} A`);
    console.log(`  User current: ${report2.currUser.toFixed(1)} A`);
    console.log(`  Failsafe current: ${report2.currFS.toFixed(1)} A (timeout: ${report2.tmoFS}s, active: ${report2.fsOn})`);

    // Report 3 — Metering (only if meter integrated)
    let report3Json = null;
    let report3 = null;
    if (info.meterIntegrated) {
      try {
        const report3Raw = await client.sendAndWait(host, 'report 3', { timeout });
        report3Json = JSON.parse(report3Raw);
        report3 = parseReport3(report3Json);

        console.log(`\nMetering (Report 3):`);
        console.log(`  Power: ${report3.powerKw.toFixed(3)} kW (${report3.power} W)`);
        console.log(`  Energy (session): ${report3.energySession.toFixed(2)} kWh`);
        console.log(`  Energy (total): ${report3.energyTotal.toFixed(2)} kWh`);
        console.log(`  Power factor: ${report3.powerFactor.toFixed(3)}`);
        console.log(`  Phase 1: ${report3.u1} V / ${report3.i1.toFixed(3)} A`);
        console.log(`  Phase 2: ${report3.u2} V / ${report3.i2.toFixed(3)} A`);
        console.log(`  Phase 3: ${report3.u3} V / ${report3.i3.toFixed(3)} A`);
      } catch (err) {
        console.log(`\nMetering (Report 3): Not available (${err.message})`);
      }
    } else {
      console.log(`\nMetering: Not available (no integrated meter)`);
    }

    // Save raw data
    if (opts.save) {
      const dir = path.join(__dirname, '..', 'test_data');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const saveData = {
        host,
        timestamp: new Date().toISOString(),
        report1: report1Json,
        report2: report2Json,
        report3: report3Json,
        parsed: { info, report2, report3 },
      };
      const filePath = path.join(dir, `keba-${info.serial}-${timestamp}.json`);
      fs.writeFileSync(filePath, JSON.stringify(saveData, null, 2));
      console.log(`\nRaw data saved to ${filePath}`);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

function yn(val) { return val ? 'yes' : 'no'; }

process.on('SIGINT', () => process.exit(0));
main();
