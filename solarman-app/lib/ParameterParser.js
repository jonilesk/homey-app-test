'use strict';

class ParameterParser {

  constructor(lookups) {
    this.result = {};
    this._lookups = lookups;
  }

  parse(rawData, start, length) {
    for (const group of this._lookups.parameters) {
      for (const item of group.items) {
        this.tryParseField(rawData, item, start, length);
      }
    }
  }

  getResult() {
    return this.result;
  }

  tryParseField(rawData, definition, start, length) {
    const rule = definition.rule;
    if (rule === 1) {
      this.tryParseUnsigned(rawData, definition, start, length);
    } else if (rule === 2) {
      this.tryParseSigned(rawData, definition, start, length);
    } else if (rule === 3) {
      this.tryParseUnsigned(rawData, definition, start, length);
    } else if (rule === 4) {
      this.tryParseSigned(rawData, definition, start, length);
    } else if (rule === 5) {
      this.tryParseAscii(rawData, definition, start, length);
    } else if (rule === 6) {
      this.tryParseBits(rawData, definition, start, length);
    } else if (rule === 7) {
      this.tryParseVersion(rawData, definition, start, length);
    } else if (rule === 8) {
      this.tryParseDatetime(rawData, definition, start, length);
    } else if (rule === 9) {
      this.tryParseTime(rawData, definition, start, length);
    } else if (rule === 10) {
      this.tryParseRaw(rawData, definition, start, length);
    }
  }

  doValidate(title, value, rule) {
    if (rule.min !== undefined) {
      if (rule.min > value) {
        if (rule.invalidate_all !== undefined) {
          throw new Error(`Invalidate complete dataset (${title} ~ ${value})`);
        }
        return false;
      }
    }
    if (rule.max !== undefined) {
      if (rule.max < value) {
        if (rule.invalidate_all !== undefined) {
          throw new Error(`Invalidate complete dataset (${title} ~ ${value})`);
        }
        return false;
      }
    }
    return true;
  }

  tryParseSigned(rawData, definition, start, length) {
    const title = definition.name;
    const scale = definition.scale !== undefined ? definition.scale : 1;
    let value = 0;
    let found = true;
    let shift = 0;
    let maxint = 0;
    for (const r of definition.registers) {
      const index = r - start;
      if (index >= 0 && index < length) {
        maxint = maxint * 65536 + 0xFFFF;
        const temp = rawData[index];
        value += (temp & 0xFFFF) * Math.pow(2, shift);
        shift += 16;
      } else {
        found = false;
      }
    }
    if (found) {
      if (definition.offset !== undefined) {
        value = value - definition.offset;
      }
      if (value > maxint / 2) {
        value = (value - maxint) * scale;
      } else {
        value = value * scale;
      }
      if (definition.scale_division !== undefined && definition.scale_division > 0) {
        value = Math.floor(value / definition.scale_division);
      }
      if (definition.validation !== undefined) {
        if (!this.doValidate(title, value, definition.validation)) {
          return;
        }
      }
      if (this._isIntegerNum(value)) {
        this.result[title] = Math.trunc(value);
      } else {
        this.result[title] = value;
      }
    }
  }

  tryParseUnsigned(rawData, definition, start, length) {
    const title = definition.name;
    const scale = definition.scale !== undefined ? definition.scale : 1;
    let value = 0;
    let found = true;
    let shift = 0;
    for (const r of definition.registers) {
      const index = r - start;
      if (index >= 0 && index < length) {
        const temp = rawData[index];
        value += (temp & 0xFFFF) * Math.pow(2, shift);
        shift += 16;
      } else {
        found = false;
      }
    }
    if (found) {
      if (definition.mask !== undefined) {
        value &= definition.mask;
      }
      if (definition.lookup !== undefined) {
        this.result[title] = this._lookupValue(value, definition.lookup);
      } else {
        if (definition.offset !== undefined) {
          value = value - definition.offset;
        }
        value = value * scale;
        if (definition.scale_division !== undefined && definition.scale_division > 0) {
          value = Math.floor(value / definition.scale_division);
        }
        if (definition.validation !== undefined) {
          if (!this.doValidate(title, value, definition.validation)) {
            return;
          }
        }
        if (this._isIntegerNum(value)) {
          this.result[title] = Math.trunc(value);
        } else {
          this.result[title] = value;
        }
      }
    }
  }

