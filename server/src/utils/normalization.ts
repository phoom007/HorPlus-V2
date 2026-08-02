/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalizes a room identifier by removing all whitespace and standardizing casing.
 *
 * @param identifier The raw room identifier string.
 * @returns The normalized string.
 */
export function normalizeRoomIdentifier(identifier: string): string {
  if (!identifier) return '';
  return identifier.normalize('NFC').replace(/[\s_]+/g, '').toUpperCase();
}

export interface ParseRoomResult {
  isValid: boolean;
  derivedFloor: number | null;
  normalizedValue: string;
  displayValue: string;
  roomSequence: string | number;
  error?: string;
}

/**
 * Derives the floor number and validates the room identifier against the building's pattern.
 *
 * @param buildingConfig Building configuration (code, pattern, floorCount, roomsPerFloor)
 * @param roomNumber The room identifier to parse
 */
export function parseRoomIdentifier(
  buildingConfig: { code?: string | null; numberingPattern?: string | null; floorCount?: number; roomsPerFloor?: number | null },
  roomNumber: string
): ParseRoomResult {
  const { code, numberingPattern, floorCount, roomsPerFloor } = buildingConfig;
  const normalized = normalizeRoomIdentifier(roomNumber);
  const prefix = normalizeRoomIdentifier(code || '');
  // The canonical display value enforces trimmed spaces and correct uppercase prefixes
  const displayValue = normalized;

  if (!normalized) {
    return { isValid: false, derivedFloor: null, normalizedValue: '', displayValue, roomSequence: '', error: 'Room number cannot be empty' };
  }

  if (normalized.length > 50) {
    return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence: '', error: 'Room number is too long' };
  }

  // If no specific pattern is defined, default to basic floor derivation or 1
  if (!numberingPattern) {
    const digitsOnly = normalized.replace(/\D/g, '');
    const floor = digitsOnly ? parseInt(digitsOnly.charAt(0)) || 1 : 1;
    return { isValid: true, derivedFloor: floor, normalizedValue: normalized, displayValue, roomSequence: digitsOnly || normalized };
  }

  let derivedFloor = 1;
  let roomSequence: string | number = '';
  let match: RegExpMatchArray | null = null;

  switch (numberingPattern) {
    case 'prefix_floor_room': {
      // e.g., A101 (prefix: A, floor: 1, room: 01)
      if (!prefix) return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: 'Building code required for this pattern' };
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      match = normalized.match(new RegExp(`^${escapedPrefix}(\\d+)(\\d{2})$`));
      if (!match) {
        return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: `Must match format: ${prefix}[Floor][Room] (e.g. ${prefix}101)` };
      }
      derivedFloor = parseInt(match[1], 10);
      roomSequence = parseInt(match[2], 10);
      break;
    }
    case 'floor_room': {
      // e.g., 101 (floor: 1, room: 01)
      match = normalized.match(/^(\d+)(\d{2})$/);
      if (!match) {
        return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: 'Must match format: [Floor][Room] (e.g. 101)' };
      }
      derivedFloor = parseInt(match[1], 10);
      roomSequence = parseInt(match[2], 10);
      break;
    }
    case 'prefix_floor_slash_room': {
      // e.g., A1/1 (prefix: A, floor: 1, room: 1)
      if (!prefix) return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: 'Building code required for this pattern' };
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      match = normalized.match(new RegExp(`^${escapedPrefix}(\\d+)/(\\d+)$`));
      if (!match) {
        return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: `Must match format: ${prefix}[Floor]/[Room] (e.g. ${prefix}1/1)` };
      }
      derivedFloor = parseInt(match[1], 10);
      roomSequence = parseInt(match[2], 10);
      break;
    }
    case 'floor_slash_room': {
      // e.g., 1/1 (floor: 1, room: 1)
      match = normalized.match(/^(\d+)\/(\d+)$/);
      if (!match) {
        return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: 'Must match format: [Floor]/[Room] (e.g. 1/1)' };
      }
      derivedFloor = parseInt(match[1], 10);
      roomSequence = parseInt(match[2], 10);
      break;
    }
    case 'prefix_dash_floor_room': {
      // e.g., A-101 (prefix: A, floor: 1, room: 01)
      if (!prefix) return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: 'Building code required for this pattern' };
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      match = normalized.match(new RegExp(`^${escapedPrefix}-(\\d+)(\\d{2})$`));
      if (!match) {
        return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: `Must match format: ${prefix}-[Floor][Room] (e.g. ${prefix}-101)` };
      }
      derivedFloor = parseInt(match[1], 10);
      roomSequence = parseInt(match[2], 10);
      break;
    }
    default: {
      return { isValid: false, derivedFloor: null, normalizedValue: normalized, displayValue, roomSequence, error: 'Unknown numbering pattern' };
    }
  }

  if (floorCount && derivedFloor > floorCount) {
    return { isValid: false, derivedFloor, normalizedValue: normalized, displayValue, roomSequence, error: `Derived floor ${derivedFloor} exceeds building floor count ${floorCount}` };
  }

  if (roomsPerFloor && typeof roomSequence === 'number' && roomSequence > roomsPerFloor) {
    return { isValid: false, derivedFloor, normalizedValue: normalized, displayValue, roomSequence, error: `Room sequence ${roomSequence} exceeds rooms per floor ${roomsPerFloor}` };
  }
  
  if (typeof roomSequence === 'number' && roomSequence === 0) {
    return { isValid: false, derivedFloor, normalizedValue: normalized, displayValue, roomSequence, error: `Room sequence cannot be zero` };
  }

  return { isValid: true, derivedFloor, normalizedValue: normalized, displayValue, roomSequence };
}
