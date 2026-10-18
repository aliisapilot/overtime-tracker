/**
 * Deterministic, collision-free Display ID Mapping for Overtime Tracker
 * Maps long internal IDs (e.g. EMPMUZYCYTW8G5F, SITEMUZYCYTW8G5F) to clean,
 * compact display IDs (EMP001, SITE001) while preserving original internal IDs
 * for all database and API operations.
 */

export interface IdentifiableItem {
  id?: string;
  ID?: string;
  displayId?: string;
  DisplayID?: string;
  createdAt?: string;
  'Created At'?: string;
}

/**
 * Build a deterministic, collision-free map from internal IDs to display IDs.
 * Stable across refreshes, devices, and deployments.
 * Does NOT depend on row position.
 */
export function buildDisplayIdMap<T extends IdentifiableItem>(
  items: T[] = [],
  prefix: 'EMP' | 'SITE'
): Map<string, string> {
  const map = new Map<string, string>();
  const usedNumbers = new Set<number>();
  const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');

  // Pass 1: Preserve existing clean sequential IDs (e.g. EMP000, EMP001, SITE001)
  // or server-persisted display IDs
  for (const item of items) {
    const rawId = (item.id || item.ID || '').toString().trim().toUpperCase();
    if (!rawId) continue;

    const serverDisplayId = (item.displayId || item.DisplayID || '').toString().trim().toUpperCase();
    if (serverDisplayId && regex.test(serverDisplayId)) {
      const match = serverDisplayId.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        usedNumbers.add(num);
        map.set(rawId, `${prefix}${String(num).padStart(3, '0')}`);
        continue;
      }
    }

    const match = rawId.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      usedNumbers.add(num);
      map.set(rawId, `${prefix}${String(num).padStart(3, '0')}`);
    }
  }

  // Pass 2: Sort remaining items deterministically by creation timestamp, then raw ID
  const remaining = items
    .filter((item) => {
      const rawId = (item.id || item.ID || '').toString().trim().toUpperCase();
      return rawId && !map.has(rawId);
    })
    .sort((a, b) => {
      const rawTimeA = (a.createdAt || a['Created At'] || '').toString();
      const rawTimeB = (b.createdAt || b['Created At'] || '').toString();
      const timeA = rawTimeA ? new Date(rawTimeA).getTime() : 0;
      const timeB = rawTimeB ? new Date(rawTimeB).getTime() : 0;
      if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) {
        return timeA - timeB;
      }
      const idA = (a.id || a.ID || '').toString().toUpperCase();
      const idB = (b.id || b.ID || '').toString().toUpperCase();
      return idA.localeCompare(idB);
    });

  // Assign lowest available sequential numbers starting from 1 (0 is preserved for EMP000 admin)
  let nextNum = 1;
  for (const item of remaining) {
    const rawId = (item.id || item.ID || '').toString().trim().toUpperCase();
    if (map.has(rawId)) continue;

    while (usedNumbers.has(nextNum)) {
      nextNum++;
    }

    const displayId = `${prefix}${String(nextNum).padStart(3, '0')}`;
    usedNumbers.add(nextNum);
    map.set(rawId, displayId);
    nextNum++;
  }

  return map;
}

/**
 * Deterministic fallback hash for single IDs when full list is unavailable
 */
function deterministicShortHash(rawId: string, prefix: 'EMP' | 'SITE'): string {
  let hash = 0;
  for (let i = 0; i < rawId.length; i++) {
    hash = (hash << 5) - hash + rawId.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash) % 999 + 1; // 1 to 999
  return `${prefix}${String(positive).padStart(3, '0')}`;
}

/**
 * Get clean, short Display ID for an Employee
 */
export function getEmployeeDisplayId<T extends IdentifiableItem>(
  rawId?: string | null,
  allEmployees?: T[]
): string {
  if (!rawId) return '';
  const cleanId = rawId.toString().trim().toUpperCase();
  if (cleanId === 'EMP000') return 'EMP000';

  // Check if it already is a clean 3-digit EMP ID
  const match = cleanId.match(/^EMP(\d+)$/i);
  if (match) {
    return `EMP${match[1].padStart(3, '0')}`;
  }

  // Lookup in allEmployees if provided
  if (allEmployees && allEmployees.length > 0) {
    const map = buildDisplayIdMap(allEmployees, 'EMP');
    if (map.has(cleanId)) {
      return map.get(cleanId)!;
    }
  }

  // Deterministic fallback hash
  return deterministicShortHash(cleanId, 'EMP');
}

/**
 * Get clean, short Display ID for a Job Site
 */
export function getJobSiteDisplayId<T extends IdentifiableItem>(
  rawId?: string | null,
  allSites?: T[]
): string {
  if (!rawId) return '';
  const cleanId = rawId.toString().trim().toUpperCase();
  if (cleanId === 'FIELD' || cleanId === 'UNASSIGNED') return cleanId;

  // Check if it already is a clean 3-digit SITE ID
  const match = cleanId.match(/^SITE(\d+)$/i);
  if (match) {
    return `SITE${match[1].padStart(3, '0')}`;
  }

  // Lookup in allSites if provided
  if (allSites && allSites.length > 0) {
    const map = buildDisplayIdMap(allSites, 'SITE');
    if (map.has(cleanId)) {
      return map.get(cleanId)!;
    }
  }

  // Deterministic fallback hash
  return deterministicShortHash(cleanId, 'SITE');
}
