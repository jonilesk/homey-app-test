'use strict';

class ForecastAggregator {
  /**
   * @param {Array} forecasts - Raw forecast array sorted by period_end ascending
   * @param {string} [estimateField='pv_estimate'] - Which estimate field to use
   * @param {number} [hardLimitKw=0] - Clamp values to this max kW (0 = disabled)
   */
  constructor(forecasts, estimateField = 'pv_estimate', hardLimitKw = 0) {
    this._estimateField = estimateField;
    this._hardLimitKw = hardLimitKw;
    this._intervals = (forecasts || []).map((f) => {
      const periodEnd = new Date(f.period_end);
      const periodStart = new Date(periodEnd.getTime() - 30 * 60 * 1000);
      let kw = Number(f[estimateField]) || 0;
      if (hardLimitKw > 0) {
        kw = Math.min(kw, hardLimitKw);
      }
      return { periodStart, periodEnd, kw };
    });
  }

  /**
   * Get the local date string (YYYY-MM-DD) for a UTC timestamp in the given timezone.
   * @param {Date} date
   * @param {string} timezone
   * @returns {string}
   */
  _getLocalDateString(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year').value;
    const month = parts.find((p) => p.type === 'month').value;
    const day = parts.find((p) => p.type === 'day').value;
    return `${year}-${month}-${day}`;
  }

