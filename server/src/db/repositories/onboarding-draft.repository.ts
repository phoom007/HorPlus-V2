export interface OnboardingDraftEntity {
  id: string;
  userId: string;
  version: number;
  currentStep: string;
  payload: any;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveDraftData {
  userId: string;
  currentStep: string;
  payload: any;
  ttlSeconds?: number;
}

export interface IOnboardingDraftRepository {
  findByUserId(userId: string): Promise<OnboardingDraftEntity | null>;
  saveDraft(data: SaveDraftData): Promise<OnboardingDraftEntity>;
  deleteByUserId(userId: string): Promise<void>;
}

export class InMemoryOnboardingDraftRepository implements IOnboardingDraftRepository {
  private drafts: Map<string, OnboardingDraftEntity> = new Map();

  public async findByUserId(userId: string): Promise<OnboardingDraftEntity | null> {
    const draft = this.drafts.get(userId);
    if (!draft) return null;
    if (draft.expiresAt < new Date()) {
      this.drafts.delete(userId);
      return null;
    }
    return draft;
  }

  public async saveDraft(data: SaveDraftData): Promise<OnboardingDraftEntity> {
    const now = new Date();
    const ttlMs = (data.ttlSeconds || 7 * 24 * 3600) * 1000; // default 7 days
    const expiresAt = new Date(now.getTime() + ttlMs);

    const existing = await this.findByUserId(data.userId);

    const draft: OnboardingDraftEntity = {
      id: existing ? existing.id : `draft-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: data.userId,
      version: existing ? existing.version + 1 : 1,
      currentStep: data.currentStep || 'dormitory',
      payload: data.payload || {},
      expiresAt,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.drafts.set(data.userId, draft);
    return draft;
  }

  public async deleteByUserId(userId: string): Promise<void> {
    this.drafts.delete(userId);
  }
}
