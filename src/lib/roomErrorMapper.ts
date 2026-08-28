/**
 * @license Apache-2.0
 * Concise Room Mutation Error UX Mapper
 *
 * Maps authoritative error codes to concise, user-friendly Thai error messages.
 * Prioritizes nested specific server domain codes over coarse HTTP wrapper codes.
 */

export function getOwnerRoomMutationErrorMessage(error: any): string {
  if (!error) {
    return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่';
  }

  // Extract specific domain code prioritizing nested authoritative server code over coarse wrappers
  const code =
    error?.details?.error?.code ||
    error?.details?.code ||
    error?.response?.data?.error?.code ||
    error?.error?.details?.code ||
    error?.error?.code ||
    error?.code ||
    (typeof error?.message === 'string' && error.message.includes('ROOM_NUMBER_ALREADY_EXISTS') ? 'ROOM_NUMBER_ALREADY_EXISTS' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('BUILDING_NOT_FOUND') ? 'BUILDING_NOT_FOUND' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('OPERATIONAL_BILLING_CYCLE_UNAVAILABLE') ? 'OPERATIONAL_BILLING_CYCLE_UNAVAILABLE' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('VERSION_CONFLICT') ? 'VERSION_CONFLICT' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('ROOM_LIMIT_REACHED') ? 'ROOM_LIMIT_REACHED' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('FORBIDDEN') ? 'FORBIDDEN' : undefined) ||
    '';

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
