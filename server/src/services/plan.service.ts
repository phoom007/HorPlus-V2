import { IPlanRepository, PlatformPlanEntity } from '../db/repositories/plan.repository.js';

export class PlanService {
  private planRepo: IPlanRepository;

  constructor(planRepo: IPlanRepository) {
    this.planRepo = planRepo;
  }

  public async getActivePlans(): Promise<PlatformPlanEntity[]> {
    return this.planRepo.findAllActive();
  }

  public async getPlanByCode(code: string): Promise<PlatformPlanEntity | null> {
    if (!code) return null;
    return this.planRepo.findByCode(code);
  }

  public async getPlanById(id: string): Promise<PlatformPlanEntity | null> {
    if (!id) return null;
    return this.planRepo.findById(id);
  }
}