  _lookupValue(value, options) {
    for (const o of options) {
      if (o.key === value) {
        return o.value;
      }
    }
    return value;
  }

  tryParseAscii(rawData, definition, start, length) {
    const title = definition.name;
    let found = true;
    let value = '';
    for (const r of definition.registers) {
      const index = r - start;
      if (index >= 0 && index < length) {
        const temp = rawData[index];
        value = value + String.fromCharCode(temp >> 8) + String.fromCharCode(temp & 0xFF);
      } else {
        found = false;
      }
    }
    if (found) {
      this.result[title] = value;
    }
  }

  tryParseBits(rawData, definition, start, length) {
    const title = definition.name;
    let found = true;
    const value = [];
    for (const r of definition.registers) {
      const index = r - start;
      if (index >= 0 && index < length) {
        const temp = rawData[index];
        value.push('0x' + temp.toString(16));
      } else {
        found = false;
      }
    }
    if (found) {
      this.result[title] = value;
    }
  }

  tryParseRaw(rawData, definition, start, length) {
    const title = definition.name;
    let found = true;
    const value = [];
    for (const r of definition.registers) {
      const index = r - start;
      if (index >= 0 && index < length) {
        const temp = rawData[index];
        value.push(temp);
      } else {
        found = false;
      }
    }
    if (found) {
      this.result[title] = value;
    }
  }

  tryParseVersion(rawData, definition, start, length) {
    const title = definition.name;
    let found = true;
    let value = '';
    for (const r of definition.registers) {
      const index = r - start;
      if (index >= 0 && index < length) {
        const temp = rawData[index];
        value = value
          + String(temp >> 12) + '.'
          + String((temp >> 8) & 0x0F) + '.'
          + String((temp >> 4) & 0x0F) + '.'
          + String(temp & 0x0F);
      } else {
        found = false;
      }
    }
    if (found) {
      this.result[title] = value;
    }
  }

  tryParseDatetime(rawData, definition, start, length) {
    const title = definition.name;
    let found = true;
    let value = '';
    const registers = definition.registers;
    for (let i = 0; i < registers.length; i++) {
      const r = registers[i];
      const index = r - start;
      if (index >= 0 && index < length) {
        const temp = rawData[index];
        if (i === 0) {
          value = value + String(temp >> 8) + '/' + String(temp & 0xFF) + '/';
        } else if (i === 1) {
          value = value + String(temp >> 8) + ' ' + String(temp & 0xFF) + ':';
        } else if (i === 2) {
          value = value + String(temp >> 8) + ':' + String(temp & 0xFF);
        } else {
          value = value + String(temp >> 8) + String(temp & 0xFF);
        }
      } else {
        found = false;
      }
    }
    if (found) {
      this.result[title] = value;
    }
  }

  tryParseTime(rawData, definition, start, length) {
    const title = definition.name;
    let found = true;
    let value = '';
    for (const r of definition.registers) {
      const index = r - start;
      if (index >= 0 && index < length) {
        const temp = rawData[index];
        value = String(Math.floor(temp / 100)).padStart(2, '0')
          + ':' + String(Math.floor(temp % 100)).padStart(2, '0');
      } else {
        found = false;
      }
    }
    if (found) {
      this.result[title] = value;
    }
  }

  getSensors() {
    const result = [];
    for (const group of this._lookups.parameters) {
      for (const item of group.items) {
        result.push(item);
      }
    }
    return result;
  }

  _isIntegerNum(n) {
    if (Number.isInteger(n)) {
      return true;
    }
    if (typeof n === 'number') {
      return n === Math.floor(n);
    }
    return false;
  }

}

module.exports = ParameterParser;
