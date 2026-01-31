import { RegistrationStartOffsetPipe } from './registration-start-offset.pipe';

describe('RegistrationStartOffsetPipe', () => {
  let pipe: RegistrationStartOffsetPipe;

  beforeEach(() => {
    pipe = new RegistrationStartOffsetPipe();
  });

  it('should create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('should handle null and undefined values', () => {
    expect(pipe.transform(null)).toBe('At event start');
    expect(pipe.transform()).toBe('At event start');
  });

  it('should handle zero offset', () => {
    expect(pipe.transform(0)).toBe('At event start');
  });

  it('should format single hour before event start', () => {
    expect(pipe.transform(1)).toBe('1 hour before event start');
  });

  it('should format multiple hours before event start', () => {
    expect(pipe.transform(5)).toBe('5 hours before event start');
  });

  it('should format single hour after event start', () => {
    expect(pipe.transform(-1)).toBe('1 hour after event start');
  });

  it('should format multiple hours after event start', () => {
    expect(pipe.transform(-8)).toBe('8 hours after event start');
  });

  it('should format single day before event start', () => {
    expect(pipe.transform(24)).toBe('1 day before event start');
  });

  it('should format multiple days before event start', () => {
    expect(pipe.transform(48)).toBe('2 days before event start');
  });

  it('should format single day after event start', () => {
    expect(pipe.transform(-24)).toBe('1 day after event start');
  });

  it('should format days and hours before event start', () => {
    expect(pipe.transform(25)).toBe('1 day and 1 hour before event start');
    expect(pipe.transform(26)).toBe('1 day and 2 hours before event start');
    expect(pipe.transform(49)).toBe('2 days and 1 hour before event start');
  });

  it('should format days and hours after event start', () => {
    expect(pipe.transform(-25)).toBe('1 day and 1 hour after event start');
    expect(pipe.transform(-26)).toBe('1 day and 2 hours after event start');
    expect(pipe.transform(-49)).toBe('2 days and 1 hour after event start');
  });
});
