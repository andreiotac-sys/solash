import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBooking, dateToWeekdayKey, getWorkWindowsForDate, parseDurationToMinutes } from '../src/lib/scheduling.ts';

const baseDay = { enabled: true, hasBreak: false, start: '08:00', end: '21:00', breakStart: '13:00', breakEnd: '14:00' };
const settings = () => ({ schedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { ...baseDay }])), daysOff: [] });
const existing = (id, date, start, duration, status = 'Confirmata', service = 'Serviciu') => ({
  id, date, start, duration, status, service, clientId: id, clientName: '', price: 1, phone: '', notes: '',
});
const check = (overrides = {}) => checkBooking({ date: '2026-09-08', start: '16:00', duration: '3h', appointments: [], settings: settings(), ...overrides });

test('inside hours and September 8 16:00–19:00', () => assert.equal(check().kind, 'valid'));
test('opening boundary', () => assert.equal(check({ start: '08:00' }).kind, 'valid'));
test('closing boundary', () => assert.equal(check({ start: '18:00' }).kind, 'valid'));
test('outside hours needs override', () => assert.equal(check({ start: '19:00' }).kind, 'outside_hours'));
test('break overlap is outside hours', () => {
  const configured = settings(); configured.schedule[1].hasBreak = true;
  assert.equal(check({ start: '12:30', duration: '1h', settings: configured }).kind, 'outside_hours');
});
test('multiple work windows accept afternoon interval', () => {
  const configured = settings(); configured.schedule[1].hasBreak = true;
  assert.deepEqual(getWorkWindowsForDate('2026-09-08', configured), [{ start: 480, end: 780 }, { start: 840, end: 1260 }]);
  assert.equal(check({ settings: configured }).kind, 'valid');
});
test('explicit day off', () => { const configured = settings(); configured.daysOff = ['2026-09-08']; assert.equal(check({ settings: configured }).kind, 'outside_hours'); });
test('holiday does not silently alter configured hours', () => assert.equal(check({ date: '2026-12-25' }).kind, 'valid'));
test('active booking conflict', () => assert.equal(check({ appointments: [existing(1, '2026-09-08', '17:00', '1h')] }).kind, 'conflict'));
test('cancelled booking is ignored', () => assert.equal(check({ appointments: [existing(1, '2026-09-08', '17:00', '1h', 'Anulata')] }).kind, 'valid'));
test('editing ignores itself', () => assert.equal(check({ editingId: 1, appointments: [existing(1, '2026-09-08', '16:00', '3h')] }).kind, 'valid'));
test('rescheduling to another booking is rejected', () => assert.equal(check({ editingId: 1, appointments: [existing(1, '2026-09-08', '10:00', '1h'), existing(2, '2026-09-08', '17:00', '1h')] }).kind, 'conflict'));
test('custom duration', () => { assert.equal(parseDurationToMinutes('1h30min'), 90); assert.equal(check({ start: '19:30', duration: '1h30min' }).kind, 'valid'); });
test('personal blocked interval conflicts', () => assert.equal(check({ appointments: [existing(7, '2026-09-08', '17:00', '1h', 'Noua', 'Blocaj personal')] }).kind, 'conflict'));
test('weekday calculation is independent of host timezone', () => { assert.equal(dateToWeekdayKey('2026-09-08'), 1); assert.equal(dateToWeekdayKey('2026-03-29'), 6); });
test('daylight saving transition dates remain valid local calendar dates', () => { assert.equal(check({ date: '2026-03-29' }).kind, 'valid'); assert.equal(check({ date: '2026-10-25' }).kind, 'valid'); });
test('calendar entry points share validator results', () => { for (const entry of ['form', 'free slot', 'day timeline', 'month', 'long press', 'drag']) assert.equal(check().kind, 'valid', entry); });
test('hours override cannot override a booking conflict', () => { const configured = settings(); configured.schedule[1].end = '18:00'; assert.equal(check({ settings: configured, appointments: [existing(2, '2026-09-08', '17:00', '1h')] }).kind, 'conflict'); });
test('adjacent appointments may touch', () => assert.equal(check({ start: '10:00', duration: '1h', appointments: [existing(1, '2026-09-08', '09:00', '1h')] }).kind, 'valid'));
test('invalid time or duration is rejected', () => { assert.equal(check({ start: '25:00' }).kind, 'invalid'); assert.equal(check({ duration: '0min' }).kind, 'invalid'); });
test('end past midnight is rejected', () => assert.equal(check({ start: '23:00', duration: '2h' }).kind, 'invalid'));

// Sunday exceptions may bypass hours warnings, never validation or conflicts.
test('closed Sunday is an hours warning, not invalid', () => {
  const configured = settings(); configured.schedule[6].enabled = false;
  assert.equal(check({ date: '2026-10-18', settings: configured }).kind, 'outside_hours');
  assert.equal(check({ date: '2026-10-18', settings: configured, appointments: [existing(70, '2026-10-18', '17:00', '1h', 'Programata', 'Blocaj personal')] }).kind, 'conflict');
  assert.equal(check({ date: '2026-10-18', start: '23:00', duration: '2h', settings: configured }).kind, 'invalid');
});
