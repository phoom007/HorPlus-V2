/**
 * @license Apache-2.0
 * Concise Room Mutation Error UX Mapper & Domain Classifier
 *
 * Maps authoritative error codes to concise, user-friendly Thai error messages.
 * Prioritizes nested specific server domain codes over coarse HTTP wrapper codes.
 */

export function getOwnerRoomMutationDomainCode(error: any): string {
  if (!error) return '';

  const nestedCode =
    error?.details?.error?.code ||
    error?.details?.code ||
    error?.response?.data?.error?.code ||
    error?.error?.details?.code ||
    error?.error?.code;

  if (nestedCode && nestedCode !== 'CONFLICT' && nestedCode !== 'INTERNAL_ERROR' && nestedCode !== 'BAD_REQUEST' && nestedCode !== 'NOT_FOUND') {
    return nestedCode;
  }

  if (error?.code && error.code !== 'CONFLICT' && error.code !== 'INTERNAL_ERROR' && error.code !== 'BAD_REQUEST' && error.code !== 'NOT_FOUND') {
    return error.code;
  }

  if (typeof error?.message === 'string') {
    if (error.message.includes('ROOM_NUMBER_ALREADY_EXISTS')) return 'ROOM_NUMBER_ALREADY_EXISTS';
    if (error.message.includes('BUILDING_NOT_FOUND')) return 'BUILDING_NOT_FOUND';
    if (error.message.includes('OPERATIONAL_BILLING_CYCLE_UNAVAILABLE')) return 'OPERATIONAL_BILLING_CYCLE_UNAVAILABLE';
    if (error.message.includes('VERSION_CONFLICT')) return 'VERSION_CONFLICT';
    if (error.message.includes('ROOM_LIMIT_REACHED') || error.message.includes('ROOM_LIMIT_EXCEEDED')) return 'ROOM_LIMIT_REACHED';
    if (error.message.includes('ACTIVE_AGREEMENT')) return 'ACTIVE_AGREEMENT_GUARD';
  }

  return nestedCode || error?.code || '';
}

export function getOwnerRoomMutationErrorMessage(error: any): string {
  if (!error) {
    return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่';
  }

  const code = getOwnerRoomMutationDomainCode(error);

  switch (code) {
    case 'ROOM_NUMBER_ALREADY_EXISTS':
      return 'เลขห้องนี้มีอยู่แล้ว';
    case 'BUILDING_NOT_FOUND':
      return 'ไม่พบอาคารที่เลือก';
    case 'OPERATIONAL_BILLING_CYCLE_UNAVAILABLE':
      return 'ยังไม่พบงวดดำเนินงานสำหรับการเปลี่ยนสถานะห้อง';
    case 'VERSION_CONFLICT':
      return 'ข้อมูลห้องถูกแก้ไขจากอุปกรณ์อื่น กรุณาโหลดข้อมูลล่าสุด';
    case 'CONFLICT':
      return 'ข้อมูลมีความขัดแย้งหรือซ้ำซ้อนกับในระบบ กรุณาตรวจสอบอีกครั้ง';
    case 'ACTIVE_AGREEMENT_EXISTS':
    case 'ACTIVE_AGREEMENT_GUARD':
      return 'ไม่สามารถปิดปรับปรุงห้องพักที่มีผู้เช่าอยู่ได้';
    case 'ROOM_LIMIT_REACHED':
    case 'ROOM_LIMIT_EXCEEDED':
      return 'จำนวนห้องถึงขีดจำกัดแพ็กเกจแล้ว';
    case 'SUBSCRIPTION_READ_ONLY':
      return 'แพ็กเกจปัจจุบันไม่อนุญาตให้แก้ไขข้อมูล';
    case 'FORBIDDEN':
    case 'DORMITORY_ACCESS_DENIED':
      return 'บัญชีนี้ไม่มีสิทธิ์จัดการห้องพัก';
    case 'CSRF_INVALID':
    case 'UNAUTHORIZED':
      return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
    case 'VALIDATION_ERROR':
      return 'กรุณาตรวจสอบข้อมูลห้องพัก';
    case 'DEPENDENCY_UNAVAILABLE':
      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่';
    default:
      // If error.message is already a clean Thai message without stack/SQL, allow it
      if (
        typeof error?.message === 'string' &&
        /[฀-๿]/.test(error.message) &&
        !error.message.includes('Error:') &&
        !error.message.includes('Prisma') &&
        !error.message.includes('at ')
      ) {
        return error.message;
      }
      return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่';
  }
}
