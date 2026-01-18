export const parseTimeOfDay = (value) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(v => Number.parseInt(v, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return { hours, minutes };
};

const getCandidateDate = (now, time) => new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  now.getUTCDate(),
  time.hours,
  time.minutes,
  0,
  0
));

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const addMonths = (date, months) => {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, maxDay));
  return next;
};

const computeFromNow = (frequency, time, now) => {
  const candidate = getCandidateDate(now, time);
  if (frequency === 'daily') {
    return candidate <= now ? addDays(candidate, 1) : candidate;
  }
  if (frequency === 'weekly') {
    return candidate <= now ? addDays(candidate, 7) : candidate;
  }
  if (frequency === 'monthly') {
    return candidate <= now ? addMonths(candidate, 1) : candidate;
  }
  return null;
};

const computeFromLast = (frequency, time, lastRunAt) => {
  const last = new Date(lastRunAt);
  if (frequency === 'weekly') {
    last.setUTCHours(time.hours, time.minutes, 0, 0);
    return addDays(last, 7);
  }
  if (frequency === 'monthly') {
    last.setUTCHours(time.hours, time.minutes, 0, 0);
    return addMonths(last, 1);
  }
  return null;
};

export const computeNextRunAt = ({ frequency, timeOfDay, lastRunAt }, now = new Date()) => {
  if (!frequency || frequency === 'off') return null;
  const time = parseTimeOfDay(timeOfDay);
  if (!time) return null;
  if (!lastRunAt) {
    const next = computeFromNow(frequency, time, now);
    return next ? next.toISOString() : null;
  }
  if (frequency === 'daily') {
    const daily = computeFromNow('daily', time, now);
    return daily ? daily.toISOString() : null;
  }
  const fromLast = computeFromLast(frequency, time, lastRunAt);
  return fromLast ? fromLast.toISOString() : null;
};

export const shouldRunNow = (schedule, now = new Date()) => {
  if (!schedule || schedule.frequency === 'off') return false;
  const nextRun = schedule.nextRunAt || computeNextRunAt(schedule, now);
  if (!nextRun) return true;
  return new Date(nextRun) <= now;
};
