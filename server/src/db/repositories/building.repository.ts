export interface BuildingEntity {
  id: string;
  dormitoryId: string;
  name: string;
  code?: string | null;
  floorCount: number;
  description?: string | null;
  status: string; // active, inactive, archived
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface CreateBuildingData {
  id?: string;
  name: string;
  code?: string | null;
  floorCount: number;
  description?: string | null;
  status?: string;
  displayOrder?: number;
}

export interface BuildingFilterQuery {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface IBuildingRepository {
  findById(id: string, dormitoryId?: string): Promise<BuildingEntity | null>;
  findByName(dormitoryId: string, name: string): Promise<BuildingEntity | null>;
  findByCode(dormitoryId: string, code: string): Promise<BuildingEntity | null>;
  findAll(dormitoryId: string, filter?: BuildingFilterQuery): Promise<{ items: BuildingEntity[]; total: number }>;
  create(dormitoryId: string, data: CreateBuildingData): Promise<BuildingEntity>;
  update(id: string, dormitoryId: string, data: Partial<BuildingEntity>): Promise<BuildingEntity | null>;
  archive(id: string, dormitoryId: string): Promise<BuildingEntity | null>;
}

export class InMemoryBuildingRepository implements IBuildingRepository {
  private buildings: Map<string, BuildingEntity> = new Map();

  public async findById(id: string, dormitoryId?: string): Promise<BuildingEntity | null> {
    const building = this.buildings.get(id);
    if (!building || building.status === 'deleted' || building.deletedAt) return null;
    if (dormitoryId && building.dormitoryId !== dormitoryId) return null;
    return building;
  }

  public async findByName(dormitoryId: string, name: string): Promise<BuildingEntity | null> {
    for (const b of this.buildings.values()) {
      if (b.dormitoryId === dormitoryId && !b.deletedAt && b.name.toLowerCase() === name.toLowerCase()) {
        return b;
      }
    }
    return null;
  }

  public async findByCode(dormitoryId: string, code: string): Promise<BuildingEntity | null> {
    for (const b of this.buildings.values()) {
      if (b.dormitoryId === dormitoryId && !b.deletedAt && b.code && b.code.toLowerCase() === code.toLowerCase()) {
        return b;
      }
    }
    return null;
  }

  public async findAll(dormitoryId: string, filter: BuildingFilterQuery = {}): Promise<{ items: BuildingEntity[]; total: number }> {
    let list = Array.from(this.buildings.values()).filter(
      (b) => b.dormitoryId === dormitoryId && !b.deletedAt && b.status !== 'archived'
    );

    if (filter.status) {
      list = list.filter((b) => b.status === filter.status);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (b) => b.name.toLowerCase().includes(q) || (b.code && b.code.toLowerCase().includes(q))
      );
    }

    // Sort
    const sortBy = filter.sortBy || 'displayOrder';
    const direction = filter.sortDirection === 'desc' ? -1 : 1;
    list.sort((a: any, b: any) => {
      const valA = a[sortBy] ?? '';
      const valB = b[sortBy] ?? '';
      if (valA < valB) return -1 * direction;
      if (valA > valB) return 1 * direction;
      return 0;
    });

    const total = list.length;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);

    return { items, total };
  }

  public async create(dormitoryId: string, data: CreateBuildingData): Promise<BuildingEntity> {
    const now = new Date();
    const id = data.id || `bldg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const building: BuildingEntity = {
      id,
      dormitoryId,
      name: data.name,
      code: data.code || null,
      floorCount: data.floorCount || 1,
      description: data.description || null,
      status: data.status || 'active',
      displayOrder: data.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.buildings.set(id, building);
    return building;
  }

  public async update(id: string, dormitoryId: string, data: Partial<BuildingEntity>): Promise<BuildingEntity | null> {
    const b = await this.findById(id, dormitoryId);
    if (!b) return null;
    const updated: BuildingEntity = {
      ...b,
      ...data,
      updatedAt: new Date(),
    };
    this.buildings.set(id, updated);
    return updated;
  }

  public async archive(id: string, dormitoryId: string): Promise<BuildingEntity | null> {
    return this.update(id, dormitoryId, { status: 'archived', deletedAt: new Date() });
  }
}
