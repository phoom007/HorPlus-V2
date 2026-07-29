/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dormitory, Building } from '../../types';
import { getStored, setStored } from '../../data/mockData';

const DORMITORIES_KEY = 'dormitories';
const DORMITORY_KEY = 'dormitory';
const BUILDINGS_KEY = 'buildings';

export const initialDormitoriesList: Dormitory[] = [
  {
    id: 'dorm-01',
    name: 'หอพัก HorPlus แกรนด์เรสซิเดนซ์',
    address: '99/1 ซอยฉลองกรุง 1 ถ.ฉลองกรุง แขวงลาดกระบัง เขตลาดกระบัง กรุงเทพมหานคร 10520',
    phone: '081-234-5678',
    taxId: '0105562000123',
    promptPayType: 'phone',
    promptPayNumber: '0812345678',
    promptPayName: 'บริษัท HorPlus พร็อพเพอร์ตี้ จำกัด',
    bankName: 'ธนาคารกสิกรไทย',
    bankAccountNumber: '123-4-56789-0',
    billStyle: 'combined',
    billingDay: 25,
    dueDay: 5,
    lateFeeDaily: 100,
    waterUnitRate: 18,
    electricUnitRate: 7,
    waterMinCharge: 100,
    electricMinCharge: 100,
    waterServiceFee: 20,
    electricServiceFee: 20,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'dorm-02',
    name: 'HorPlus วิลล์ บูทีคอพาร์ตเมนต์',
    address: '45/8 ถ.พญาไท แขวงถนนพญาไท เขตราชเทวี กรุงเทพมหานคร 10400',
    phone: '089-876-5432',
    taxId: '0105562000999',
    promptPayType: 'phone',
    promptPayNumber: '0898765432',
    promptPayName: 'หอพัก HorPlus วิลล์ บูทีค',
    bankName: 'ธนาคารไทยพาณิชย์',
    bankAccountNumber: '987-6-54321-0',
    billStyle: 'combined',
    billingDay: 25,
    dueDay: 5,
    lateFeeDaily: 100,
    waterUnitRate: 20,
    electricUnitRate: 8,
    waterMinCharge: 120,
    electricMinCharge: 120,
    waterServiceFee: 30,
    electricServiceFee: 30,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z'
  }
];

export const dormitoryRepository = {
  getAll: (): Dormitory[] => {
    return getStored<Dormitory[]>(DORMITORIES_KEY, initialDormitoriesList);
  },

  getById: (id: string): Dormitory | undefined => {
    const list = dormitoryRepository.getAll();
    return list.find(d => d.id === id);
  },

  getCurrent: (): Dormitory => {
    return getStored<Dormitory>(DORMITORY_KEY, initialDormitoriesList[0]);
  },

  saveCurrent: (dorm: Dormitory): void => {
    setStored(DORMITORY_KEY, dorm);
    const list = dormitoryRepository.getAll();
    const idx = list.findIndex(d => d.id === dorm.id);
    if (idx >= 0) {
      list[idx] = dorm;
    } else {
      list.push(dorm);
    }
    setStored(DORMITORIES_KEY, list);
  },

  switchDormitory: (dormId: string): Dormitory => {
    const target = dormitoryRepository.getById(dormId) || initialDormitoriesList[0];
    setStored(DORMITORY_KEY, target);
    return target;
  },

  getBuildings: (): Building[] => {
    return getStored<Building[]>(BUILDINGS_KEY, [
      { id: 'bld-a', name: 'อาคาร A', floorsCount: 4, description: 'อาคารหลัก 12 ห้อง', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'bld-b', name: 'อาคาร B', floorsCount: 4, description: 'อาคารขวา 12 ห้อง', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
    ]);
  },

  saveBuildings: (buildings: Building[]): void => {
    setStored(BUILDINGS_KEY, buildings);
  },

  addBuilding: (building: Building): void => {
    const list = dormitoryRepository.getBuildings();
    list.push(building);
    dormitoryRepository.saveBuildings(list);
  },

  updateBuilding: (building: Building): void => {
    const list = dormitoryRepository.getBuildings();
    const idx = list.findIndex(b => b.id === building.id);
    if (idx >= 0) {
      list[idx] = building;
      dormitoryRepository.saveBuildings(list);
    }
  },

  deleteBuilding: (buildingId: string): { success: boolean; message: string } => {
    const list = dormitoryRepository.getBuildings();
    const idx = list.findIndex(b => b.id === buildingId);
    if (idx >= 0) {
      list.splice(idx, 1);
      dormitoryRepository.saveBuildings(list);
      return { success: true, message: 'ลบอาคารสำเร็จ' };
    }
    return { success: false, message: 'ไม่พบอาคาร' };
  }
};
