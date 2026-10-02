import mongoose, { Schema } from 'mongoose';

const objectId = Schema.Types.ObjectId;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const baseOptions = { timestamps: true, versionKey: false as const, minimize: false };
const activeField = { type: Boolean, default: true, index: true };
const timeRangeSchema = new Schema({
  day: { type: String, trim: true },
  startTime: { type: String, required: true, match: timePattern },
  endTime: { type: String, required: true, match: timePattern },
  available: { type: Boolean, default: true }
}, { _id: false });

const departmentSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  description: { type: String, trim: true, default: '' },
  hodId: { type: objectId, ref: 'User' },
  active: activeField
}, baseOptions);
departmentSchema.index({ code: 1 }, { unique: true });
departmentSchema.index({ name: 1 });

const academicYearSchema = new Schema({
  name: { type: String, required: true, trim: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['planned', 'active', 'completed', 'archived'], default: 'planned', index: true },
  active: activeField
}, baseOptions);
academicYearSchema.index({ name: 1 }, { unique: true });
academicYearSchema.pre('validate', function (next) {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) this.invalidate('endDate', 'End date must be after start date');
  next();
});

const slotSchema = new Schema({
  day: { type: String, trim: true },
  periodIndex: { type: Number, min: 1, required: true },
  label: { type: String, trim: true, default: '' },
  startTime: { type: String, required: true, match: timePattern },
  endTime: { type: String, required: true, match: timePattern },
  kind: { type: String, enum: ['class', 'break', 'blocked'], default: 'class' }
}, { _id: false });
const breakSchema = new Schema({
  name: { type: String, required: true, trim: true },
  startTime: { type: String, required: true, match: timePattern },
  endTime: { type: String, required: true, match: timePattern },
  days: [{ type: String, trim: true }]
}, { _id: false });
const semesterSchema = new Schema({
  departmentId: { type: objectId, ref: 'Department', required: true, index: true },
  academicYearId: { type: objectId, ref: 'AcademicYear', required: true, index: true },
  semesterNumber: { type: Number, min: 1, max: 12, required: true },
  semesterName: { type: String, required: true, trim: true },
  workingDays: { type: [String], default: [] },
  timeSlots: { type: [slotSchema], default: [] },
  breakConfiguration: { type: [breakSchema], default: [] },
  batchIds: [{ type: objectId, ref: 'Batch' }],
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
  configurationVerified: { type: Boolean, default: false },
  sourceNotes: { type: String, trim: true, default: '' },
  active: activeField
}, baseOptions);
semesterSchema.index({ departmentId: 1, academicYearId: 1, semesterNumber: 1 }, { unique: true });
semesterSchema.index({ academicYearId: 1, status: 1 });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['Admin', 'HOD', 'Faculty', 'Student'], required: true, index: true },
  departmentId: { type: objectId, ref: 'Department' },
  facultyId: { type: objectId, ref: 'Faculty' },
  active: activeField,
  lastLoginAt: Date
}, baseOptions);
userSchema.index({ email: 1 }, { unique: true });

const facultySchema = new Schema({
  employeeId: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  departmentId: { type: objectId, ref: 'Department', required: true, index: true },
  designation: { type: String, trim: true, default: '' },
  subjectIds: [{ type: objectId, ref: 'Subject' }],
  availability: { type: [timeRangeSchema], default: [] },
  preferredSlots: { type: [Schema.Types.Mixed], default: [] },
  unavailableSlots: { type: [timeRangeSchema], default: [] },
  maxDailyPeriods: { type: Number, min: 1, default: 6 },
  maxWeeklyPeriods: { type: Number, min: 1, default: 24 },
  active: activeField
}, baseOptions);
facultySchema.index({ employeeId: 1 }, { unique: true });
facultySchema.index({ email: 1 }, { unique: true });
facultySchema.index({ departmentId: 1, active: 1 });

const subjectSchema = new Schema({
  subjectCode: { type: String, required: true, uppercase: true, trim: true },
  subjectName: { type: String, required: true, trim: true },
  shortName: { type: String, required: true, trim: true },
  departmentId: { type: objectId, ref: 'Department', required: true, index: true },
  semesterId: { type: objectId, ref: 'Semester', required: true, index: true },
  courseType: { type: String, enum: ['Theory', 'Lab', 'Tutorial', 'Project'], required: true },
  weeklyPeriods: { type: Number, min: 1, required: true },
  lectureDuration: { type: Number, min: 1, default: 1 },
  labDuration: { type: Number, min: 1, default: 2 },
  requiresLab: { type: Boolean, default: false },
  eligibleClassrooms: [{ type: objectId, ref: 'Classroom' }],
  eligibleFaculty: [{ type: objectId, ref: 'Faculty' }],
  active: activeField,
  needsVerification: { type: Boolean, default: false }
}, baseOptions);
subjectSchema.index({ semesterId: 1, subjectCode: 1 }, { unique: true });
subjectSchema.index({ departmentId: 1, courseType: 1 });

const batchSchema = new Schema({
  batchCode: { type: String, required: true, uppercase: true, trim: true },
  batchName: { type: String, required: true, trim: true },
  semesterId: { type: objectId, ref: 'Semester', required: true, index: true },
  studentCount: { type: Number, min: 0, default: 0 },
  batchType: { type: String, enum: ['standard', 'lab-group', 'elective', 'common'], default: 'standard' },
  parentBatchId: { type: objectId, ref: 'Batch' },
  active: activeField,
  needsVerification: { type: Boolean, default: false }
}, baseOptions);
batchSchema.index({ semesterId: 1, batchCode: 1 }, { unique: true });

