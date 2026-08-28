/**
 * @license Apache-2.0
 * Concise Room Mutation Error UX Mapper
 *
 * Maps authoritative error codes to concise, user-friendly Thai error messages.
 */

export function getOwnerRoomMutationErrorMessage(error: any): string {
  if (!error) {
    return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่';
  }

  // Extract error code from various response structures (AppError, axios, fetch response, DataResult, details)
  const code = error?.code ||
    error?.response?.data?.error?.code ||
    error?.error?.code ||
    error?.details?.code ||
    error?.details?.error?.code ||
    error?.error?.details?.code ||
    (typeof error?.message === 'string' && error.message.includes('ROOM_NUMBER_ALREADY_EXISTS') ? 'ROOM_NUMBER_ALREADY_EXISTS' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('BUILDING_NOT_FOUND') ? 'BUILDING_NOT_FOUND' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('ROOM_LIMIT_REACHED') ? 'ROOM_LIMIT_REACHED' : undefined) ||
    (typeof error?.message === 'string' && error.message.includes('FORBIDDEN') ? 'FORBIDDEN' : undefined) ||
    '';

  switch (code) {
    case 'ROOM_NUMBER_ALREADY_EXISTS':
      return 'เลขห้องนี้มีอยู่แล้ว';
    case 'BUILDING_NOT_FOUND':
      return 'ไม่พบอาคารที่เลือก';
    case 'ROOM_LIMIT_REACHED':
      return 'จำนวนห้องถึงขีดจำกัดแพ็กเกจแล้ว';
    case 'SUBSCRIPTION_READ_ONLY':
      return 'แพ็กเกจปัจจุบันไม่อนุญาตให้แก้ไขข้อมูล';
    case 'FORBIDDEN':
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
      if (typeof error?.message === 'string' && /[\u0E00-\u0E7F]/.test(error.message) && !error.message.includes('Error:') && !error.message.includes('Prisma') && !error.message.includes('at ')) {
        return error.message;
      }
      return 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่';
  }
}
