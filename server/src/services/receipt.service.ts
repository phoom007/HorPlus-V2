import { InMemoryReceiptRepository, ReceiptEntity, ReceiptItemEntity } from '../db/repositories/receipt.repository.js';
import { InMemoryBillRepository } from '../db/repositories/bill.repository.js';
import { InMemoryDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { InMemoryTenantRepository } from '../db/repositories/tenant.repository.js';
import { InMemoryRoomRepository } from '../db/repositories/room.repository.js';
import { PaymentEntity } from '../db/repositories/payment.repository.js';

export class ReceiptGenerationService {
  private receiptRepo: InMemoryReceiptRepository;
  private billRepo: InMemoryBillRepository;
  private dormitoryRepo: InMemoryDormitoryRepository;
  private tenantRepo: InMemoryTenantRepository;
  private roomRepo: InMemoryRoomRepository;

  constructor(
    receiptRepo: InMemoryReceiptRepository,
    billRepo: InMemoryBillRepository,
    dormitoryRepo: InMemoryDormitoryRepository,
    tenantRepo: InMemoryTenantRepository,
    roomRepo: InMemoryRoomRepository
  ) {
    this.receiptRepo = receiptRepo;
    this.billRepo = billRepo;
    this.dormitoryRepo = dormitoryRepo;
    this.tenantRepo = tenantRepo;
    this.roomRepo = roomRepo;
  }

  public async generateReceiptForPayment(
    dormitoryId: string,
    payment: PaymentEntity,
    actorUserId?: string | null
  ): Promise<{ receipt: ReceiptEntity; items: ReceiptItemEntity[] }> {
    // 1. Check idempotency: If receipt exists for this paymentId, return it
    const existing = await this.receiptRepo.findByPaymentId(dormitoryId, payment.id);
    if (existing) {
      const items = await this.receiptRepo.getItemsByReceiptId(dormitoryId, existing.id);
      return { receipt: existing, items };
    }

    // 2. Load Bill
    const bill = await this.billRepo.findById(dormitoryId, payment.billId);
    if (!bill) {
      throw new Error('RESOURCE_NOT_FOUND: Bill not found for receipt generation');
    }

    // 3. Load Dormitory, Tenant, Room for Snapshots
    const dormitory = await this.dormitoryRepo.findById(dormitoryId);
    const tenant = await this.tenantRepo.findById(dormitoryId, payment.tenantId);
    const room = await this.roomRepo.findById(dormitoryId, payment.roomId);

    const dormitoryNameSnapshot = dormitory?.name || 'หอพัก';
    const dormitoryAddressSnapshot = dormitory?.address || null;
    const dormitoryPhoneSnapshot = dormitory?.phone || null;
    const tenantNameSnapshot = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : 'ผู้เช่า';
    const roomNumberSnapshot = room?.roomNumber || 'ห้องพัก';
    const billNumberSnapshot = bill.billNumber;

    // 4. Load Bill Items
    const billItems = await this.billRepo.getBillItems(dormitoryId, bill.id);

    const receiptItemsData = billItems.map((bi) => ({
      billItemId: bi.id,
      type: bi.type,
      description: bi.description,
      quantity: bi.quantity,
      unitPrice: bi.unitPrice,
      amount: bi.amount,
      displayOrder: bi.displayOrder,
    }));

    // 5. Create Receipt in Repository
    const receipt = await this.receiptRepo.create(
      dormitoryId,
      {
        paymentId: payment.id,
        billId: bill.id,
        contractId: payment.contractId,
        roomId: payment.roomId,
        tenantId: payment.tenantId,
        paidAt: payment.paidAt,
        paymentMethod: payment.method,
        subtotal: bill.subtotal,
        discountAmount: bill.discountAmount,
        fineAmount: bill.fineAmount,
        totalAmount: payment.amount,
        currency: payment.currency,
        receivedByUserId: actorUserId || payment.receivedByUserId || null,
        dormitoryNameSnapshot,
        dormitoryAddressSnapshot,
        dormitoryPhoneSnapshot,
        tenantNameSnapshot,
        roomNumberSnapshot,
        billNumberSnapshot,
        note: payment.note,
      },
      receiptItemsData
    );

    const items = await this.receiptRepo.getItemsByReceiptId(dormitoryId, receipt.id);
    return { receipt, items };
  }

  public async getReceiptDetails(
    dormitoryId: string,
    receiptId: string
  ): Promise<{ receipt: ReceiptEntity; items: ReceiptItemEntity[] } | null> {
    const receipt = await this.receiptRepo.findById(dormitoryId, receiptId);
    if (!receipt) return null;
    const items = await this.receiptRepo.getItemsByReceiptId(dormitoryId, receipt.id);
    return { receipt, items };
  }

  public async getReceiptByPaymentId(
    dormitoryId: string,
    paymentId: string
  ): Promise<{ receipt: ReceiptEntity; items: ReceiptItemEntity[] } | null> {
    const receipt = await this.receiptRepo.findByPaymentId(dormitoryId, paymentId);
    if (!receipt) return null;
    const items = await this.receiptRepo.getItemsByReceiptId(dormitoryId, receipt.id);
    return { receipt, items };
  }

  public async getReceiptByBillId(
    dormitoryId: string,
    billId: string
  ): Promise<{ receipt: ReceiptEntity; items: ReceiptItemEntity[] } | null> {
    const receipt = await this.receiptRepo.findByBillId(dormitoryId, billId);
    if (!receipt) return null;
    const items = await this.receiptRepo.getItemsByReceiptId(dormitoryId, receipt.id);
    return { receipt, items };
  }

  public async listReceipts(dormitoryId: string, filters: any = {}): Promise<{ items: ReceiptEntity[]; total: number }> {
    return this.receiptRepo.findAll(dormitoryId, filters);
  }
}
