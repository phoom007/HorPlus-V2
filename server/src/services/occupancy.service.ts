import { IRoomRepository } from '../db/repositories/room.repository.js';
import { IBuildingRepository } from '../db/repositories/building.repository.js';
import { ITenantRepository } from '../db/repositories/tenant.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';

export interface OccupancySummary {
  totalRooms: number;
  occupiedRooms: number;
  vacantRooms: number;
  reservedRooms: number;
  maintenanceRooms: number;
  occupancyRate: number; // percentage e.g. 85.5
  totalTenants: number;
  activeContracts: number;
  expiringContracts: number;
  buildingsSummary: Array<{
    buildingId: string;
    buildingName: string;
    totalRooms: number;
    occupiedRooms: number;
    vacantRooms: number;
    occupancyRate: number;
  }>;
}

export interface FloorPlanView {
  buildingId: string;
  buildingName: string;
  floors: Array<{
    floorNumber: number;
    rooms: Array<{
      id: string;
      roomNumber: string;
      roomType: string;
      status: string;
      monthlyRent: string;
      currentTenantName?: string | null;
      contractEndDate?: Date | null;
    }>;
  }>;
}

export class OccupancyService {
  constructor(
    private roomRepo: IRoomRepository,
    private buildingRepo: IBuildingRepository,
    private tenantRepo: ITenantRepository,
    private contractRepo: IContractRepository
  ) {}

  public async getOccupancySummary(dormitoryId: string): Promise<OccupancySummary> {
    const { items: rooms } = await this.roomRepo.findAll(dormitoryId, { pageSize: 1000 });
    const { items: buildings } = await this.buildingRepo.findAll(dormitoryId, { pageSize: 100 });
    const totalTenants = await this.tenantRepo.countActiveByDormitory(dormitoryId);
    const activeContracts = await this.contractRepo.countActiveByDormitory(dormitoryId);
    const expiringContracts = await this.contractRepo.countExpiringByDormitory(dormitoryId, 30);

    let occupiedCount = 0;
    let vacantCount = 0;
    let reservedCount = 0;
    let maintenanceCount = 0;

    for (const r of rooms) {
      if (r.status === 'occupied') occupiedCount++;
      else if (r.status === 'vacant') vacantCount++;
      else if (r.status === 'reserved') reservedCount++;
      else if (r.status === 'maintenance') maintenanceCount++;
    }

    const totalRooms = rooms.length;
    const occupancyRate = totalRooms > 0 ? Number(((occupiedCount / totalRooms) * 100).toFixed(1)) : 0;

    const buildingsSummary = [];
    for (const b of buildings) {
      const bRooms = rooms.filter((r) => r.buildingId === b.id);
      const bTotal = bRooms.length;
      const bOccupied = bRooms.filter((r) => r.status === 'occupied').length;
      const bVacant = bRooms.filter((r) => r.status === 'vacant').length;
      const bRate = bTotal > 0 ? Number(((bOccupied / bTotal) * 100).toFixed(1)) : 0;

      buildingsSummary.push({
        buildingId: b.id,
        buildingName: b.name,
        totalRooms: bTotal,
        occupiedRooms: bOccupied,
        vacantRooms: bVacant,
        occupancyRate: bRate,
      });
    }

    return {
      totalRooms,
      occupiedRooms: occupiedCount,
      vacantRooms: vacantCount,
      reservedRooms: reservedCount,
      maintenanceRooms: maintenanceCount,
      occupancyRate,
      totalTenants,
      activeContracts,
      expiringContracts,
      buildingsSummary,
    };
  }

  public async getFloorPlanView(dormitoryId: string, buildingId?: string): Promise<FloorPlanView[]> {
    const { items: buildings } = await this.buildingRepo.findAll(dormitoryId, { pageSize: 100 });
    const { items: rooms } = await this.roomRepo.findAll(dormitoryId, { buildingId, pageSize: 1000 });

    const targetBuildings = buildingId ? buildings.filter((b) => b.id === buildingId) : buildings;
    const result: FloorPlanView[] = [];

    for (const b of targetBuildings) {
      const bRooms = rooms.filter((r) => r.buildingId === b.id);
      const floorMap = new Map<number, any[]>();

      for (const r of bRooms) {
        if (!floorMap.has(r.floor)) {
          floorMap.set(r.floor, []);
        }

        let tenantName: string | null = null;
        let contractEndDate: Date | null = null;

        if (r.currentTenantId) {
          const tenant = await this.tenantRepo.findById(r.currentTenantId, dormitoryId);
          if (tenant) tenantName = tenant.displayName;
        }

        if (r.currentContractId) {
          const contract = await this.contractRepo.findById(r.currentContractId, dormitoryId);
          if (contract) contractEndDate = contract.endDate;
        }

        floorMap.get(r.floor)!.push({
          id: r.id,
          roomNumber: r.roomNumber,
          roomType: r.roomType,
          status: r.status,
          monthlyRent: r.monthlyRent,
          currentTenantName: tenantName,
          contractEndDate,
        });
      }

      const floors = Array.from(floorMap.entries())
        .sort(([fA], [fB]) => fA - fB)
        .map(([floorNumber, fRooms]) => ({
          floorNumber,
          rooms: fRooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber)),
        }));

      result.push({
        buildingId: b.id,
        buildingName: b.name,
        floors,
      });
    }

    return result;
  }
}
