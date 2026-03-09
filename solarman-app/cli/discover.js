'use strict';

const { Command } = require('commander');
const InverterScanner = require('../lib/InverterScanner');

const program = new Command();

program
  .name('discover')
  .description('Discover Solarman data loggers on the local network')
  .option('-t, --timeout <ms>', 'Discovery timeout in milliseconds', '3000')
  .option('-b, --broadcast <addr>', 'Broadcast address', '255.255.255.255')
  .action(async (options) => {
    console.log('Scanning for Solarman data loggers...\n');

    const devices = await InverterScanner.discover({
      timeout: parseInt(options.timeout, 10),
      broadcastAddr: options.broadcast,
    });

    if (devices.length === 0) {
      console.log('No data loggers found.');
      console.log('\nTips:');
      console.log('  - Ensure you are on the same network as the data logger');
      console.log('  - Try increasing timeout: node cli/discover.js -t 5000');
      console.log('  - Try specifying subnet broadcast: node cli/discover.js -b 10.1.1.255');
      process.exit(0);
    }

    console.log(`Found ${devices.length} data logger(s):\n`);
    for (const device of devices) {
      console.log(`  IP:     ${device.ip}`);
      console.log(`  MAC:    ${device.mac}`);
      console.log(`  Serial: ${device.serial}`);
      console.log('');
    }
  });

program.parse();
