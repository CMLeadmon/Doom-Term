import { describe, it, expect } from 'vitest';
import { toPlateState } from '../hud/state';

/**
 * The mapping from a Telemetry message to AppTelemetry, exercised through the
 * plate state it produces — that is the thing the user actually sees, and the
 * '--' rule is the whole point of the field.
 */
describe('usage percentage on the plate', () => {
  it('renders an observed fraction as a percentage', () => {
    expect(toPlateState({ rateUsed: 0.42 }).usage).toBe('42%');
  });

  it('renders an unknown usage as -- rather than 0%', () => {
    // A daemon that sent null, or an agent that is not Claude.
    expect(toPlateState({ rateUsed: undefined }).usage).toBe('--');
    expect(toPlateState({}).usage).toBe('--');
  });

  it('does not round a real zero up into nothing', () => {
    // A brand new billing window genuinely is 0%. That is observed, so it shows.
    expect(toPlateState({ rateUsed: 0 }).usage).toBe('0%');
  });

  it('caps a fully consumed limit at 99% so the slot never reads 100%', () => {
    expect(toPlateState({ rateUsed: 1 }).usage).toBe('99%');
  });
});
