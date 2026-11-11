export interface ContainerCounts {
  count20: number;
  count40: number;
}

export function parseContainerCounts(value: string): ContainerCounts {
  const counts: ContainerCounts = { count20: 0, count40: 0 };
  for (const match of value.matchAll(/(20|40)\s*'?\s*(?:×|x|\*)\s*(\d+)/gi)) {
    const key = match[1] === '40' ? 'count40' : 'count20';
    counts[key] += Math.min(10, Math.max(0, Number(match[2]) || 0));
  }
  if (counts.count20 === 0 && counts.count40 === 0) {
    if (/^20\s*'?$/i.test(value.trim())) counts.count20 = 1;
    else if (/^40\s*'?$/i.test(value.trim())) counts.count40 = 1;
  }
  return counts;
}

export function buildContainerSize(count20: number, count40: number): string {
  return [count20 > 0 ? `20' ×${count20}` : '', count40 > 0 ? `40' ×${count40}` : '']
    .filter(Boolean)
    .join(' · ');
}

export function containerSummary(count20: number, count40: number): string {
  return (
    [count20 > 0 ? `${count20} × 20'` : '', count40 > 0 ? `${count40} × 40'` : '']
      .filter(Boolean)
      .join(' + ') || '0 cont'
  );
}

export function splitContainerNos(value: string): string[] {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean);
}