const classroomSchema = new Schema({
  roomCode: { type: String, required: true, uppercase: true, trim: true },
  roomName: { type: String, required: true, trim: true },
  roomType: { type: String, enum: ['Lecture', 'Laboratory', 'Seminar'], required: true },
  capacity: { type: Number, min: 1, required: true },
  equipment: [{ type: String, trim: true }],
  availability: { type: [timeRangeSchema], default: [] },
  departmentId: { type: objectId, ref: 'Department', index: true },
  active: activeField
}, baseOptions);
classroomSchema.index({ roomCode: 1 }, { unique: true });
classroomSchema.index({ departmentId: 1, roomType: 1, active: 1 });

const assignmentSchema = new Schema({
  semesterId: { type: objectId, ref: 'Semester', required: true, index: true },
  subjectId: { type: objectId, ref: 'Subject', required: true, index: true },
  facultyId: { type: objectId, ref: 'Faculty', required: true, index: true },
  batchId: { type: objectId, ref: 'Batch', index: true },
  classroomId: { type: objectId, ref: 'Classroom' },
  weeklyPeriods: { type: Number, min: 1, required: true },
  sessionDuration: { type: Number, min: 1, required: true },
  courseType: { type: String, enum: ['Theory', 'Lab', 'Tutorial', 'Project'], required: true },
  preferredSlots: { type: [Schema.Types.Mixed], default: [] },
  active: activeField,
  needsVerification: { type: Boolean, default: false }
}, baseOptions);
assignmentSchema.index({ semesterId: 1, active: 1 });
assignmentSchema.index({ facultyId: 1, semesterId: 1 });

const sessionSchema = new Schema({
  day: { type: String, required: true },
  startTime: { type: String, required: true, match: timePattern },
  endTime: { type: String, required: true, match: timePattern },
  subjectId: { type: objectId, ref: 'Subject', required: true },
  facultyId: { type: objectId, ref: 'Faculty', required: true },
  batchId: { type: objectId, ref: 'Batch', default: null },
  classroomId: { type: objectId, ref: 'Classroom', required: true },
  sessionType: { type: String, enum: ['Theory', 'Lab', 'Tutorial', 'Project'], required: true },
  duration: { type: Number, min: 1, required: true },
  assignmentId: { type: objectId, ref: 'Assignment', required: true },
  locked: { type: Boolean, default: false }
}, { _id: true });
const timetableSchema = new Schema({
  semesterId: { type: objectId, ref: 'Semester', required: true, index: true },
  academicYearId: { type: objectId, ref: 'AcademicYear', required: true, index: true },
  version: { type: Number, min: 1, required: true },
  generationStatus: { type: String, enum: ['DRAFT', 'FEASIBLE', 'OPTIMAL', 'INFEASIBLE', 'UNKNOWN', 'MODEL_INVALID'], default: 'DRAFT', index: true },
  generatedBy: { type: objectId, ref: 'User', required: true },
  generationDate: { type: Date, default: Date.now },
  schedule: { type: [sessionSchema], default: [] },
  validationResults: { type: [Schema.Types.Mixed], default: [] },
  optimizationScore: { type: Number, min: 0, max: 100 },
  scoreBreakdown: { type: Schema.Types.Mixed, default: {} },
  published: { type: Boolean, default: false, index: true },
  locked: { type: Boolean, default: false },
  auditTrail: [{ type: objectId, ref: 'AuditLog' }]
}, baseOptions);
timetableSchema.index({ semesterId: 1, version: -1 }, { unique: true });
timetableSchema.index({ academicYearId: 1, published: 1 });

const auditLogSchema = new Schema({
  actorId: { type: objectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: objectId, required: true, index: true },
  changes: { type: Schema.Types.Mixed, default: {} },
  requestId: String
}, baseOptions);

const importErrorSchema = new Schema({
  sheet: { type: String, required: true },
  row: { type: Number, required: true },
  field: String,
  code: String,
  message: { type: String, required: true }
}, { _id: false });
const importHistorySchema = new Schema({
  uploadedBy: { type: objectId, ref: 'User', required: true, index: true },
  filename: { type: String, required: true },
  status: { type: String, enum: ['invalid', 'validated', 'committed', 'failed'], default: 'invalid', index: true },
  updateExisting: { type: Boolean, default: false },
  rows: { type: [Schema.Types.Mixed], default: [] },
  rowErrors: { type: [importErrorSchema], default: [] },
  summary: { type: Schema.Types.Mixed, default: {} },
  committedAt: Date
}, baseOptions);
importHistorySchema.index({ createdAt: -1 });

export const Department = mongoose.models.Department || mongoose.model('Department', departmentSchema);
export const AcademicYear = mongoose.models.AcademicYear || mongoose.model('AcademicYear', academicYearSchema);
export const Semester = mongoose.models.Semester || mongoose.model('Semester', semesterSchema);
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Faculty = mongoose.models.Faculty || mongoose.model('Faculty', facultySchema);
export const Subject = mongoose.models.Subject || mongoose.model('Subject', subjectSchema);
export const Batch = mongoose.models.Batch || mongoose.model('Batch', batchSchema);
export const Classroom = mongoose.models.Classroom || mongoose.model('Classroom', classroomSchema);
export const Assignment = mongoose.models.Assignment || mongoose.model('Assignment', assignmentSchema);
export const Timetable = mongoose.models.Timetable || mongoose.model('Timetable', timetableSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export const ImportHistory = mongoose.models.ImportHistory || mongoose.model('ImportHistory', importHistorySchema);

export const RESOURCE_MODELS = {
  departments: Department,
  academicYears: AcademicYear,
  semesters: Semester,
  faculty: Faculty,
  subjects: Subject,
  batches: Batch,
  classrooms: Classroom,
  assignments: Assignment
} as const;
export type ResourceName = keyof typeof RESOURCE_MODELS;
