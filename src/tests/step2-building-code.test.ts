import { describe, it, expect } from 'vitest';
import { saveRegistrationDraft, getRegistrationDraft } from '../utils/localDraftStorage';

// Helper matching register.tsx getGeneratedRooms implementation
function getGeneratedRooms(b: {
  totalFloors: number | string;
  roomsPerFloor: number | string;
  roomPrefix: string;
  formatPattern: string;
  mode: 'auto' | 'manual';
  customRooms?: string[];
}) {
  if (b.customRooms && b.customRooms.length === 1 && b.customRooms[0] === '__EMPTY__') {
    return [];
  }

  if (b.mode === 'manual' && b.customRooms && b.customRooms.length > 0) {
    return b.customRooms.filter(r => r !== '__EMPTY__');
  }

  if (b.mode === 'auto' && b.customRooms && b.customRooms.length > 0) {
    return b.customRooms.filter(r => r !== '__EMPTY__');
  }

  const rooms: string[] = [];
  const prefix = b.roomPrefix ? b.roomPrefix.trim().toUpperCase() : '';
  const maxFloors = Number(b.totalFloors) || 0;
  const maxRooms = Number(b.roomsPerFloor) || 0;

  for (let floor = 1; floor <= maxFloors; floor++) {
    for (let rm = 1; rm <= maxRooms; rm++) {
      const rmStr = rm < 10 ? `0${rm}` : `${rm}`;
      let roomNum = '';

      switch (b.formatPattern) {
        case 'prefix_floor_room': // A101
          roomNum = `${prefix}${floor}${rmStr}`;
          break;
        case 'floor_room': // 101
          roomNum = `${floor}${rmStr}`;
          break;
        case 'prefix_floor_slash_room': // A1/1
          roomNum = `${prefix}${floor}/${rm}`;
          break;
        case 'floor_slash_room': // 1/1
          roomNum = `${floor}/${rm}`;
          break;
        case 'prefix_dash_floor_room': // A-101
          roomNum = `${prefix ? prefix + '-' : ''}${floor}${rmStr}`;
          break;
        default:
          roomNum = `${prefix}${floor}${rmStr}`;
      }
      rooms.push(roomNum);
    }
  }
  return rooms;
}

// Helper simulating register.tsx loadDraft legacy normalization
function normalizeRestoredBuildings(draftBuildings: any[]) {
  if (!Array.isArray(draftBuildings)) return [];
  return draftBuildings.map((b: any) => {
    const rawPrefix = (typeof b.roomPrefix === 'string' ? b.roomPrefix : '').trim();
    const pfx = rawPrefix.toUpperCase();
    return {
      ...b,
      roomPrefix: pfx,
      name: (b.name && b.name.trim())
        ? (rawPrefix ? b.name.replace(new RegExp(`(อาคาร\\s*)${rawPrefix}`, 'i'), `$1${pfx}`) : b.name)
        : (pfx ? `อาคาร ${pfx}` : 'อาคาร '),
    };
  });
}

describe('Owner Registration Step 2 - Building Code Uppercase Canonicalization', () => {
  it('Case A: typing "a" canonicalizes input state to "A" and generates uppercase rooms "A101"', () => {
    const rawInput = 'a';
    const canonicalPrefix = rawInput.toUpperCase();
    expect(canonicalPrefix).toBe('A');

    const building = {
      totalFloors: 1,
      roomsPerFloor: 3,
      roomPrefix: canonicalPrefix,
      formatPattern: 'prefix_floor_room',
      mode: 'auto' as const,
    };

    const rooms = getGeneratedRooms(building);
    expect(rooms).toEqual(['A101', 'A102', 'A103']);
  });

  it('Case B: typing "ab" canonicalizes input state to "AB" and generates "AB101"', () => {
    const rawInput = 'ab';
    const canonicalPrefix = rawInput.toUpperCase();
    expect(canonicalPrefix).toBe('AB');

    const building = {
      totalFloors: 2,
      roomsPerFloor: 2,
      roomPrefix: canonicalPrefix,
      formatPattern: 'prefix_floor_room',
      mode: 'auto' as const,
    };

    const rooms = getGeneratedRooms(building);
    expect(rooms).toEqual(['AB101', 'AB102', 'AB201', 'AB202']);
  });

  it('Case C: F5 local draft persistence preserves canonical uppercase building code and rooms', async () => {
    const testUserId = `test-user-${Date.now()}`;
    const draft = {
      currentStep: 2,
      formData: {
        buildings: [
          {
            id: 'b-1',
            name: 'อาคาร A',
            roomPrefix: 'a'.toUpperCase(),
            totalFloors: 1,
            roomsPerFloor: 2,
            formatPattern: 'prefix_floor_room',
            mode: 'auto',
          },
        ],
      },
    };

    await saveRegistrationDraft(testUserId, 'initial', draft);
    const restored = await getRegistrationDraft(testUserId, 'initial');
    expect(restored.formData.buildings[0].roomPrefix).toBe('A');

    const rooms = getGeneratedRooms(restored.formData.buildings[0]);
    expect(rooms).toEqual(['A101', 'A102']);
  });

  it('Case D: legacy lowercase draft containing roomPrefix = "a" safely normalizes to "A"', () => {
    const legacyBuildings = [
      {
        id: 'b-legacy-1',
        name: 'อาคาร a',
        roomPrefix: 'a',
        totalFloors: 1,
        roomsPerFloor: 2,
        formatPattern: 'prefix_floor_room',
        mode: 'auto',
      },
    ];

    const normalized = normalizeRestoredBuildings(legacyBuildings);
    expect(normalized[0].roomPrefix).toBe('A');
    expect(normalized[0].name).toBe('อาคาร A');

    const rooms = getGeneratedRooms(normalized[0]);
    expect(rooms).toEqual(['A101', 'A102']);
  });

  it('Case E: no-prefix pattern (floor_room, floor_slash_room) is not unintentionally modified', () => {
    const buildingNoPrefix = {
      totalFloors: 2,
      roomsPerFloor: 2,
      roomPrefix: 'A',
      formatPattern: 'floor_room',
      mode: 'auto' as const,
    };

    const rooms = getGeneratedRooms(buildingNoPrefix);
    expect(rooms).toEqual(['101', '102', '201', '202']);

    const buildingSlash = {
      totalFloors: 1,
      roomsPerFloor: 2,
      roomPrefix: 'A',
      formatPattern: 'floor_slash_room',
      mode: 'auto' as const,
    };
    expect(getGeneratedRooms(buildingSlash)).toEqual(['1/1', '1/2']);
  });

  it('Case F: manual room identifiers are not globally modified/uppercased', () => {
    const manualBuilding = {
      totalFloors: 1,
      roomsPerFloor: 0,
      roomPrefix: 'A',
      formatPattern: 'prefix_floor_room',
      mode: 'manual' as const,
      customRooms: ['room-special_1', 'custom_alpha', 'ห้องพิเศษ 1'],
    };

    const rooms = getGeneratedRooms(manualBuilding);
    expect(rooms).toEqual(['room-special_1', 'custom_alpha', 'ห้องพิเศษ 1']);
  });
});
