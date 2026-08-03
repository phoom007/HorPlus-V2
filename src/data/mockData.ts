/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dormitory,
  Building,
  Room,
  RoomStatus,
  Tenant,
  Contract,
  ContractStatus,
  Bill,
  BillItem,
  BillStatus,
  MaintenanceRequest,
  Announcement,
  Role,
  User,
  AuditLog,
  Notification,
  CycleRates
} from '../types';

// Seed Roles & Permissions
export const initialRoles: Role[] = [
  {
    id: 'role-owner',
    name: 'เจ้าของระบบ',
    description: 'สิทธิ์สูงสุดในการเข้าถึงทุกระบบและจัดการตั้งค่าบัญชีและการเงิน',
    permissions: {
      dashboard: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      rooms: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      tenants: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      contracts: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      meters: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      billing: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      payments: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      maintenance: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      announcements: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      reports: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      users: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true },
      settings: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: true, manageUsers: true }
    },
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'role-manager',
    name: 'ผู้จัดการ',
    description: 'จัดการอาคาร ห้องพัก ผู้เช่า บิล สัญญาเช่า และรายงานต่าง ๆ',
    permissions: {
      dashboard: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      rooms: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      tenants: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      contracts: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      meters: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      billing: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      payments: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      maintenance: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      announcements: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      reports: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: true, print: true, manageSettings: false, manageUsers: false },
      users: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      settings: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false }
    },
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'role-finance',
    name: 'การเงิน',
    description: 'เน้นจัดการออกบิล ตรวจสอบและอนุมัติการชำระเงิน และรายงานบัญชีการเงิน',
    permissions: {
      dashboard: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      rooms: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      tenants: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      contracts: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      meters: { view: true, create: true, edit: true, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      billing: { view: true, create: true, edit: true, delete: true, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      payments: { view: true, create: true, edit: true, delete: false, approve: true, reject: true, export: true, print: true, manageSettings: false, manageUsers: false },
      maintenance: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      announcements: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      reports: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: true, print: true, manageSettings: false, manageUsers: false },
      users: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      settings: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false }
    },
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'role-staff',
    name: 'เจ้าหน้าที่หอ',
    description: 'ดูแลความสะดวก ทักทายผู้เช่า รับแจ้งซ่อม และบันทึกมิเตอร์น้ำไฟ',
    permissions: {
      dashboard: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      rooms: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      tenants: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      contracts: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      meters: { view: true, create: true, edit: true, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      billing: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      payments: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      maintenance: { view: true, create: true, edit: true, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      announcements: { view: true, create: true, edit: true, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      reports: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      users: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      settings: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false }
    },
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'role-tech',
    name: 'ช่างซ่อม',
    description: 'เข้าดูงานแจ้งซ่อมที่ได้รับมอบหมาย อัปเดตสถานะการปฏิบัติงานและเบิกอะไหล่',
    permissions: {
      dashboard: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      rooms: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      tenants: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      contracts: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      meters: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      billing: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      payments: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      maintenance: { view: true, create: false, edit: true, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      announcements: { view: true, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      reports: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      users: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false },
      settings: { view: false, create: false, edit: false, delete: false, approve: false, reject: false, export: false, print: false, manageSettings: false, manageUsers: false }
    },
    createdAt: '2026-01-01T00:00:00Z'
  }
];

// Initial Dormitory Settings
export const initialDormitory: Dormitory = {
  id: 'dorm-1',
  name: 'หอพักฮอร์สมาร์ท (HorPlus Dormitory)',
  address: 'เลขที่ 88/1 ถนนสุเทพ ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200',
  phone: '081-234-5678',
  taxId: '1234567890123',
  promptPayType: 'phone',
  promptPayNumber: '0812345678',
  promptPayName: 'นายสมศักดิ์ รักดี',
  bankName: 'กรุงไทย (Krungthai)',
  bankAccountNumber: '123-4-56789-0',
  billStyle: 'combined', // Combined bill
  billingDay: 25,
  dueDay: 5,
  lateFeeDaily: 100,
  lateFeeType: 'per_day',
  parkingFee: 100,
  parkingFeeMode: 'room',
  waterUnitRate: 18,
  electricUnitRate: 7,
  waterMinCharge: 50,
  electricMinCharge: 0,
  waterBillingMode: 'unit',
  electricBillingMode: 'unit',
  commonFee: 200,
  commonFeeMode: 'room',
  internetFee: 150,
  internetFeeMode: 'room',
  petPolicy: {
    allowed: 'conditional',
    allowedTypes: ['small_dog', 'cat', 'caged_birds', 'aquarium']
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-07-14T02:00:00Z'
};

// Initial Buildings
export const initialBuildings: Building[] = [
  { id: 'bld-a', name: 'อาคาร A (วิวเขา)', floorsCount: 4, description: 'อาคารทิศตะวันตก วิวดอยสุเทพ เงียบสงบสำหรับคนทำงาน', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'bld-b', name: 'อาคาร B (สระว่ายน้ำ)', floorsCount: 4, description: 'อาคารทิศตะวันออก ติดสระว่ายน้ำ และฟิตเนสส่วนกลาง', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
];

// Initial Staff Users
export const initialUsers: User[] = [
  { id: 'user-owner', name: 'สมศักดิ์ รักดี', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150', roleId: 'role-owner', roleName: 'เจ้าของหอพัก', email: 'somsak.owner@HorPlus.com', description: 'เจ้าของหอพักและผู้ลงทุนหลัก มีสิทธิ์ครอบคลุมการบริหาร จัดการเรื่องการเงินและนโยบายทั้งหมด', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'user-manager', name: 'ดวงใจ นวลแก้ว', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150', roleId: 'role-manager', roleName: 'ผู้จัดการ', email: 'duangjai.mgr@HorPlus.com', description: 'ผู้จัดการนิติบุคคล ดูแลงานทั่วไป สัญญาเช่า ออกบิล ตรวจจับสลิปค่าน้ำค่าไฟ และประสานงานผู้เช่า', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'user-staff', name: 'สมชาย ช่างประจำหอ', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', roleId: 'role-staff', roleName: 'ช่าง/แม่บ้าน', email: 'somchai.staff@HorPlus.com', description: 'ช่างบำรุงประจำอาคารและแม่บ้าน ดูแลรับเรื่องแจ้งซ่อมบำรุง ปรับปรุงสถานะ และจดมิเตอร์บันทึกน้ำไฟ', createdAt: '2026-01-01T00:00:00Z' }
];

// Initial 21 Tenant Data
export const initialTenants: Tenant[] = [
  {
    id: 'tenant-1',
    name: 'จิรายุ สมบัติงาม',
    phone: '089-111-2233',
    email: 'jirayu.s@gmail.com',
    citizenId: '1509901234567',
    idCardPhotoMock: 'MOCK_ID_CARD_BASE64',
    coOccupants: [],
    emergencyContact: { name: 'วิภาดา สมบัติงาม', relationship: 'มารดา', phone: '089-111-2234' },
    vehicle: { type: 'motorcycle', licensePlate: 'กข 123 เชียงใหม่', brand: 'Honda Wave' },
    pet: { hasPet: false },
    rentalHistory: ['101'],
    status: 'active',
    createdAt: '2026-01-10T10:00:00Z',
    updatedAt: '2026-01-10T10:00:00Z'
  },
  {
    id: 'tenant-2',
    name: 'พรพิไล อนันตศิลป์',
    phone: '085-444-5566',
    email: 'pornpilai.a@gmail.com',
    citizenId: '3509901234567',
    idCardPhotoMock: 'MOCK_ID_CARD_BASE64',
    coOccupants: [
      { id: 'co-1', name: 'กันตพัฒน์ อนันตศิลป์', phone: '085-444-5567', citizenId: '3509901234568' }
    ],
    emergencyContact: { name: 'สุกิจ อนันตศิลป์', relationship: 'บิดา', phone: '085-444-5560' },
    vehicle: { type: 'car', licensePlate: 'ชร 9999 กรุงเทพ', brand: 'Toyota Yaris' },
    pet: { hasPet: true, type: 'สุนัขพันธุ์เล็ก', name: 'มัฟฟิน' },
    rentalHistory: ['102'],
    status: 'active',
    createdAt: '2026-01-15T11:00:00Z',
    updatedAt: '2026-01-15T11:00:00Z'
  },
  {
    id: 'tenant-3',
    name: 'ธวัชชัย มีสุข',
    phone: '086-777-8899',
    email: 'thawatchai.m@gmail.com',
    citizenId: '5509901234567',
    idCardPhotoMock: 'MOCK_ID_CARD_BASE64',
    coOccupants: [],
    emergencyContact: { name: 'วิไล มีสุข', relationship: 'ภรรยา', phone: '086-777-8890' },
    vehicle: { type: 'car', licensePlate: 'นข 567 เชียงราย', brand: 'Mazda 2' },
    pet: { hasPet: false },
    rentalHistory: ['103'],
    status: 'active',
    createdAt: '2026-01-18T14:30:00Z',
    updatedAt: '2026-01-18T14:30:00Z'
  },
  { id: 'tenant-4', name: 'อภิสิทธิ์ แก้วประดิษฐ์', phone: '082-222-3333', email: 'apisit.k@gmail.com', citizenId: '1234567890124', coOccupants: [], emergencyContact: { name: 'นภา แก้วประดิษฐ์', relationship: 'แม่', phone: '082-222-3334' }, vehicle: { type: 'none', licensePlate: '' }, pet: { hasPet: false }, rentalHistory: ['104'], status: 'active', createdAt: '2026-01-20T08:00:00Z', updatedAt: '2026-01-20T08:00:00Z' },
  { id: 'tenant-5', name: 'มุทิตา วรศิลป์', phone: '083-333-4444', email: 'muthita.w@gmail.com', citizenId: '1234567890125', coOccupants: [], emergencyContact: { name: 'วาทิน วรศิลป์', relationship: 'พ่อ', phone: '083-333-4445' }, vehicle: { type: 'motorcycle', licensePlate: 'กก 888 เชียงใหม่' }, pet: { hasPet: false }, rentalHistory: ['201'], status: 'active', createdAt: '2026-02-01T08:00:00Z', updatedAt: '2026-02-01T08:00:00Z' },
  { id: 'tenant-6', name: 'พิชญ์ เจริญพร', phone: '084-444-5555', email: 'pitch.j@gmail.com', citizenId: '1234567890126', coOccupants: [], emergencyContact: { name: 'พงศ์ เจริญพร', relationship: 'พี่ชาย', phone: '084-444-5556' }, vehicle: { type: 'car', licensePlate: 'มค 1234 เชียงใหม่' }, pet: { hasPet: false }, rentalHistory: ['202'], status: 'active', createdAt: '2026-02-10T08:00:00Z', updatedAt: '2026-02-10T08:00:00Z' },
  { id: 'tenant-7', name: 'ศิริรัตน์ แสงทอง', phone: '085-555-6666', email: 'sirirat.s@gmail.com', citizenId: '1234567890127', coOccupants: [], emergencyContact: { name: 'นารี แสงทอง', relationship: 'แม่', phone: '085-555-6667' }, vehicle: { type: 'none', licensePlate: '' }, pet: { hasPet: false }, rentalHistory: ['203'], status: 'active', createdAt: '2026-02-15T08:00:00Z', updatedAt: '2026-02-15T08:00:00Z' },
  { id: 'tenant-8', name: 'ชลธิชา เจริญสุข', phone: '086-666-7777', email: 'chonthicha.c@gmail.com', citizenId: '1234567890128', coOccupants: [], emergencyContact: { name: 'วิรุฬ เจริญสุข', relationship: 'บิดา', phone: '086-666-7778' }, vehicle: { type: 'motorcycle', licensePlate: 'รร 777 ลำพูน' }, pet: { hasPet: false }, rentalHistory: ['204'], status: 'active', createdAt: '2026-02-20T08:00:00Z', updatedAt: '2026-02-20T08:00:00Z' },
  { id: 'tenant-9', name: 'วิทยา คงมั่น', phone: '087-777-8888', email: 'wittaya.k@gmail.com', citizenId: '1234567890129', coOccupants: [], emergencyContact: { name: 'เสกสรร คงมั่น', relationship: 'พี่ชาย', phone: '087-777-8889' }, vehicle: { type: 'car', licensePlate: 'รภ 4321 กรุงเทพ' }, pet: { hasPet: false }, rentalHistory: ['301'], status: 'active', createdAt: '2026-03-01T08:00:00Z', updatedAt: '2026-03-01T08:00:00Z' },
  { id: 'tenant-10', name: 'กนกวรรณ เพ็ญศรี', phone: '088-888-9999', email: 'kanokwan.p@gmail.com', citizenId: '1234567890130', coOccupants: [], emergencyContact: { name: 'วันทนา เพ็ญศรี', relationship: 'แม่', phone: '088-888-9990' }, vehicle: { type: 'none', licensePlate: '' }, pet: { hasPet: false }, rentalHistory: ['302'], status: 'active', createdAt: '2026-03-10T08:00:00Z', updatedAt: '2026-03-10T08:00:00Z' },
  { id: 'tenant-11', name: 'ณัฐพล แก้วกล้า', phone: '081-111-3333', email: 'nattaphol.k@gmail.com', citizenId: '1234567890131', coOccupants: [], emergencyContact: { name: 'เดชา แก้วกล้า', relationship: 'พ่อ', phone: '081-111-3334' }, vehicle: { type: 'car', licensePlate: 'กท 555 เชียงใหม่' }, pet: { hasPet: false }, rentalHistory: ['303'], status: 'active', createdAt: '2026-03-15T08:00:00Z', updatedAt: '2026-03-15T08:00:00Z' },
  { id: 'tenant-12', name: 'ปิยะมาศ สุดสวย', phone: '082-222-4444', email: 'piyamas.s@gmail.com', citizenId: '1234567890132', coOccupants: [], emergencyContact: { name: 'สมบัติ สุดสวย', relationship: 'พ่อ', phone: '082-222-4445' }, vehicle: { type: 'none', licensePlate: '' }, pet: { hasPet: true, type: 'แมวเปอร์เซีย', name: 'คุกกี้' }, rentalHistory: ['304'], status: 'active', createdAt: '2026-03-20T08:00:00Z', updatedAt: '2026-03-20T08:00:00Z' },
  { id: 'tenant-13', name: 'เกียรติศักดิ์ ชัยชนะ', phone: '083-333-5555', email: 'kiatisak.c@gmail.com', citizenId: '1234567890133', coOccupants: [], emergencyContact: { name: 'สุรชัย ชัยชนะ', relationship: 'พี่ชาย', phone: '083-333-5556' }, vehicle: { type: 'motorcycle', licensePlate: 'ตต 222 ลำปาง' }, pet: { hasPet: false }, rentalHistory: ['401'], status: 'active', createdAt: '2026-04-01T08:00:00Z', updatedAt: '2026-04-01T08:00:00Z' },
  { id: 'tenant-14', name: 'สุรเดช จอมศรี', phone: '084-444-6666', email: 'suradech.j@gmail.com', citizenId: '1234567890134', coOccupants: [], emergencyContact: { name: 'พิมพ์ใจ จอมศรี', relationship: 'แม่', phone: '084-444-6667' }, vehicle: { type: 'car', licensePlate: 'กก 111 แม่ฮ่องสอน' }, pet: { hasPet: false }, rentalHistory: ['402'], status: 'active', createdAt: '2026-04-10T08:00:00Z', updatedAt: '2026-04-10T08:00:00Z' },
  { id: 'tenant-15', name: 'ณิชชา วงศ์ใจ', phone: '085-555-7777', email: 'nitcha.w@gmail.com', citizenId: '1234567890135', coOccupants: [], emergencyContact: { name: 'วิรันต์ วงศ์ใจ', relationship: 'พ่อ', phone: '085-555-7778' }, vehicle: { type: 'none', licensePlate: '' }, pet: { hasPet: false }, rentalHistory: ['403'], status: 'active', createdAt: '2026-04-15T08:00:00Z', updatedAt: '2026-04-15T08:00:00Z' },
  { id: 'tenant-16', name: 'รุ่งโรจน์ สิริโสภา', phone: '086-666-8888', email: 'rungroj.s@gmail.com', citizenId: '1234567890136', coOccupants: [], emergencyContact: { name: 'โสภา สิริโสภา', relationship: 'แม่', phone: '086-666-8889' }, vehicle: { type: 'motorcycle', licensePlate: 'มม 333 เชียงใหม่' }, pet: { hasPet: false }, rentalHistory: ['404'], status: 'active', createdAt: '2026-04-20T08:00:00Z', updatedAt: '2026-04-20T08:00:00Z' },
  { id: 'tenant-17', name: 'สิรินทรา แก้วดี', phone: '087-777-9999', email: 'sirintra.k@gmail.com', citizenId: '1234567890137', coOccupants: [], emergencyContact: { name: 'อัญชลี แก้วดี', relationship: 'พี่สาว', phone: '087-777-9990' }, vehicle: { type: 'none', licensePlate: '' }, pet: { hasPet: false }, rentalHistory: ['105'], status: 'active', createdAt: '2026-05-01T08:00:00Z', updatedAt: '2026-05-01T08:00:00Z' },
  { id: 'tenant-18', name: 'มานะ ขยันงาน', phone: '088-888-0000', email: 'mana.k@gmail.com', citizenId: '1234567890138', coOccupants: [], emergencyContact: { name: 'ชูชาติ ขยันงาน', relationship: 'พ่อ', phone: '088-888-0001' }, vehicle: { type: 'car', licensePlate: 'นข 999 เชียงใหม่' }, pet: { hasPet: false }, rentalHistory: ['205'], status: 'active', createdAt: '2026-05-10T08:00:00Z', updatedAt: '2026-05-10T08:00:00Z' },
  { id: 'tenant-19', name: 'ปิติ สมใจ', phone: '089-999-1111', email: 'piti.s@gmail.com', citizenId: '1234567890139', coOccupants: [], emergencyContact: { name: 'สมบัติ สมใจ', relationship: 'พ่อ', phone: '089-999-1112' }, vehicle: { type: 'motorcycle', licensePlate: 'ยย 444 ลำพูน' }, pet: { hasPet: false }, rentalHistory: ['305'], status: 'active', createdAt: '2026-05-15T08:00:00Z', updatedAt: '2026-05-15T08:00:00Z' },
  { id: 'tenant-20', name: 'อัญชลี จิตรดี', phone: '081-112-2222', email: 'anchalee.j@gmail.com', citizenId: '1234567890140', coOccupants: [], emergencyContact: { name: 'จิตร จิตรดี', relationship: 'พ่อ', phone: '081-112-2223' }, vehicle: { type: 'none', licensePlate: '' }, pet: { hasPet: false }, rentalHistory: ['405'], status: 'active', createdAt: '2026-05-20T08:00:00Z', updatedAt: '2026-05-20T08:00:00Z' },
  {
    id: 'tenant-21',
    name: 'สุชาติ อุ่นใจ',
    phone: '084-333-2211',
    email: 'suchart.o@gmail.com',
    citizenId: '3501104445556',
    coOccupants: [],
    emergencyContact: { name: 'พิม อุ่นใจ', relationship: 'มารดา', phone: '084-333-2210' },
    vehicle: { type: 'none', licensePlate: '' },
    pet: { hasPet: false },
    rentalHistory: ['106'],
    status: 'active',
    createdAt: '2026-01-05T08:00:00Z',
    updatedAt: '2026-01-05T08:00:00Z'
  },
  {
    id: 'tenant-22',
    name: 'อัศวิน สิงห์โต',
    phone: '081-999-8888',
    email: 'asawin.s@gmail.com',
    citizenId: '1234567890141',
    coOccupants: [],
    emergencyContact: { name: 'สมาน สิงห์โต', relationship: 'บิดา', phone: '081-999-8880' },
    vehicle: { type: 'none', licensePlate: '' },
    pet: { hasPet: false },
    rentalHistory: ['107'],
    status: 'inactive',
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-03-31T18:00:00Z'
  },
  {
    id: 'tenant-unregistered',
    name: 'นลินี มั่นคง',
    phone: '089-000-1122',
    email: 'nalinee.m@gmail.com',
    citizenId: '1234567890199',
    coOccupants: [],
    emergencyContact: { name: 'สมชาย มั่นคง', relationship: 'พ่อ', phone: '089-000-1123' },
    vehicle: { type: 'none', licensePlate: '' },
    pet: { hasPet: false },
    rentalHistory: [],
    status: 'active',
    createdAt: '2026-07-28T08:00:00Z',
    updatedAt: '2026-07-28T08:00:00Z'
  }
];

// Initial Rooms (30 rooms)
// Building A: A101-A105, A201-A205, A301-A305, A401-A405 (20 rooms)
// Building B: B101-B105, B201-B205 (10 rooms)
// Plus some rooms without building assigned (unspecified) in Building 'bld-a' / 'bld-b' / undefined.
// Let's create exactly 30 rooms:
// - occupied: 20
// - vacant: 5
// - reserved: 2
// - cleaning: 1
// - maintenance: 2
export const createInitialRooms = (): Room[] => {
  const rooms: Room[] = [];
  const roomTypes = ['Studio Classic', 'Studio Comfort', 'Deluxe Corner', 'Premium 1-Bedroom'];
  const basePrices = [4500, 5000, 5500, 6500];
  const deposits = [9000, 10000, 11000, 13000];

  // Helper to generate room
  const addRoom = (id: string, num: string, bldId: string | undefined, floor: number, typeIdx: number, status: RoomStatus, tId?: string, rentCycle: 'term' | 'monthly' | 'daily' = 'monthly') => {
    rooms.push({
      id,
      roomNumber: num,
      buildingId: bldId,
      floor,
      monthlyRent: basePrices[typeIdx],
      termRent: basePrices[typeIdx] * 4,
      dailyRent: 500 + typeIdx * 100,
      rentCycle,
      depositAmount: deposits[typeIdx],
      depositStatus: status === 'occupied' ? 'paid' : 'unpaid',
      maxOccupants: typeIdx === 3 ? 3 : 2,
      initialWaterMeter: 100 + floor * 10,
      initialElectricMeter: 1200 + floor * 200,
      status,
      currentTenantId: tId,
      images: ['https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=400'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-07-14T02:00:00Z'
    });
  };

  // Occupied Rooms (1 to 21)
  // Floor 1 Bldg A (5 rooms)
  addRoom('101', 'A101', 'bld-a', 1, 0, 'occupied', 'tenant-1');
  addRoom('102', 'A102', 'bld-a', 1, 1, 'occupied', 'tenant-2');
  addRoom('103', 'A103', 'bld-a', 1, 1, 'occupied', 'tenant-3');
  addRoom('104', 'A104', 'bld-a', 1, 0, 'occupied', 'tenant-4');
  addRoom('105', 'A105', 'bld-a', 1, 2, 'occupied', 'tenant-17');

  // Floor 2 Bldg A (5 rooms)
  // Room A201 is a term-based rental, expired 2026-06-30 and not renewed -> vacant in July 2026
  addRoom('201', 'A201', 'bld-a', 2, 0, 'vacant', undefined, 'term');
  addRoom('202', 'A202', 'bld-a', 2, 1, 'occupied', 'tenant-6');
  addRoom('203', 'A203', 'bld-a', 2, 1, 'occupied', 'tenant-7');
  addRoom('204', 'A204', 'bld-a', 2, 0, 'occupied', 'tenant-8');
  addRoom('205', 'A205', 'bld-a', 2, 2, 'occupied', 'tenant-18');

  // Floor 3 Bldg A (5 rooms)
  addRoom('301', 'A301', 'bld-a', 3, 0, 'occupied', 'tenant-9');
  addRoom('302', 'A302', 'bld-a', 3, 1, 'occupied', 'tenant-10');
  addRoom('303', 'A303', 'bld-a', 3, 1, 'occupied', 'tenant-11');
  addRoom('304', 'A304', 'bld-a', 3, 0, 'occupied', 'tenant-12');
  addRoom('305', 'A305', 'bld-a', 3, 2, 'occupied', 'tenant-19');

  // Floor 4 Bldg A (5 rooms)
  addRoom('401', 'A401', 'bld-a', 4, 0, 'occupied', 'tenant-13');
  addRoom('402', 'A402', 'bld-a', 4, 1, 'occupied', 'tenant-14');
  addRoom('403', 'A403', 'bld-a', 4, 1, 'occupied', 'tenant-15');
  addRoom('404', 'A404', 'bld-a', 4, 0, 'occupied', 'tenant-16');
  addRoom('405', 'A405', 'bld-a', 4, 3, 'occupied', 'tenant-20');

  // Bldg B Floor 1 (Occupied + Vacant + Other Statuses)
  addRoom('106', 'B101', 'bld-b', 1, 0, 'occupied', 'tenant-21');
  addRoom('107', 'B102', 'bld-b', 1, 1, 'vacant'); // Vacant 1
  addRoom('108', 'B103', 'bld-b', 1, 1, 'vacant'); // Vacant 2
  addRoom('109', 'B104', 'bld-b', 1, 2, 'vacant'); // Vacant
  addRoom('110', 'B105', 'bld-b', 1, 3, 'maintenance'); // Maintenance 1

  // Bldg B Floor 2 (Unspecified building in terms of layout but in Bldg B)
  addRoom('206', 'B201', 'bld-b', 2, 0, 'vacant'); // Vacant
  addRoom('207', 'B202', 'bld-b', 2, 1, 'vacant'); // Vacant
  addRoom('208', 'B203', 'bld-b', 2, 1, 'maintenance'); // Maintenance
  addRoom('209', 'B204', 'bld-b', 2, 2, 'maintenance'); // Maintenance
  addRoom('210', 'B205', 'bld-b', 2, 3, 'maintenance'); // Maintenance 2

  return rooms;
};

// Initial Contracts
export const createInitialContracts = (): Contract[] => {
  const contracts: Contract[] = [];
  const tenants = initialTenants;
  const rooms = createInitialRooms();

  tenants.forEach((tenant, idx) => {
    // find room tenant resides in
    const rId = tenant.rentalHistory[0];
    const room = rooms.find(r => r.id === rId);
    if (room) {
      // Create contract. For J3 and J8 (tenant-2, tenant-3, tenant-21, etc.) we'll make different dates.
      // 3 contracts expiring soon
      let startOffset = -10; // e.g. 10 months ago
      let duration = 12;
      let status: ContractStatus = 'active';

      if (tenant.id === 'tenant-21') { // Tenant J8: Expiring soon (Expiring on 2026-07-31)
        startOffset = -5;
        duration = 6;
        status = 'expiring_soon';
      } else if (tenant.id === 'tenant-2') { // Tenant J3: Expiring soon
        startOffset = -11;
        duration = 12;
        status = 'expiring_soon';
      } else if (tenant.id === 'tenant-3') {
        startOffset = -5;
        duration = 6;
        status = 'active';
      } else if (tenant.id === 'tenant-5') {
        // Tenant 5 is in room A201 (term-based rental).
        // Let's make it start 6 months ago (2026-01-01) and end 2026-06-30.
        // It has expired and was not renewed, so status is 'terminated'.
        startOffset = -6;
        duration = 6;
        status = 'terminated';
      } else if (tenant.id === 'tenant-22') {
        // Tenant 22 is a short-term tenant in room B102 (107) for exactly 2 months: Feb & Mar.
        // It has ended so status is 'terminated'.
        startOffset = -5;
        duration = 2;
        status = 'terminated';
      }

      const startDate = new Date();
      // Set to 1st of that month
      startDate.setMonth(startDate.getMonth() + startOffset);
      startDate.setDate(1);

      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + duration);
      endDate.setDate(endDate.getDate() - 1);

      // Overwrite specific dates for tenant-5 and tenant-22 to be exact and clean
      let startStr = startDate.toISOString().split('T')[0];
      let endStr = endDate.toISOString().split('T')[0];
      
      if (tenant.id === 'tenant-5') {
        startStr = '2026-01-01';
        endStr = '2026-06-30';
      } else if (tenant.id === 'tenant-22') {
        startStr = '2026-02-01';
        endStr = '2026-03-31';
      }

      contracts.push({
        id: `ct-${tenant.id}`,
        contractNumber: `CNT-2026-${1000 + idx}`,
        tenantId: tenant.id,
        roomId: room.id,
        startDate: startStr,
        endDate: endStr,
        durationMonths: duration,
        rentAmount: room.monthlyRent,
        depositAmount: room.depositAmount,
        
        terms: '1. ห้ามเลี้ยงสัตว์ส่งเสียงดัง (ยกเว้นสัตว์เลี้ยงที่ระบุใบคำขอ)\n2. ห้ามดัดแปลงห้องพัก\n3. จ่ายค่าเช่าภายในวันที่ 5 ของทุกเดือน หากเกินกำหนดมีค่าปรับวันละ 100 บาท',
        tenantSignature: 'MOCK_SIGNATURE_DATA',
        ownerSignature: 'MOCK_OWNER_SIGNATURE_DATA',
        status,
        createdAt: `${startStr}T09:00:00Z`,
        updatedAt: `${startStr}T09:00:00Z`
      });
    }
  });

  return contracts;
};

export const generateMockSlipImage = (tenantName: string, amount: number, roomNumber: string, dateStr?: string) => {
  const formattedAmount = amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateDisplay = dateStr || '14 ก.ค. 2569 - 14:32 น.';
  const refNo = `20260714${Math.floor(100000 + Math.random() * 900000)}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520">
    <rect width="360" height="520" rx="24" fill="#068E44"/>
    <rect x="12" y="12" width="336" height="496" rx="20" fill="#FFFFFF"/>
    <rect x="12" y="12" width="336" height="80" rx="20" fill="#138542"/>
    <text x="32" y="48" fill="#FFFFFF" font-family="sans-serif" font-weight="900" font-size="18">KBank / K-PLUS</text>
    <text x="32" y="68" fill="#D1FAE5" font-family="sans-serif" font-size="11">โอนเงินสำเร็จ • Successful Transfer</text>
    <circle cx="180" cy="120" r="24" fill="#10B981"/>
    <path d="M170 120 L177 127 L192 112" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <text x="180" y="160" text-anchor="middle" fill="#0F172A" font-family="sans-serif" font-weight="800" font-size="14">โอนเงินสำเร็จ</text>
    <text x="180" y="178" text-anchor="middle" fill="#64748B" font-family="sans-serif" font-size="11">${dateDisplay}</text>
    <line x1="32" y1="195" x2="328" y2="195" stroke="#E2E8F0" stroke-dasharray="4 4"/>
    <text x="32" y="220" fill="#94A3B8" font-family="sans-serif" font-size="10" font-weight="700">จาก (FROM)</text>
    <text x="32" y="238" fill="#1E293B" font-family="sans-serif" font-weight="800" font-size="13">${tenantName}</text>
    <text x="32" y="254" fill="#64748B" font-family="sans-serif" font-size="11">ธนาคารกสิกรไทย • xxx-x-x1234-x</text>
    <text x="32" y="285" fill="#94A3B8" font-family="sans-serif" font-size="10" font-weight="700">ไปยัง (TO)</text>
    <text x="32" y="303" fill="#1E293B" font-family="sans-serif" font-weight="800" font-size="13">หอพัก HorPlus (ห้อง ${roomNumber})</text>
    <text x="32" y="319" fill="#64748B" font-family="sans-serif" font-size="11">พร้อมเพย์ • 081-234-5678</text>
    <line x1="32" y1="338" x2="328" y2="338" stroke="#E2E8F0" stroke-dasharray="4 4"/>
    <text x="32" y="365" fill="#94A3B8" font-family="sans-serif" font-size="10" font-weight="700">จำนวนเงิน (AMOUNT)</text>
    <text x="328" y="365" text-anchor="end" fill="#059669" font-family="sans-serif" font-weight="900" font-size="20">฿${formattedAmount}</text>
    <text x="32" y="395" fill="#94A3B8" font-family="sans-serif" font-size="10" font-weight="700">เลขที่อ้างอิง (REF NO.)</text>
    <text x="328" y="395" text-anchor="end" fill="#475569" font-family="sans-serif" font-size="11" font-weight="700">${refNo}</text>
    <rect x="140" y="418" width="80" height="80" rx="8" fill="#F8FAFC" stroke="#CBD5E1"/>
    <rect x="150" y="428" width="25" height="25" fill="#0F172A"/>
    <rect x="185" y="428" width="25" height="25" fill="#0F172A"/>
    <rect x="150" y="463" width="25" height="25" fill="#0F172A"/>
    <rect x="185" y="463" width="15" height="15" fill="#10B981"/>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// Historic Billing (6 months)
export const createInitialBills = (): Bill[] => {
  const bills: Bill[] = [];
  const contracts = createInitialContracts();
  const rooms = createInitialRooms();

  const cycleIds = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

  // Let's generate historic bills for cycleIds
  cycleIds.forEach((cycle) => {
    contracts.forEach((contract, cIdx) => {
      const room = rooms.find(r => r.id === contract.roomId);
      if (!room) return;

      // Check if contract is active during this cycle
      const [cy, cm] = cycle.split('-').map(Number);
      const [sy, sm] = contract.startDate.split('-').map(Number);
      const [ey, em] = contract.endDate.split('-').map(Number);
      
      const cycleVal = cy * 12 + (cm - 1);
      const startVal = sy * 12 + (sm - 1);
      const endVal = ey * 12 + (em - 1);
      
      if (cycleVal < startVal || cycleVal > endVal) {
        return; // Skip if contract was not active in this cycle!
      }

      const isCurrentMonth = cycle === '2026-07';
      let status: BillStatus = 'paid';

      // 5 checking slips and 5 rejected slips for current month
      if (isCurrentMonth) {
        if ([1, 2, 3, 4, 5].includes(cIdx)) {
          status = 'checking'; // 5 rooms waiting for approval (A102, A103, A104, A105, A202)
        } else if ([6, 8, 11, 12, 13].includes(cIdx)) {
          status = 'rejected'; // 5 rooms with rejected slips
        } else if ([9, 10, 14].includes(cIdx)) {
          status = 'overdue'; // Overdue bills
        } else if (cIdx === 7) {
          status = 'draft';
        } else {
          status = 'pending'; // Waiting for payment (A101, etc.)
        }
      }

      const parsedYear = parseInt(cycle.split('-')[0]);
      const parsedMonth = parseInt(cycle.split('-')[1]);

      // Calculate unit consumption based on mock meters
      const waterUnits = 8 + (cIdx % 5);
      const electricUnits = 80 + (cIdx % 10) * 15;

      const waterAmount = waterUnits * 18 + 20; // unit * rate + service
      const electricAmount = electricUnits * 7 + 20;

      const items: BillItem[] = [
        { id: `b-${cycle}-${contract.roomId}-rent`, description: room.rentCycle === 'term' ? 'ค่าเช่ารายเทอม (จ่ายแล้ว)' : 'ค่าเช่ารายเดือน', amount: room.rentCycle === 'term' ? 0 : room.monthlyRent, category: 'rent' },
        { id: `b-${cycle}-${contract.roomId}-water`, description: `ค่าน้ำ (${waterUnits} หน่วย)`, amount: waterAmount, category: 'water' },
        { id: `b-${cycle}-${contract.roomId}-elec`, description: `ค่าไฟ (${electricUnits} หน่วย)`, amount: electricAmount, category: 'electricity' }
      ];

      const tenantObj = initialTenants.find(t => t.id === contract.tenantId);
      const tenantName = tenantObj ? tenantObj.name : 'ผู้เช่า';

      const parkingFeeMode = initialDormitory.parkingFeeMode || 'room';
      const parkingRate = initialDormitory.parkingFee ?? 100;

      if (parkingFeeMode !== 'free') {
        let parkingFeeAmount = 0;
        let parkingDesc = 'ค่าที่จอดรถ';

        if (parkingFeeMode === 'vehicle') {
          if (tenantObj && tenantObj.vehicle && tenantObj.vehicle.type && tenantObj.vehicle.type !== 'none') {
            parkingFeeAmount = parkingRate;
            const vType = tenantObj.vehicle.type === 'car' ? 'รถยนต์' : tenantObj.vehicle.type === 'motorcycle' ? 'รถจักรยานยนต์' : 'ยานพาหนะ';
            parkingDesc = `ค่าที่จอดรถ${vType}${tenantObj.vehicle.licensePlate ? ` (${tenantObj.vehicle.licensePlate})` : ''}`;
          }
        } else {
          parkingFeeAmount = room.parkingFee > 0 ? room.parkingFee : parkingRate;
        }

        if (parkingFeeAmount > 0) {
          items.push({ id: `b-${cycle}-${contract.roomId}-parking`, description: parkingDesc, amount: parkingFeeAmount, category: 'parking' as const });
        }
      }

      let total = items.reduce((sum, item) => sum + item.amount, 0);

      if (status === 'overdue') {
        const lateFeeDaily = initialDormitory.lateFeeDaily ?? 100;
        const lateFeeType = initialDormitory.lateFeeType ?? 'per_day';
        if (lateFeeType !== 'free') {
          const overdueDays = 3;
          const penalty = lateFeeType === 'fixed_once' ? lateFeeDaily : (overdueDays * lateFeeDaily);
          items.push({
            id: `b-${cycle}-${contract.roomId}-fine`,
            description: lateFeeType === 'fixed_once' ? 'ค่าปรับชำระเกินกำหนด' : `ค่าปรับจ่ายล่าช้า ${overdueDays} วัน`,
            amount: penalty,
            category: 'fine' as const
          });
          total += penalty;
        }
      }

      const dueDate = `${cycle.split('-')[1] === '12' ? parsedYear + 1 : parsedYear}-${cycle.split('-')[1] === '12' ? '01' : String(parsedMonth + 1).padStart(2, '0')}-05`;
      
      let slipImg: string | undefined = undefined;
      let rejReason: string | undefined = undefined;

      const rejReasons = [
        'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้ (โอนมา 3,000 บาท ขาดยอด 450 บาท)',
        'สลิปโอนเงินซ้ำกับงวดเดือนก่อนหน้า (สลิปเดิมส่งซ้ำ)',
        'ภาพสลิปไม่ชัดเจน ไม่สามารถสแกน QR Code หรืออ่านเลขที่อ้างอิงได้',
        'เวลาและวันที่ในสลิปโอนเงินไม่ตรงกับรายการเดินบัญชีหอพัก',
        'โอนเงินเข้าผิดบัญชี (โอนเข้าบัญชีส่วนตัวแทนบัญชีหอพัก HorPlus)'
      ];

      if (status === 'checking') {
        slipImg = generateMockSlipImage(tenantName, total, room.roomNumber, '14 ก.ค. 2569 - 09:15 น.');
      } else if (status === 'rejected') {
        slipImg = generateMockSlipImage(tenantName, total, room.roomNumber, '12 ก.ค. 2569 - 16:40 น.');
        const rejIdx = [6, 8, 12, 13, 14].indexOf(cIdx);
        rejReason = rejReasons[rejIdx >= 0 ? rejIdx : 0];
      }

      const bill: Bill = {
        id: `bill-${cycle}-${contract.roomId}`,
        billNumber: `BILL-${cycle.replace('-', '')}-${room.roomNumber}`,
        cycleId: cycle,
        roomId: room.id,
        tenantId: contract.tenantId,
        items,
        totalAmount: total,
        dueDate,
        status,
        rejectReason: rejReason,
        slipImage: slipImg,
        paymentMethod: status === 'paid' ? (cIdx % 3 === 0 ? 'cash' : 'promptpay') : (status === 'checking' ? 'promptpay' : undefined),
        paidAt: status === 'paid' ? `${cycle}-02T10:00:00Z` : undefined,
        createdAt: `${cycle}-25T08:00:00Z`,
        updatedAt: `${cycle}-25T08:00:00Z`
      };

      bills.push(bill);
    });
  });

  return bills;
};

// Initial Maintenance Requests (8 requests covering all statuses)
export const initialMaintenance: MaintenanceRequest[] = [
  {
    id: 'm-1',
    requestNumber: 'MT-2026-0001',
    tenantId: 'tenant-1',
    roomId: '101',
    category: 'electric',
    title: 'หลอดไฟห้องน้ำกะพริบถี่',
    description: 'หลอดไฟในห้องน้ำกะพริบตลอดเวลาเมื่อเปิดสวิตช์ น่าจะเสียหรือเสื่อมสภาพ รบกวนช่วยเปลี่ยนหลอดใหม่ให้ด้วยครับ',
    imageBefore: 'https://images.unsplash.com/photo-1558227691-41ea78d1f631?w=200',
    urgency: 'medium',
    preferredDate: '2026-07-15',
    preferredTimeSlot: 'evening' as any,
    contactPhone: '089-111-2233',
    allowEntryWhenAbsent: true,
    assignedTechnicianId: 'user-tech',
    status: 'inprogress',
    updates: [
      { id: 'u-1-1', status: 'submitted', note: 'แจ้งเรื่องเข้าระบบ', updatedBy: 'tenant-1', updatedAt: '2026-07-12T09:00:00Z' },
      { id: 'u-1-2', status: 'accepted', note: 'รับเรื่องและกำลังจัดหาหลอดไฟประเภทประหยัด LED ไปเปลี่ยน', updatedBy: 'user-manager', updatedAt: '2026-07-12T14:00:00Z' }
    ],
    createdAt: '2026-07-12T09:00:00Z',
    updatedAt: '2026-07-12T14:00:00Z'
  },
  {
    id: 'm-2',
    requestNumber: 'MT-2026-0002',
    tenantId: 'tenant-2',
    roomId: '102',
    category: 'aircon',
    title: 'แอร์มีแต่นมลมร้อนออกและน้ำยาแอร์รั่ว',
    description: 'แอร์ไม่เย็นเลย มีแต่ลมอุ่นออกมา และมีหยดน้ำรั่วซึมไหลพรูลงมาจากคอยล์เย็นตรงผนังห้อง เลอะพื้นหมดเลยค่ะ รบกวนช่างด่วน',
    imageBefore: 'https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=200',
    urgency: 'high',
    preferredDate: '2026-07-14',
    preferredTimeSlot: 'morning',
    contactPhone: '085-444-5566',
    allowEntryWhenAbsent: false,
    assignedTechnicianId: 'user-tech',
    status: 'scheduled',
    updates: [
      { id: 'u-2-1', status: 'submitted', note: 'แจ้งเรื่องด่วน', updatedBy: 'tenant-2', updatedAt: '2026-07-13T08:00:00Z' },
      { id: 'u-2-2', status: 'accepted', note: 'แอดมินรับทราบ นัดหมายคิวช่างด่วนเข้าตรวจสอบ', updatedBy: 'user-manager', updatedAt: '2026-07-13T09:30:00Z' },
      { id: 'u-2-3', status: 'scheduled', note: 'นัดช่างสมชายเข้าห้องวันที่ 14 ก.ค. เวลา 09:30 - 11:30 น.', updatedBy: 'user-manager', updatedAt: '2026-07-13T10:00:00Z' }
    ],
    createdAt: '2026-07-13T08:00:00Z',
    updatedAt: '2026-07-13T10:00:00Z'
  },
  {
    id: 'm-3',
    requestNumber: 'MT-2026-0003',
    tenantId: 'tenant-3',
    roomId: '103',
    category: 'plumbing',
    title: 'ก๊อกน้ำอ่างล้างจานรั่วซึม',
    description: 'ก๊อกน้ำอ่างล้างจานในส่วนระเบียงปิดไม่สนิท มีน้ำหยด ตลอดเวลาเกรงว่าจะเปลืองน้ำของส่วนตัว',
    urgency: 'low',
    preferredDate: '2026-07-16',
    preferredTimeSlot: 'afternoon',
    contactPhone: '086-777-8899',
    allowEntryWhenAbsent: true,
    status: 'submitted',
    updates: [
      { id: 'u-3-1', status: 'submitted', note: 'แจ้งความประสงค์รอรับเรื่องจากหอ', updatedBy: 'tenant-3', updatedAt: '2026-07-13T20:00:00Z' }
    ],
    createdAt: '2026-07-13T20:00:00Z',
    updatedAt: '2026-07-13T20:00:00Z'
  },
  {
    id: 'm-4',
    requestNumber: 'MT-2026-0004',
    tenantId: 'tenant-4',
    roomId: '104',
    category: 'lock',
    title: 'กลอนประตูด้านหลังห้องฝืด ล็อคยาก',
    description: 'ประตูกระจกหลังเลื่อนไปที่ระเบียง ล็อคไม่ค่อยได้ ฝืดมาก กลัวเรื่องความปลอดภัยเวลานอน',
    urgency: 'high',
    preferredDate: '2026-07-11',
    preferredTimeSlot: 'morning',
    contactPhone: '082-222-3333',
    allowEntryWhenAbsent: true,
    assignedTechnicianId: 'user-tech',
    status: 'completed',
    updates: [
      { id: 'u-4-1', status: 'submitted', note: 'แจ้งประตูล็อคระเบียงเสีย', updatedBy: 'tenant-4', updatedAt: '2026-07-11T07:00:00Z' },
      { id: 'u-4-2', status: 'accepted', note: 'รับเรื่องเพื่อความปลอดภัย', updatedBy: 'user-manager', updatedAt: '2026-07-11T08:00:00Z' },
      { id: 'u-4-3', status: 'inprogress', note: 'กำลังถอดหน้าบานกระจกมาหยอดน้ำมันและปรับแนวระดับล้อ', updatedBy: 'user-tech', updatedAt: '2026-07-11T10:00:00Z' },
      { id: 'u-4-4', status: 'completed', note: 'ปรับตั้งล้อประตูและทาจารบีหล่อลื่นเรียบร้อย ประตูล็อคได้สนิทปกติ', updatedBy: 'user-tech', updatedAt: '2026-07-11T11:00:00Z' }
    ],
    rating: 5,
    ratingFeedback: 'ซ่อมเร็วมาก ช่างเก่งและพูดจาสุภาพมากค่ะ ขอบคุณค่ะ',
    createdAt: '2026-07-11T07:00:00Z',
    updatedAt: '2026-07-11T11:00:00Z'
  },
  {
    id: 'm-5',
    requestNumber: 'MT-2026-0005',
    tenantId: 'tenant-5',
    roomId: '201',
    category: 'furniture',
    title: 'เก้าอี้ทำงานพนักพิงหัก',
    description: 'พนักพิงเก้าอี้โมเดิร์นสีขาวหักชำรุดตอนเอนตัวลงนั่งซ่อม ไม่สามารถพิงได้เลยค่ะ มีเก้าอี้เปลี่ยนทดแทนไหมคะ',
    urgency: 'low',
    preferredDate: '2026-07-14',
    preferredTimeSlot: 'afternoon',
    contactPhone: '083-333-4444',
    allowEntryWhenAbsent: true,
    status: 'more_info',
    updates: [
      { id: 'u-5-1', status: 'submitted', note: 'ส่งใบคำขอเก้าอี้ใหม่', updatedBy: 'tenant-5', updatedAt: '2026-07-12T11:00:00Z' },
      { id: 'u-5-2', status: 'more_info', note: 'ขออภัยด้วยค่ะ รบกวนผู้เช่าถ่ายภาพพนักพิงที่หักส่งมาเพิ่มเติมในแชตเพื่อทำเรื่องเคลมพัสดุหอพักได้ไหมคะ', updatedBy: 'user-manager', updatedAt: '2026-07-12T16:00:00Z' }
    ],
    createdAt: '2026-07-12T11:00:00Z',
    updatedAt: '2026-07-12T16:00:00Z'
  },
  {
    id: 'm-6',
    requestNumber: 'MT-2026-0006',
    tenantId: 'tenant-6',
    roomId: '202',
    category: 'internet',
    title: 'สาย LAN ขาดในห้อง',
    description: 'เต้ารับสาย LAN ตรงชั้นวางทีวี ขั้วต่อสายหลุดออกมาจากกำแพงเชื่อมต่อเน็ตไม่ได้',
    urgency: 'medium',
    preferredDate: '2026-07-15',
    preferredTimeSlot: 'any',
    contactPhone: '084-444-5555',
    allowEntryWhenAbsent: false,
    status: 'accepted',
    updates: [
      { id: 'u-6-1', status: 'submitted', note: 'ส่งคำขอซ่อมสายเน็ต', updatedBy: 'tenant-6', updatedAt: '2026-07-13T10:00:00Z' },
      { id: 'u-6-2', status: 'accepted', note: 'รับเรื่องเพื่อเตรียมเครื่องมือเข้าย้ำหัว LAN ใหม่', updatedBy: 'user-manager', updatedAt: '2026-07-14T01:00:00Z' }
    ],
    createdAt: '2026-07-13T10:00:00Z',
    updatedAt: '2026-07-14T01:00:00Z'
  },
  {
    id: 'm-7',
    requestNumber: 'MT-2026-0007',
    tenantId: 'tenant-7',
    roomId: '203',
    category: 'other',
    title: 'ขอเปลี่ยนฟิลเตอร์กรองฝุ่นแอร์',
    description: 'แอร์ในห้องเปิดแล้วมีกลิ่นอับ และรู้สึกฝุ่นเยอะ น่าจะเกินรอบล้างแอร์แล้วค่ะ',
    urgency: 'low',
    preferredDate: '2026-07-18',
    preferredTimeSlot: 'morning',
    contactPhone: '085-555-6666',
    allowEntryWhenAbsent: true,
    status: 'waiting_parts',
    updates: [
      { id: 'u-7-1', status: 'submitted', note: 'แจ้งล้างแอร์อับ', updatedBy: 'tenant-7', updatedAt: '2026-07-10T14:00:00Z' },
      { id: 'u-7-2', status: 'accepted', note: 'รับเรื่องและส่งให้ผู้เชี่ยวชาญประสานงานต่อ', updatedBy: 'user-manager', updatedAt: '2026-07-10T15:00:00Z' },
      { id: 'u-7-3', status: 'waiting_parts', note: 'กำลังรอแผ่นฟิลเตอร์กรองฝุ่น HEPA พิเศษที่สั่งไว้จากซัพพลายเออร์ คาดว่าเข้าวันที่ 17 ก.ค.', updatedBy: 'user-tech', updatedAt: '2026-07-11T16:00:00Z' }
    ],
    createdAt: '2026-07-10T14:00:00Z',
    updatedAt: '2026-07-11T16:00:00Z'
  },
  {
    id: 'm-8',
    requestNumber: 'MT-2026-0008',
    tenantId: 'tenant-8',
    roomId: '204',
    category: 'plumbing',
    title: 'ชักโครกกดไม่ลง น้ำไหลช้า',
    description: 'ชักโครกอุดตัน กดน้ำระบายได้ช้ามากและน้ำแทบไม่ยอมลงเลย รบกวนส่งช่างด่วนที่สุดครับ',
    urgency: 'emergency',
    preferredDate: '2026-07-14',
    preferredTimeSlot: 'any',
    contactPhone: '086-666-7777',
    allowEntryWhenAbsent: true,
    status: 'cancelled',
    updates: [
      { id: 'u-8-1', status: 'submitted', note: 'ส่งใบคำขอฉุกเฉินส้วมตัน', updatedBy: 'tenant-8', updatedAt: '2026-07-13T22:00:00Z' },
      { id: 'u-8-2', status: 'cancelled', note: 'ยกเลิกคำขอเนื่องจากผู้เช่าใช้ไม้ปั๊มยางแก้ปัญหาส้วมตันสำเร็จด้วยตนเองแล้ว ขอบคุณช่างซ่อมครับ', updatedBy: 'tenant-8', updatedAt: '2026-07-13T23:00:00Z' }
    ],
    createdAt: '2026-07-13T22:00:00Z',
    updatedAt: '2026-07-13T23:00:00Z'
  }
];

// Initial Announcements (5 items)
export const initialAnnouncements: Announcement[] = [
  {
    id: 'ann-1',
    title: 'แจ้งพ่นยาฆ่าแมลง ประจำเดือนพฤศจิกายน',
    summary: 'เรียนท่านลูกบ้าน ทางนิติบุคคลจะดำเนินการพ่นยาฆ่าแมลงบริเวณพื้นที่ส่วนกลางและรอบตัวอาคาร เพื่อป้องกันแมลงรบกวน ขอความ...',
    content: 'เรียนท่านลูกบ้าน ทางนิติบุคคลจะดำเนินการพ่นยาฆ่าแมลงบริเวณพื้นที่ส่วนกลางและรอบตัวอาคาร เพื่อป้องกันแมลงรบกวน ขอความร่วมมือหลีกเลี่ยงพื้นที่ในระหว่างการดำเนินการ และกักขังหรือดูแลสัตว์เลี้ยงของท่านภายในห้องพักอย่างใกล้ชิดค่ะ',
    type: 'general',
    targetType: 'building',
    customTarget: 'อาคาร ก, ข',
    publishDate: '2026-11-12',
    isPinned: true,
    isUrgent: true,
    author: 'นิติบุคคล',
    attachmentUrl: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&q=80&w=600',
    createdAt: '2026-11-12T09:00:00Z'
  },
  {
    id: 'ann-2',
    title: 'กำหนดปิดปรับปรุงระบบไฟฟ้าประจำปี',
    summary: 'การไฟฟ้านครหลวงจะทำการงดจ่ายกระแสไฟฟ้าชั่วคราว เพื่อบำรุงรักษาระบบจำหน่ายไฟฟ้าให้มีประสิทธิภาพและปลอดภัยยิ่งขึ้น...',
    content: 'การไฟฟ้านครหลวงจะทำการงดจ่ายกระแสไฟฟ้าชั่วคราว เพื่อบำรุงรักษาระบบจำหน่ายไฟฟ้าให้มีประสิทธิภาพและปลอดภัยยิ่งขึ้น ส่งผลกระทบต่อน้ำประปาและลิฟต์โดยสารในบางช่วงเวลา รบกวนสำรองน้ำไว้ใช้งานล่วงหน้าด้วยนะคะ',
    type: 'electric_off',
    targetType: 'all',
    customTarget: 'ทุกอาคาร',
    publishDate: '2026-11-10',
    isPinned: false,
    author: 'นิติบุคคล',
    createdAt: '2026-11-10T10:30:00Z'
  },
  {
    id: 'ann-3',
    title: 'ทำความสะอาดถังเก็บน้ำใต้ดินเสร็จสิ้น',
    summary: 'แจ้งลูกบ้านอาคาร C การดำเนินการล้างทำความสะอาดถังเก็บน้ำสำรองใต้ดินประจำปีเสร็จสิ้นเรียบร้อยแล้ว ท่านสามารถใช้น้ำได้...',
    content: 'แจ้งลูกบ้านอาคาร C การดำเนินการล้างทำความสะอาดถังเก็บน้ำสำรองใต้ดินประจำปีเสร็จสิ้นเรียบร้อยแล้ว ท่านสามารถกลับมาใช้น้ำอุปโภคบริโภคได้ตามปกติ ขอขอบคุณลูกบ้านทุกท่านสำหรับการร่วมมือในครั้งนี้ค่ะ',
    type: 'maintenance',
    targetType: 'building',
    customTarget: 'อาคาร ค',
    publishDate: '2026-11-09',
    isPinned: false,
    author: 'ช่าง',
    createdAt: '2026-11-09T08:00:00Z'
  }
];

// Initial Audit Logs (10 actions)
export const initialAuditLogs: AuditLog[] = [
  { id: 'al-1', userId: 'user-owner', userName: 'สมศักดิ์ รักดี', userRole: 'เจ้าของระบบ', action: 'ตั้งค่าระบบหลัก', details: 'แก้ไขอัตราค่าน้ำต่อหน่วยเป็น 18 บาท และค่าไฟเป็น 7 บาท', entityType: 'Dormitory', entityId: 'dorm-1', createdAt: '2026-07-10T12:00:00Z' },
  { id: 'al-2', userId: 'user-manager', userName: 'ดวงใจ นวลแก้ว', userRole: 'ผู้จัดการ', action: 'ตรวจสอบมิเตอร์', details: 'คีย์คะแนนมิเตอร์น้ำไฟรอบประจำเดือนกรกฎาคม 2569 อาคาร A', entityType: 'MeterReading', entityId: 'cycle-2026-07', createdAt: '2026-07-12T11:00:00Z' },
  { id: 'al-3', userId: 'user-finance', userName: 'นารี ทวีทรัพย์', userRole: 'การเงิน', action: 'อนุมัติการชำระเงิน', details: 'อนุมัติใบแจ้งหนี้รอบมิถุนายน 2569 ห้อง A102 จำนวน 5,650 บาท', entityType: 'Bill', entityId: 'bill-2026-06-102', createdAt: '2026-07-02T09:45:00Z' },
  { id: 'al-4', userId: 'user-owner', userName: 'สมศักดิ์ รักดี', userRole: 'เจ้าของระบบ', action: 'เริ่มต้นระบบสาธิต', details: 'ติดตั้งฐานข้อมูลจำลองของระบบ HorPlus เรียบร้อยแล้ว', entityType: 'System', entityId: 'system-root', createdAt: '2026-07-14T02:00:00Z' }
];

// State Manager supporting LocalStorage & Seeds
const STORAGE_PREFIX = 'HorPlus_';

export const getStored = <T>(key: string, fallback: T): T => {
  const data = localStorage.getItem(STORAGE_PREFIX + key);
  if (!data) return fallback;
  try {
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
};

export const setStored = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to store data for key "${key}" in localStorage:`, error);
  }
};

export const clearStored = (): void => {
  // Clear all keys with STORAGE_PREFIX
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
};

// Initial state load
export const initialDormitoriesList: Dormitory[] = [
  initialDormitory,
  {
    ...initialDormitory,
    id: 'dorm-2',
    name: 'ฮอร์บิสซิเนส เรสซิเดนซ์ (HorPlus Residence)',
    address: '12/4 ซอยนิมมานทร์เหมินท์ 9 ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200',
    phone: '053-987-654',
    promptPayNumber: '0819876543',
    promptPayName: 'นายสมศักดิ์ รักดี (เรสซิเดนซ์)',
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-07-20T00:00:00Z'
  }
];

export const getDormitories = (): Dormitory[] => getStored<Dormitory[]>('dormitories_list', initialDormitoriesList);
export const saveDormitories = (dorms: Dormitory[]) => setStored('dormitories_list', dorms);

export const getDormitory = (): Dormitory => getStored<Dormitory>('dormitory', initialDormitory);

export const getDormitoryRatesForCycle = (dorm: Dormitory, cycleId: string): CycleRates => {
  const defaultRates: CycleRates = {
    waterUnitRate: dorm.waterUnitRate ?? 18,
    waterBillingMode: dorm.waterBillingMode ?? 'unit',
    electricUnitRate: dorm.electricUnitRate ?? 7,
    electricBillingMode: dorm.electricBillingMode ?? 'unit',
    commonFee: dorm.commonFee ?? 200,
    commonFeeMode: dorm.commonFeeMode ?? 'room',
    internetFee: dorm.internetFee ?? 150,
    internetFeeMode: dorm.internetFeeMode ?? 'room',
    parkingFee: dorm.parkingFee ?? 100,
    parkingFeeMode: dorm.parkingFeeMode ?? 'room',
    lateFeeDaily: dorm.lateFeeDaily ?? 100,
    lateFeeType: dorm.lateFeeType ?? 'per_day'
  };

  if (!dorm.cycleSettings) {
    return defaultRates;
  }

  // 1. Exact match for this cycle
  if (dorm.cycleSettings[cycleId]) {
    return {
      ...defaultRates,
      ...dorm.cycleSettings[cycleId]
    };
  }

  // 2. Fall back to the most recent prior cycle configured
  const cycles = Object.keys(dorm.cycleSettings).filter(c => c !== 'default').sort();
  let mostRecentPriorCycle: string | null = null;
  for (const c of cycles) {
    if (c < cycleId) {
      mostRecentPriorCycle = c;
    } else {
      break;
    }
  }

  if (mostRecentPriorCycle && dorm.cycleSettings[mostRecentPriorCycle]) {
    return {
      ...defaultRates,
      ...dorm.cycleSettings[mostRecentPriorCycle]
    };
  }

  // 3. Fall back to default
  return defaultRates;
};
export const getBuildings = (): Building[] => getStored<Building[]>('buildings', initialBuildings);
export const getRooms = (): Room[] => {
  const loaded = getStored<Room[]>('rooms', createInitialRooms());
  let modified = false;
  const migrated = loaded.map(room => {
    const hasOldAmenities = room.amenities?.some(a => 
      ['เครื่องปรับอากาศ', 'เตียงนอน 5 ฟุต', 'ตู้เสื้อผ้า', 'โต๊ะเครื่องแป้ง', 'เครื่องทำน้ำอุ่น', 'WIFI'].includes(a)
    );
    if (hasOldAmenities) {
      modified = true;
      return {
        ...room,
        amenities: ['ค่าทำความสะอาด (500 บาท)', 'ค่าคีย์การ์ดสูญหาย (300 บาท)']
      };
    }
    return room;
  });
  if (modified) {
    saveRooms(migrated);
    return migrated;
  }
  return loaded;
};
export const getTenants = (): Tenant[] => getStored<Tenant[]>('tenants', initialTenants);
export const getContracts = (): Contract[] => getStored<Contract[]>('contracts', createInitialContracts());
export const getBills = (): Bill[] => getStored<Bill[]>('bills', createInitialBills());
export const getMaintenance = (): MaintenanceRequest[] => getStored<MaintenanceRequest[]>('maintenance', initialMaintenance);
export const getAnnouncements = (): Announcement[] => getStored<Announcement[]>('announcements', initialAnnouncements);
export const getRoles = (): Role[] => getStored<Role[]>('roles', initialRoles);
export const getUsers = (): User[] => {
  const loaded = getStored<User[]>('users', initialUsers);
  if (loaded.length !== 3 || loaded.some(u => u.id === 'user-finance' || u.id === 'user-tech' || u.roleId === 'role-finance')) {
    saveUsers(initialUsers);
    return initialUsers;
  }
  return loaded;
};
export const getAuditLogs = (): AuditLog[] => getStored<AuditLog[]>('audit_logs', initialAuditLogs);
export const getNotifications = (): Notification[] => getStored<Notification[]>('notifications', []);

// Saving Functions
export const saveDormitory = (dorm: Dormitory) => {
  setStored('dormitory', dorm);
  const currentList = getDormitories();
  const idx = currentList.findIndex(d => d.id === dorm.id);
  let updatedList: Dormitory[];
  if (idx >= 0) {
    updatedList = [...currentList];
    updatedList[idx] = dorm;
  } else {
    updatedList = [...currentList, dorm];
  }
  saveDormitories(updatedList);
};
export const saveBuildings = (bld: Building[]) => setStored('buildings', bld);
export const saveRooms = (rooms: Room[]) => setStored('rooms', rooms);
export const saveTenants = (tenants: Tenant[]) => setStored('tenants', tenants);
export const saveContracts = (contracts: Contract[]) => setStored('contracts', contracts);
export const saveBills = (bills: Bill[]) => setStored('bills', bills);
export const saveMaintenance = (maint: MaintenanceRequest[]) => setStored('maintenance', maint);
export const saveAnnouncements = (ann: Announcement[]) => setStored('announcements', ann);
export const saveRoles = (roles: Role[]) => setStored('roles', roles);
export const saveUsers = (users: User[]) => setStored('users', users);
export const saveAuditLogs = (logs: AuditLog[]) => setStored('audit_logs', logs);
export const saveNotifications = (notes: Notification[]) => setStored('notifications', notes);

// Core Data Seeding Function
export const seedDatabase = (force = false) => {
  const seedKey = STORAGE_PREFIX + 'seed_v7_july2026_checking_5';
  if (force || !localStorage.getItem(seedKey)) {
    clearStored();
    localStorage.setItem(seedKey, 'true');
    saveDormitory(initialDormitory);
    saveBuildings(initialBuildings);
    saveRooms(createInitialRooms());
    saveTenants(initialTenants);
    saveContracts(createInitialContracts());
    saveBills(createInitialBills());
    saveMaintenance(initialMaintenance);
    saveAnnouncements(initialAnnouncements);
    saveRoles(initialRoles);
    saveUsers(initialUsers);
    saveAuditLogs(initialAuditLogs);
    saveNotifications([]);
    
    // Add seed logs
    addAuditLog('user-owner', 'รีเซ็ตข้อมูลระบบ', 'เริ่มต้นระบบทดสอบและบันทึกข้อมูลตั้งต้น (Seeding) ใหม่ทั้งหมด', 'System', 'system-root');
  }
};

// Log adding helper
export const addAuditLog = (userId: string, action: string, details: string, entityType: string, entityId: string) => {
  const logs = getAuditLogs();
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  
  const newLog: AuditLog = {
    id: `al-${Date.now()}`,
    userId,
    userName: user?.name || 'ระบบจำลอง',
    userRole: user?.roleName || 'ระบบ',
    action,
    details,
    entityType,
    entityId,
    createdAt: new Date().toISOString()
  };
  
  logs.unshift(newLog);
  saveAuditLogs(logs.slice(0, 100)); // Keep last 100 entries
};

// Create notifications helper
export const addNotification = (userId: string, title: string, message: string, type: Notification['type'], relatedEntityId?: string) => {
  const notes = getNotifications();
  const newNote: Notification = {
    id: `note-${Date.now()}`,
    userId,
    title,
    message,
    type,
    relatedEntityId,
    isRead: false,
    createdAt: new Date().toISOString()
  };
  notes.unshift(newNote);
  saveNotifications(notes);
};

export const formatCycleThaiShort = (cycle: string): string => {
  if (!cycle) return '';
  const [yearStr, monthStr] = cycle.split('-');
  if (!yearStr || !monthStr) return cycle;
  const monthNum = parseInt(monthStr, 10);
  const yearNum = parseInt(yearStr, 10) + 543;
  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  return `${months[monthNum - 1] || monthStr} ${yearNum}`;
};
