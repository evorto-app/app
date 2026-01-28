import { DateTime } from 'luxon';

export const getSeedDateTime = (date: Date = new Date()) => {
  return DateTime.fromJSDate(date, { zone: 'utc' }).startOf('day');
};

export const getSeedDate = (date: Date = new Date()) => {
  return getSeedDateTime(date).toJSDate();
};

export const getSeedDayKey = (date: Date = new Date()) => {
  return getSeedDateTime(date).toFormat('yyyy-LL-dd');
};
