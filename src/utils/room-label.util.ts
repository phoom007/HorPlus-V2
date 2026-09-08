/**
 * Utility for formatting room option labels across Owner room selectors.
 * Authority: room.roomNumber + actual Building.name associated with room.buildingId.
 * Format: "204 • A", "304 • A", "B102 • อาคาร B", or "204" if no building/name.
 * Never hardcodes A / B from room-number prefixes.
 * Never renders dangling bullets (e.g. never "204 •").
 * @license Apache-2.0
 */

export interface RoomOptionLike {
  roomNumber: string;
  buildingId?: string | null;
  buildingName?: string | null;
  building?: { name?: string | null } | null;
}

export interface BuildingOptionLike {
  id: string;
  name: string;
}

export function formatOwnerRoomOptionLabel(
  room: RoomOptionLike,
  buildings: BuildingOptionLike[] = []
): string {
  const roomNumber = (room.roomNumber || '').trim();
  let bldName = room.buildingName?.trim() || room.building?.name?.trim();

  if (!bldName && room.buildingId && Array.isArray(buildings)) {
    const matched = buildings.find((b) => b.id === room.buildingId);
    if (matched?.name?.trim()) {
      bldName = matched.name.trim();
    }
  }

  if (bldName) {
    return `${roomNumber} • ${bldName}`;
  }
  return roomNumber;
}