  /**
   * Get the target date string for a dayOffset from today.
   * @param {number} dayOffset
   * @param {string} timezone
   * @param {Date} [now=new Date()]
   * @returns {string}
   */
  _getTargetDateString(dayOffset, timezone, now = new Date()) {
    const todayStr = this._getLocalDateString(now, timezone);
    const [y, m, d] = todayStr.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1, d + dayOffset));
    return this._getLocalDateString(target, 'UTC');
  }

  /**
   * Get intervals that belong to a specific local date.
   * An interval belongs to a day based on its midpoint (period_end - 15 min).
   * @param {string} dateStr - YYYY-MM-DD
   * @param {string} timezone
   * @returns {Array}
   */
  _getIntervalsForDate(dateStr, timezone) {
    return this._intervals.filter((iv) => {
      const midpoint = new Date(iv.periodEnd.getTime() - 15 * 60 * 1000);
      return this._getLocalDateString(midpoint, timezone) === dateStr;
    });
  }

  /**
   * Find the interval containing a given timestamp.
   * @param {Date} time
   * @returns {Object|null}
   */
  _findInterval(time) {
    const ts = time.getTime();
    return this._intervals.find((iv) => ts >= iv.periodStart.getTime() && ts < iv.periodEnd.getTime()) || null;
  }

  /**
   * Current estimated power in Watts.
   * @param {Date} [now=new Date()]
   * @returns {number}
   */
  getPowerNow(now = new Date()) {
    const iv = this._findInterval(now);
    if (!iv) return 0;
    return Math.round(iv.kw * 1000);
  }

  /**
   * Estimated power in Watts at N minutes from now.
   * @param {number} minutes
   * @param {Date} [now=new Date()]
   * @returns {number}
   */
  getPowerInMinutes(minutes, now = new Date()) {
    const future = new Date(now.getTime() + minutes * 60 * 1000);
    const iv = this._findInterval(future);
    if (!iv) return 0;
    return Math.round(iv.kw * 1000);
  }

  /**
   * Total forecast energy for a given day in kWh.
   * @param {number} dayOffset - 0=today, 1=tomorrow, etc.
   * @param {string} [timezone='UTC']
   * @returns {number}
   */
  getForecastDay(dayOffset, timezone = 'UTC') {
    const dateStr = this._getTargetDateString(dayOffset, timezone);
    const intervals = this._getIntervalsForDate(dateStr, timezone);
    const kwh = intervals.reduce((sum, iv) => sum + iv.kw * 0.5, 0);
    return Math.round(kwh * 100) / 100;
  }

  /**
   * Remaining forecast energy for today from now until end of day in kWh.
   * @param {Date} [now=new Date()]
   * @param {string} [timezone='UTC']
   * @returns {number}
   */
  getForecastRemaining(now = new Date(), timezone = 'UTC') {
    const todayStr = this._getLocalDateString(now, timezone);
    const todayIntervals = this._getIntervalsForDate(todayStr, timezone);
    const nowTs = now.getTime();

    let kwh = 0;
    for (const iv of todayIntervals) {
      if (iv.periodEnd.getTime() <= nowTs) {
        // Interval fully in the past
        continue;
      }
      if (iv.periodStart.getTime() >= nowTs) {
        // Interval fully in the future
        kwh += iv.kw * 0.5;
      } else {
        // Partially elapsed — prorate
        const remainingMs = iv.periodEnd.getTime() - nowTs;
        const totalMs = 30 * 60 * 1000;
        kwh += iv.kw * 0.5 * (remainingMs / totalMs);
      }
    }
    return Math.round(kwh * 100) / 100;
  }

  /**
   * Get intervals overlapping a given UTC hour range [hourStart, hourEnd).
   * @param {Date} hourStart
   * @param {Date} hourEnd
   * @returns {number} Wh
   */
  _getEnergyForHourRange(hourStart, hourEnd) {
    const startTs = hourStart.getTime();
    const endTs = hourEnd.getTime();
    let wh = 0;

    for (const iv of this._intervals) {
      const ivStartTs = iv.periodStart.getTime();
      const ivEndTs = iv.periodEnd.getTime();

      // Skip intervals that don't overlap
      if (ivEndTs <= startTs || ivStartTs >= endTs) continue;

      // Calculate overlap
      const overlapStart = Math.max(ivStartTs, startTs);
      const overlapEnd = Math.min(ivEndTs, endTs);
      const overlapHours = (overlapEnd - overlapStart) / (3600 * 1000);

      wh += iv.kw * 1000 * overlapHours;
    }
    return Math.round(wh);
  }

  /**
   * Forecast energy for the current clock hour in Wh.
   * @param {Date} [now=new Date()]
   * @returns {number}
   */
  getForecastThisHour(now = new Date()) {
    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart.getTime() + 3600 * 1000);
    return this._getEnergyForHourRange(hourStart, hourEnd);
  }

  /**
   * Forecast energy for the next clock hour in Wh.
   * @param {Date} [now=new Date()]
   * @returns {number}
   */
  getForecastNextHour(now = new Date()) {
    const nextHourStart = new Date(now);
    nextHourStart.setUTCMinutes(0, 0, 0);
    nextHourStart.setTime(nextHourStart.getTime() + 3600 * 1000);
    const nextHourEnd = new Date(nextHourStart.getTime() + 3600 * 1000);
    return this._getEnergyForHourRange(nextHourStart, nextHourEnd);
  }

  /**
   * Peak power for a given day in Watts.
   * @param {number} dayOffset
   * @param {string} [timezone='UTC']
   * @returns {number}
   */
  getPeakPower(dayOffset, timezone = 'UTC') {
    const dateStr = this._getTargetDateString(dayOffset, timezone);
    const intervals = this._getIntervalsForDate(dateStr, timezone);
    if (intervals.length === 0) return 0;
    const maxKw = Math.max(...intervals.map((iv) => iv.kw));
    return Math.round(maxKw * 1000);
  }

  /**
   * Time of peak power for a given day.
   * @param {number} dayOffset
   * @param {string} [timezone='UTC']
   * @returns {string|null}
   */
  getPeakTime(dayOffset, timezone = 'UTC') {
    const dateStr = this._getTargetDateString(dayOffset, timezone);
    const intervals = this._getIntervalsForDate(dateStr, timezone);
    if (intervals.length === 0) return null;

    let peakIv = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i].kw > peakIv.kw) {
        peakIv = intervals[i];
      }
    }
    // Return midpoint of the peak interval
    const midpoint = new Date(peakIv.periodStart.getTime() + 15 * 60 * 1000);
    return midpoint.toISOString();
  }

  /**
   * Get all computed values as a flat object for easy capability mapping.
   * @param {string} [timezone='UTC']
   * @returns {Object}
   */
  getAll(timezone = 'UTC') {
    return {
      power_now: this.getPowerNow(),
      power_30m: this.getPowerInMinutes(30),
      power_1hr: this.getPowerInMinutes(60),
      forecast_today: this.getForecastDay(0, timezone),
      forecast_tomorrow: this.getForecastDay(1, timezone),
      forecast_remaining: this.getForecastRemaining(new Date(), timezone),
      forecast_this_hour: this.getForecastThisHour(),
      forecast_next_hour: this.getForecastNextHour(),
      peak_today: this.getPeakPower(0, timezone),
      peak_tomorrow: this.getPeakPower(1, timezone),
      peak_time_today: this.getPeakTime(0, timezone),
      peak_time_tomorrow: this.getPeakTime(1, timezone),
    };
  }
}

module.exports = ForecastAggregator;

