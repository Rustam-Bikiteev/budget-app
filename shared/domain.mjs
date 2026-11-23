// Pure calculations. Storage and UI pass values explicitly.
export const sumBy = (rows, fn) => rows.reduce((sum, row) => sum + fn(row), 0);
export const used = row => Math.max(row.planned, row.actual);
export const reserveLeft = row => Math.max(0, row.planned - row.actual);
export const isReserve = row => row.type === 'mandatory' && row.is_reserve === true;
export const isPaid = row => !isReserve(row) && row.planned > 0 && row.actual >= row.planned;

// Legacy names are interpreted once at the storage/backup boundary, never in UI.
export function normalizeEntry(row) {
  return { ...row, is_reserve: row.type === 'mandatory' &&
    (typeof row.is_reserve === 'boolean' ? row.is_reserve : /непредвид/i.test(row.name || '')) };
}

export function initialPeriod(now, mode = 'local') {
  let year = now.getFullYear(), month = now.getMonth() + 1;
  const day = now.getDate(), half = day >= 10 && day <= 24 ? 1 : 2;
  if (mode === 'cloud' && day < 10) { month--; if (!month) { month = 12; year--; } }
  return { year, month, half };
}

export function shiftPeriod({ year, month, half }, direction) {
  const index = year * 24 + (month - 1) * 2 + half - 1 + (direction > 0 ? 1 : -1);
  return { year: Math.floor(index / 24), month: Math.floor((index % 24) / 2) + 1, half: index % 2 + 1 };
}

export function periodRange(year, month, half) {
  return half === 1
    ? { start: new Date(year, month - 1, 10), end: new Date(year, month - 1, 24) }
    : { start: new Date(year, month - 1, 25), end: new Date(year, month, 9) };
}

export function periodDaysLeft(period, now) {
  const { start, end } = periodRange(period.year, period.month, period.half);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return today < start || today > end ? null : Math.round((end - today) / 864e5) + 1;
}

export function plannedTotalsFor(entries, category = 'all', categories = null) {
  let filtered = entries.filter(row => row.type === 'planned' && (category === 'all' || row.category === category));
  if (categories) filtered = sortCategories(filtered, categories);
  const totPlan = sumBy(filtered, row => row.planned), totActual = sumBy(filtered, row => row.actual);
  return { filtered, totPlan, totActual, totRem: totPlan - totActual };
}

export function sortCategories(rows, categories) {
  const index = id => { const i = categories.findIndex(category => category.id === id); return i < 0 ? categories.length : i; };
  return [...rows].sort((a, b) => index(a.category) - index(b.category));
}

export function localSummary({ income, saved, entries }) {
  const mandatory = sumBy(entries.filter(row => row.type === 'mandatory'), row => row.planned);
  const spent = sumBy(entries.filter(row => row.type === 'planned'), row => row.actual);
  const allowed = income - mandatory - saved;
  return { mandatory, spent, allowed, remain: allowed - spent };
}

export function cloudSummary({ income, saved, entries }) {
  const mandatory = entries.filter(row => row.type === 'mandatory'), planned = entries.filter(row => row.type === 'planned');
  const mand = sumBy(mandatory, row => isReserve(row) ? reserveLeft(row) : row.planned);
  const mandPaid = sumBy(mandatory.filter(isPaid), row => row.planned);
  const life = income - mand - saved, allocated = sumBy(planned, used), spent = sumBy(planned, row => row.actual);
  return { mand, mandPaid, life, allocated, spent, free: life - allocated };
}
