import { daysLeft, formatRetention, isArchived } from './archive';
import { TraineeRow } from './types';

const row = (capstone?: Partial<NonNullable<TraineeRow['capstone']>>): TraineeRow =>
  ({ traineeEmail: 'a@b.c', resourceName: 'r', taskType: 'x', environment: { state: 'running', updatedAt: '', agentOnline: true }, events: [], capstone: capstone && { id: 'e', capstone: 'c', traineeNo: '01', status: 'active', ...capstone } }) as TraineeRow;

describe('isArchived', () => {
  it('only a capstone marked done is archived', () => {
    expect(isArchived(row({ status: 'completed' }))).toBe(true);
    expect(isArchived(row({ status: 'active' }))).toBe(false);
    expect(isArchived(row({ status: 'seeded' }))).toBe(false);
    expect(isArchived(row())).toBe(false); // a lab that is not a capstone
  });
});

describe('formatRetention', () => {
  it.each([
    [365, '1 year'],
    [730, '2 years'],
    [90, '90 days'],
    [30, '30 days'],
    [1, '1 day'],
    [400, '400 days'],
  ])('%p days -> %s', (days, text) => expect(formatRetention(days)).toBe(text));
});

describe('daysLeft', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  it('counts whole days, rounding a started day up', () => {
    expect(daysLeft('2026-11-17T12:00:00Z', now)).toBe(10);
    expect(daysLeft('2026-11-17T12:00:01Z', now)).toBe(11);
    expect(daysLeft('2026-11-08T11:00:00Z', now)).toBe(1);
  });
  it('is never negative, and empty without a date', () => {
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe(0);
    expect(daysLeft(undefined, now)).toBeUndefined();
    expect(daysLeft('not a date', now)).toBeUndefined();
  });
});
