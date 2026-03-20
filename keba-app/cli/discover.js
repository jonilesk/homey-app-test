#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const KebaUdpClient = require('../lib/KebaUdpClient');

program
  .name('discover')
  .description('Discover KEBA KeContact chargers on the local network')
  .option('-b, --broadcast <address>', 'Broadcast address', '255.255.255.255')
  .option('-t, --timeout <ms>', 'Discovery timeout in milliseconds', '3000')
  .parse();

const opts = program.opts();

async function main() {
  const client = new KebaUdpClient();

  try {
    await client.init();

    const broadcastAddr = opts.broadcast;
    const timeout = parseInt(opts.timeout, 10);
    console.log(`Discovering KEBA chargers on ${broadcastAddr} (timeout: ${timeout}ms)...`);

    const responses = await client.discover(broadcastAddr, timeout);

    if (responses.length === 0) {
      console.log('No chargers found.');
    } else {
      console.log(`Found ${responses.length} charger(s):`);
      for (const r of responses) {
        console.log(`  ${r.host.padEnd(16)} — ${r.message.substring(0, 80)}`);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

process.on('SIGINT', () => process.exit(0));
main();
