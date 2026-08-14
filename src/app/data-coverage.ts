export type CoverageInterval = { startDate: string; endDate: string };

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function mergeCoverageIntervals(intervals: CoverageInterval[]): CoverageInterval[] {
  const sorted = [...intervals].sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate));
  const merged: CoverageInterval[] = [];
  for (const interval of sorted) {
    const current = merged.at(-1);
    if (!current || interval.startDate > nextDate(current.endDate)) {
      merged.push({ ...interval });
      continue;
    }
    if (interval.endDate > current.endDate) current.endDate = interval.endDate;
  }
  return merged;
}

export function intersectCoverageIntervals(intervalSets: CoverageInterval[][]): CoverageInterval[] {
  if (intervalSets.length === 0) return [];
  let common = mergeCoverageIntervals(intervalSets[0]);
  for (const intervals of intervalSets.slice(1)) {
    const right = mergeCoverageIntervals(intervals);
    const intersections: CoverageInterval[] = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < common.length && rightIndex < right.length) {
      const leftInterval = common[leftIndex];
      const rightInterval = right[rightIndex];
      const startDate = leftInterval.startDate > rightInterval.startDate ? leftInterval.startDate : rightInterval.startDate;
      const endDate = leftInterval.endDate < rightInterval.endDate ? leftInterval.endDate : rightInterval.endDate;
      if (startDate <= endDate) intersections.push({ startDate, endDate });
      if (leftInterval.endDate < rightInterval.endDate) leftIndex += 1;
      else rightIndex += 1;
    }
    common = mergeCoverageIntervals(intersections);
    if (common.length === 0) break;
  }
  return common;
}

export function intersectCoverageFromActivation(intervalSets: CoverageInterval[][]): CoverageInterval[] {
  const mergedSets = intervalSets.map(mergeCoverageIntervals);
  if (mergedSets.length === 0 || mergedSets.some(intervals => intervals.length === 0)) return [];
  const earliestActivation = mergedSets
    .map(intervals => intervals[0].startDate)
    .sort()[0];
  return intersectCoverageIntervals(mergedSets.map(intervals => intervals.map((interval, index) => (
    index === 0 ? { ...interval, startDate: earliestActivation } : interval
  ))));
}

export function coverageIntervalForStart(intervals: CoverageInterval[], startDate: string) {
  return intervals.find(interval => interval.startDate <= startDate && startDate <= interval.endDate) ?? null;
}

export function capEndDateToCoverage(selectedEndDate: string, interval: CoverageInterval) {
  return !selectedEndDate || interval.endDate < selectedEndDate ? interval.endDate : selectedEndDate;
}
