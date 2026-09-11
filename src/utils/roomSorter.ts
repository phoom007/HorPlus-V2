/**
 * Canonical Room Sorter
 * 
 * Sorts rooms according to:
 * 1. Building order (order in which buildings were added/created, earlier first, newly added last)
 * 2. Floor within the building (ascending numeric)
 * 3. Room number within the floor/building (natural alphanumeric sort)
 */

export interface SorterBuilding {
  id: string;
  createdAt?: string;
  displayOrder?: number;
  name?: string;
}

export interface SorterRoom {
  id: string;
  buildingId?: string | null;
  floor?: number | string | null;
  roomNumber: string;
}

export const sortRoomsByBuildingAndNumber = <T extends SorterRoom>(
  roomList: T[],
  buildingList: SorterBuilding[] = []
): T[] => {
  if (!roomList || roomList.length === 0) return [];

  // Sort buildingList: displayOrder ascending, then createdAt ascending (older buildings first, newly added buildings last)
  const sortedBuildings = [...buildingList].sort((a, b) => {
    const orderA = a.displayOrder ?? 0;
    const orderB = b.displayOrder ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateA - dateB;
  });

  const buildingOrderMap = new Map<string, number>();
  
  // Build lookup index: earlier buildings get lower index, newer buildings get higher index
  sortedBuildings.forEach((bld, idx) => {
    if (bld?.id) {
      buildingOrderMap.set(bld.id.toLowerCase(), idx);
    }
  });

  return [...roomList].sort((a, b) => {
    const bldIdA = (a.buildingId || '').toLowerCase();
    const bldIdB = (b.buildingId || '').toLowerCase();
    const bldIdxA = buildingOrderMap.has(bldIdA)
      ? buildingOrderMap.get(bldIdA)!
      : 999999;
    const bldIdxB = buildingOrderMap.has(bldIdB)
      ? buildingOrderMap.get(bldIdB)!
      : 999999;

    if (bldIdxA !== bldIdxB) {
      return bldIdxA - bldIdxB;
    }

    // Inside the same building: sort by floor (numeric)
    const floorA = a.floor !== undefined && a.floor !== null ? Number(a.floor) : 0;
    const floorB = b.floor !== undefined && b.floor !== null ? Number(b.floor) : 0;
    if (floorA !== floorB && !isNaN(floorA) && !isNaN(floorB)) {
      return floorA - floorB;
    }

    // Inside same building & floor: sort by room number
    return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
};
