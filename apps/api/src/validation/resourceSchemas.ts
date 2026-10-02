import { z } from 'zod';

const id = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid MongoDB ObjectId');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM time');
const timeRange = z.object({ day: z.string().optional(), startTime: time, endTime: time, available: z.boolean().optional() });
const slot = z.object({ day: z.string().optional(), periodIndex: z.number().int().positive(), label: z.string().optional(), startTime: time, endTime: time, kind: z.enum(['class', 'break', 'blocked']).optional() });
const breakRange = z.object({ name: z.string().min(1), startTime: time, endTime: time, days: z.array(z.string()).optional() });
const resource = {
  departments: z.object({ name: z.string().min(1), code: z.string().min(1), description: z.string().optional(), hodId: id.nullable().optional(), active: z.boolean().optional() }),
  academicYears: z.object({ name: z.string().min(1), startDate: z.coerce.date(), endDate: z.coerce.date(), status: z.enum(['planned', 'active', 'completed', 'archived']).optional(), active: z.boolean().optional() }),
  semesters: z.object({ departmentId: id, academicYearId: id, semesterNumber: z.number().int().min(1).max(12), semesterName: z.string().min(1), workingDays: z.array(z.string()).default([]), timeSlots: z.array(slot).default([]), breakConfiguration: z.array(breakRange).default([]), batchIds: z.array(id).optional(), status: z.enum(['draft', 'active', 'archived']).optional(), configurationVerified: z.boolean().optional(), sourceNotes: z.string().optional(), active: z.boolean().optional() }),
  faculty: z.object({ employeeId: z.string().min(1), name: z.string().min(1), email: z.string().email(), departmentId: id, designation: z.string().optional(), subjectIds: z.array(id).optional(), availability: z.array(timeRange).optional(), preferredSlots: z.array(z.unknown()).optional(), unavailableSlots: z.array(timeRange).optional(), maxDailyPeriods: z.number().int().positive().optional(), maxWeeklyPeriods: z.number().int().positive().optional(), active: z.boolean().optional() }),
  subjects: z.object({ subjectCode: z.string().min(1), subjectName: z.string().min(1), shortName: z.string().min(1), departmentId: id, semesterId: id, courseType: z.enum(['Theory', 'Lab', 'Tutorial', 'Project']), weeklyPeriods: z.number().int().positive(), lectureDuration: z.number().int().positive().optional(), labDuration: z.number().int().positive().optional(), requiresLab: z.boolean().optional(), eligibleClassrooms: z.array(id).optional(), eligibleFaculty: z.array(id).optional(), active: z.boolean().optional(), needsVerification: z.boolean().optional() }),
  batches: z.object({ batchCode: z.string().min(1), batchName: z.string().min(1), semesterId: id, studentCount: z.number().int().nonnegative().optional(), batchType: z.enum(['standard', 'lab-group', 'elective', 'common']).optional(), parentBatchId: id.nullable().optional(), active: z.boolean().optional(), needsVerification: z.boolean().optional() }),
  classrooms: z.object({ roomCode: z.string().min(1), roomName: z.string().min(1), roomType: z.enum(['Lecture', 'Laboratory', 'Seminar']), capacity: z.number().int().positive(), equipment: z.array(z.string()).optional(), availability: z.array(timeRange).optional(), departmentId: id.optional(), active: z.boolean().optional() }),
  assignments: z.object({ semesterId: id, subjectId: id, facultyId: id, batchId: id.nullable().optional(), classroomId: id.nullable().optional(), weeklyPeriods: z.number().int().positive(), sessionDuration: z.number().int().positive(), courseType: z.enum(['Theory', 'Lab', 'Tutorial', 'Project']), preferredSlots: z.array(z.unknown()).optional(), active: z.boolean().optional(), needsVerification: z.boolean().optional() })
} as const;

export type ResourceKey = keyof typeof resource;
export const resourceSchemas = resource;
export const validateResourceInput = (name: ResourceKey, value: unknown, partial = false) => {
  const schema = resource[name];
  const actual = partial ? schema.partial() : schema;
  return actual.safeParse(value);
};
