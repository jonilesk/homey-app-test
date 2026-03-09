'use strict';

const { Command } = require('commander');
const SolarmanApi = require('../lib/SolarmanApi');

function parseNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return num;
}

function formatValue(value) {
  const hex = value.toString(16).toUpperCase().padStart(4, '0');
  return `${value} (0x${hex})`;
}

const program = new Command();

program
  .name('write-register')
  .description('Write a single Modbus holding register to a Solarman inverter')
  .requiredOption('--serial <number>', 'Data logger serial number', parseNumber)
  .requiredOption('--register <number>', 'Register address to write (supports 0x prefix)', parseNumber)
  .requiredOption('--value <number>', 'Value to write (supports 0x prefix)', parseNumber)
  .option('--host <ip>', 'Data logger IP address', '10.1.1.97')
  .option('--port <number>', 'Data logger port', '8899')
  .option('--slaveid <number>', 'Modbus slave ID', '1')
  .option('--no-verify', 'Skip read-back verification')
  .action(async (options) => {
    const host = options.host;
    const port = parseInt(options.port, 10);
    const serial = options.serial;
    const mbSlaveId = parseInt(options.slaveid, 10);
    const register = options.register;
    const value = options.value;

    const regHex = register.toString(16).toUpperCase().padStart(4, '0');

    console.log('Solarman Register Writer');
    console.log('========================');
    console.log(`Host: ${host}:${port} | Serial: ${serial}\n`);
    console.log(`Register 0x${regHex} (${register}):`);

    const api = new SolarmanApi({ host, port, serial, mbSlaveId, timeout: 10000 });

    try {
      await api.connect();

      // Read current value
      const currentValues = await api.readHoldingRegisters(register, 1);
      const currentValue = currentValues[0];
      console.log(`  Current value: ${formatValue(currentValue)}`);
      console.log(`  Writing:       ${formatValue(value)}`);

      // Write the new value
      const writeResult = await api.writeHoldingRegister(register, value);
      console.log(`  Write result:  OK`);

      // Verify by reading back
      if (options.verify) {
        const verifyValues = await api.readHoldingRegisters(register, 1);
        const readBack = verifyValues[0];
        if (readBack === value) {
          console.log(`  Read-back:     ${formatValue(readBack)} ✓ Verified`);
        } else {
          console.log(`  Read-back:     ${formatValue(readBack)} ✗ MISMATCH (expected ${formatValue(value)})`);
        }
      }
    } catch (error) {
      console.error(`\nError: ${error.message}`);
      process.exit(1);
    } finally {
      await api.disconnect().catch(() => {});
    }
  });

program.parse();