/*
// ── Test with sample data ──────────────────────────────────────────────────
// Uncomment and run: node lib/ForecastAggregator.js

const forecasts = [
  { period_end: '2026-03-09T10:00:00.0000000Z', pv_estimate: 0.5,  pv_estimate10: 0.2,  pv_estimate90: 0.8,  period: 'PT30M' },
  { period_end: '2026-03-09T10:30:00.0000000Z', pv_estimate: 1.0,  pv_estimate10: 0.5,  pv_estimate90: 1.5,  period: 'PT30M' },
  { period_end: '2026-03-09T11:00:00.0000000Z', pv_estimate: 2.0,  pv_estimate10: 1.2,  pv_estimate90: 2.8,  period: 'PT30M' },
  { period_end: '2026-03-09T11:30:00.0000000Z', pv_estimate: 3.0,  pv_estimate10: 2.0,  pv_estimate90: 4.0,  period: 'PT30M' },
  { period_end: '2026-03-09T12:00:00.0000000Z', pv_estimate: 4.2,  pv_estimate10: 3.0,  pv_estimate90: 5.5,  period: 'PT30M' },
  { period_end: '2026-03-09T12:30:00.0000000Z', pv_estimate: 4.0,  pv_estimate10: 2.8,  pv_estimate90: 5.2,  period: 'PT30M' },
  { period_end: '2026-03-09T13:00:00.0000000Z', pv_estimate: 3.5,  pv_estimate10: 2.5,  pv_estimate90: 4.5,  period: 'PT30M' },
  { period_end: '2026-03-09T13:30:00.0000000Z', pv_estimate: 2.5,  pv_estimate10: 1.5,  pv_estimate90: 3.5,  period: 'PT30M' },
  { period_end: '2026-03-09T14:00:00.0000000Z', pv_estimate: 1.5,  pv_estimate10: 0.8,  pv_estimate90: 2.2,  period: 'PT30M' },
  { period_end: '2026-03-09T14:30:00.0000000Z', pv_estimate: 0.5,  pv_estimate10: 0.2,  pv_estimate90: 0.8,  period: 'PT30M' },
  // Tomorrow data
  { period_end: '2026-03-10T10:00:00.0000000Z', pv_estimate: 1.0,  pv_estimate10: 0.5,  pv_estimate90: 1.5,  period: 'PT30M' },
  { period_end: '2026-03-10T10:30:00.0000000Z', pv_estimate: 2.0,  pv_estimate10: 1.0,  pv_estimate90: 3.0,  period: 'PT30M' },
  { period_end: '2026-03-10T11:00:00.0000000Z', pv_estimate: 3.5,  pv_estimate10: 2.0,  pv_estimate90: 5.0,  period: 'PT30M' },
  { period_end: '2026-03-10T11:30:00.0000000Z', pv_estimate: 4.5,  pv_estimate10: 3.0,  pv_estimate90: 6.0,  period: 'PT30M' },
  { period_end: '2026-03-10T12:00:00.0000000Z', pv_estimate: 4.0,  pv_estimate10: 2.5,  pv_estimate90: 5.5,  period: 'PT30M' },
  { period_end: '2026-03-10T12:30:00.0000000Z', pv_estimate: 3.0,  pv_estimate10: 1.5,  pv_estimate90: 4.5,  period: 'PT30M' },
  { period_end: '2026-03-10T13:00:00.0000000Z', pv_estimate: 1.5,  pv_estimate10: 0.8,  pv_estimate90: 2.2,  period: 'PT30M' },
];

const now = new Date('2026-03-09T11:15:00.000Z');
const agg = new ForecastAggregator(forecasts);

console.log('=== ForecastAggregator Test ===');
console.log('');

// Power now: 11:15 falls in [11:00, 11:30) interval → pv_estimate = 3.0 kW → 3000 W
console.log('getPowerNow:', agg.getPowerNow(now), '(expect 3000)');

// Power in 30 min: 11:45 falls in [11:30, 12:00) interval → 4.2 kW → 4200 W
console.log('getPowerIn30m:', agg.getPowerInMinutes(30, now), '(expect 4200)');

// Power in 60 min: 12:15 falls in [12:00, 12:30) interval → 4.0 kW → 4000 W
console.log('getPowerIn60m:', agg.getPowerInMinutes(60, now), '(expect 4000)');

// Forecast today (UTC): sum of kW * 0.5 for all March 9 intervals
// = (0.5+1.0+2.0+3.0+4.2+4.0+3.5+2.5+1.5+0.5) * 0.5 = 22.7 * 0.5 = 11.35 kWh
console.log('getForecastDay(0):', agg.getForecastDay(0, 'UTC'), '(expect 11.35)');

// Forecast tomorrow (UTC): sum of March 10 intervals
// = (1.0+2.0+3.5+4.5+4.0+3.0+1.5) * 0.5 = 19.5 * 0.5 = 9.75 kWh
console.log('getForecastDay(1):', agg.getForecastDay(1, 'UTC'), '(expect 9.75)');

// Peak today: max kW = 4.2 → 4200 W
console.log('getPeakPower(0):', agg.getPeakPower(0, 'UTC'), '(expect 4200)');

// Peak time today: midpoint of [11:30, 12:00) = 11:45
console.log('getPeakTime(0):', agg.getPeakTime(0, 'UTC'), '(expect 2026-03-09T11:45:00.000Z)');

// Peak tomorrow: max kW = 4.5 → 4500 W
console.log('getPeakPower(1):', agg.getPeakPower(1, 'UTC'), '(expect 4500)');

// Forecast this hour (11:00-12:00 UTC):
// [10:30, 11:00) overlaps 0 min (ends at 11:00, hourStart is 11:00, no overlap)
// [11:00, 11:30) overlaps 30 min → 2.0 kW * 1000 * 0.5h = 1000 Wh
// [11:30, 12:00) overlaps 30 min → 3.0 kW * 1000 * 0.5h = 1500 Wh → total 2500
// Wait — hour start for 11:15 UTC is 11:00 UTC. Intervals fully within [11:00, 12:00):
// [11:00,11:30): kw=3.0 → overlap=30min → 3.0*1000*(30/60) = 1500
// [11:30,12:00): kw=4.2 → overlap=30min → 4.2*1000*(30/60) = 2100 → total 3600
// Actually the interval ending at 11:00 has start=10:30 so its kw=2.0
// Interval ending at 11:30 has start=11:00, kw=3.0
// Interval ending at 12:00 has start=11:30, kw=4.2
console.log('getForecastThisHour:', agg.getForecastThisHour(now), '(expect 3600)');

// Forecast next hour (12:00-13:00 UTC):
// [12:00,12:30): kw=4.0 → 2000 Wh
// [12:30,13:00): kw=3.5 → 1750 Wh → total 3750
console.log('getForecastNextHour:', agg.getForecastNextHour(now), '(expect 3750)');

// Remaining today from 11:15:
// [11:00,11:30) partially remaining: 15/30 of 3.0kW*0.5h = 0.75 kWh
// [11:30,12:00) full: 4.2*0.5 = 2.1
// [12:00,12:30) full: 4.0*0.5 = 2.0
// [12:30,13:00) full: 3.5*0.5 = 1.75
// [13:00,13:30) full: 2.5*0.5 = 1.25
// [13:30,14:00) full: 1.5*0.5 = 0.75
// [14:00,14:30) full: 0.5*0.5 = 0.25
// total = 0.75 + 2.1 + 2.0 + 1.75 + 1.25 + 0.75 + 0.25 = 8.85
console.log('getForecastRemaining:', agg.getForecastRemaining(now, 'UTC'), '(expect 8.85)');

console.log('');
console.log('=== getAll() ===');
console.log(agg.getAll('UTC'));

// Test hard limit
console.log('');
console.log('=== Hard Limit Test (2.0 kW cap) ===');
const aggCapped = new ForecastAggregator(forecasts, 'pv_estimate', 2.0);
console.log('getPowerNow (capped):', aggCapped.getPowerNow(now), '(expect 2000)');
console.log('getPeakPower(0) capped:', aggCapped.getPeakPower(0, 'UTC'), '(expect 2000)');

// Test pv_estimate10
console.log('');
console.log('=== pv_estimate10 Test ===');
const agg10 = new ForecastAggregator(forecasts, 'pv_estimate10');
console.log('getPowerNow (est10):', agg10.getPowerNow(now), '(expect 2000)');

// Test empty forecasts
console.log('');
console.log('=== Empty Forecast Test ===');
const aggEmpty = new ForecastAggregator([]);
console.log('getPowerNow:', aggEmpty.getPowerNow(), '(expect 0)');
console.log('getForecastDay(0):', aggEmpty.getForecastDay(0), '(expect 0)');
console.log('getPeakTime(0):', aggEmpty.getPeakTime(0), '(expect null)');
*/
