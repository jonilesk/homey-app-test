'use strict';

const path = require('path');
const fs = require('fs');
const { Command } = require('commander');
const yaml = require('js-yaml');
const SolarmanApi = require('../lib/SolarmanApi');
const ParameterParser = require('../lib/ParameterParser');

function parseNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return num;
}

function formatRegAddr(addr) {
  return '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
}

function formatValue(value, uom) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (uom) {
    return `${value} ${uom}`;
  }
  return String(value);
}

const program = new Command();

program
  .name('read-inverter')
  .description('Read all registers from a Solarman inverter and display parsed values')
  .requiredOption('--serial <number>', 'Data logger serial number', parseNumber)
  .option('--host <ip>', 'Data logger IP address', '10.1.1.97')
  .option('--port <number>', 'Data logger port', '8899')
  .option('--slaveid <number>', 'Modbus slave ID', '1')
  .option('--lookup <file>', 'Inverter definition YAML file', 'sofar_lsw3.yaml')
  .option('--save', 'Save raw + parsed data to test_data/<lookup>_capture.json')
  .option('--raw', 'Also print raw register values')
  .action(async (options) => {
    const host = options.host;
    const port = parseInt(options.port, 10);
    const serial = options.serial;
    const mbSlaveId = parseInt(options.slaveid, 10);
    const lookupFile = options.lookup;

    // Load YAML definition
    const defPath = path.resolve(__dirname, '..', 'inverter_definitions', lookupFile);
    let definition;
    try {
      const yamlContent = fs.readFileSync(defPath, 'utf8');
      definition = yaml.load(yamlContent);
    } catch (error) {
      console.error(`Error: Failed to load inverter definition '${lookupFile}': ${error.message}`);
      process.exit(1);
    }

    if (!definition.requests || !definition.requests.length) {
      console.error('Error: No requests defined in inverter definition file.');
      process.exit(1);
    }

    console.log('Solarman Inverter Reader');
    console.log('========================');
    console.log(`Host: ${host}:${port} | Serial: ${serial} | Profile: ${lookupFile}\n`);

    const api = new SolarmanApi({ host, port, serial, mbSlaveId, timeout: 15000 });
    const parser = new ParameterParser(definition);
    const rawCapture = {};
    let totalRegisters = 0;

    try {
      await api.connect();
      console.log('Reading registers...');

      const requests = definition.requests;
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const start = req.start;
        const end = req.end;
        const length = end - start + 1;
        const fc = req.mb_functioncode;
        const fcLabel = `FC${fc}`;

        process.stdout.write(`  Request ${i + 1}/${requests.length}: ${formatRegAddr(start)}-${formatRegAddr(end)} (${fcLabel}, ${length} registers) ... `);

        try {
          let rawData;
          if (fc === 3 || fc === 0x03) {
            rawData = await api.readHoldingRegisters(start, length);
          } else if (fc === 4 || fc === 0x04) {
            rawData = await api.readInputRegisters(start, length);
          } else {
            console.log(`SKIP (unsupported function code ${fc})`);
            continue;
          }

          parser.parse(rawData, start, length);
          rawCapture[i] = Array.from(rawData);
          totalRegisters += length;
          console.log('OK');

          if (options.raw) {
            for (let r = 0; r < rawData.length; r++) {
              const addr = start + r;
              const val = rawData[r];
              const hex = val.toString(16).toUpperCase().padStart(4, '0');
              console.log(`    ${formatRegAddr(addr)}: ${val} (0x${hex})`);
            }
          }
        } catch (error) {
          console.log(`FAILED (${error.message})`);
        }
      }

      // Get parsed results and build a lookup map for uom by sensor name
      const parsed = parser.getResult();
      const sensorMap = {};
      for (const group of definition.parameters) {
        for (const item of group.items) {
          sensorMap[item.name] = item;
        }
      }

      // Print grouped output
      console.log('');
      for (const group of definition.parameters) {
        const groupItems = group.items.filter((item) => parsed[item.name] !== undefined);
        if (groupItems.length === 0) continue;

        console.log(`--- ${group.group} ---`);
        for (const item of groupItems) {
          const label = `${item.name}:`.padEnd(25);
          console.log(`  ${label} ${formatValue(parsed[item.name], item.uom)}`);
        }
        console.log('');
      }

      const parsedCount = Object.keys(parsed).length;
      console.log(`Done. Read ${totalRegisters} registers, parsed ${parsedCount} values.`);

      // Save capture if requested
      if (options.save) {
        const outDir = path.resolve(__dirname, '..', 'test_data');
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }
        const baseName = path.basename(lookupFile, path.extname(lookupFile));
        const outFile = path.join(outDir, `${baseName}_capture.json`);
        const capture = {
          timestamp: new Date().toISOString(),
          host,
          serial,
          lookupFile,
          raw: rawCapture,
          parsed,
        };
        fs.writeFileSync(outFile, JSON.stringify(capture, null, 2));
        console.log(`Saved capture to ${outFile}`);
      }
    } catch (error) {
      console.error(`\nError: ${error.message}`);
      process.exit(1);
    } finally {
      await api.disconnect().catch(() => {});
    }
  });

program.parse();
