import '../config/environment';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AcademicYear, Batch, Department, Semester } from '../models';

const publishedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const periodRanges: Array<[string, string]> = [
  ['09:15', '10:15'], ['10:15', '11:15'], ['11:30', '12:30'], ['12:30', '13:30'],
  ['14:15', '15:15'], ['15:15', '16:15'], ['16:15', '17:15']
];
const publishedSlots = periodRanges.map(([startTime, endTime], index) => ({
  periodIndex: index + 1, label: `Period ${index + 1}`, startTime, endTime, kind: 'class' as const
}));
const standardBreaks = [
  { name: 'Short Break', startTime: '11:15', endTime: '11:30' },
  { name: 'Lunch Break', startTime: '13:30', endTime: '14:15' }
];

async function seed() {
  await connectDatabase();
  try {
    const department: any = await Department.findOneAndUpdate(
      { code: 'IT' }, { $set: { name: 'Information Technology', description: 'Hope Foundation Finolex Academy of Management and Technology, Ratnagiri.', active: true } }, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // The timetables identify AY 2026-27 and Odd Semester, but do not state academic-year boundaries.
    const year: any = await AcademicYear.findOneAndUpdate(
      { name: 'AY 2026-27 (verify dates)' },
      { $set: { startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-12-31T00:00:00Z'), status: 'planned', active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const setups = [
      {
        number: 3,
        name: 'SE IT — Semester III',
        codes: ['B1', 'B2', 'B3', 'B4'],
        note: 'Source: user-provided FAMT Ratnagiri SE IT Semester III timetable and course table, AY 2026-27 Odd Semester. The published day/period grid is 09:15-10:15, 10:15-11:15, 11:30-12:30, 12:30-13:30, 14:15-15:15, 15:15-16:15, 16:15-17:15, with 11:15-11:30 and 13:30-14:15 breaks. Course table totals 63 weekly contact hours across B1-B4. Subject code 2343611 is printed for both a Theory row and a Lab row; subject representation and instructor/room master mapping require administrator review.'
      },
      {
        number: 5,
        name: 'TE IT — Semester V',
        codes: ['B1', 'B2', 'B3', 'B4', 'W1', 'W2', 'W3', 'W4', 'D1', 'D2'],
        note: 'Source: user-provided FAMT Ratnagiri TE IT Semester V timetable and course table, AY 2026-27 Odd Semester. The published day/period grid is 09:15-10:15, 10:15-11:15, 11:30-12:30, 12:30-13:30, 14:15-15:15, 15:15-16:15, 16:15-17:15, with 11:15-11:30 and 13:30-14:15 breaks. Course table totals 74 weekly contact hours across B1-B4, W1-W4 and D1-D2. MCD501 is printed for two different MDM streams; confirm separate subject identity and assignments before import.'
      },
      {
        number: 7,
        name: 'BE IT — Semester VII',
        codes: ['B1', 'B2', 'B3'],
        note: 'Source: user-provided FAMT Ratnagiri BE IT Semester VII timetable and course table, AY 2026-27 Odd Semester. The header grid is 09:15-10:15, 10:15-11:15, 11:30-12:30, 12:30-13:30, 14:15-15:15, 15:15-16:15, 16:15-17:15, with 11:15-11:30 and 13:30-14:15 breaks. Course table totals 46 weekly contact hours across B1-B3. A Friday row separately shows lunch 12:30-13:15 and Honor/Minor Lab 13:15-17:15, conflicting with the common header; keep this semester unverified until the administrator resolves it.'
      }
    ];
    for (const setup of setups) {
      const semester: any = await Semester.findOneAndUpdate(
        { departmentId: department._id, academicYearId: year._id, semesterNumber: setup.number },
        { $set: {
          semesterName: setup.name,
          workingDays: publishedDays,
          timeSlots: publishedSlots,
          breakConfiguration: standardBreaks,
          status: 'draft',
          configurationVerified: false,
          sourceNotes: `SOURCE TRANSCRIBED, ADMIN APPROVAL REQUIRED — do not generate or publish until course-code, faculty-ID, location, session-duration, and timetable exceptions are reviewed. ${setup.note}`,
          active: true
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      const batchIds: any[] = [];
      for (const code of setup.codes) {
        const practicalGroup = setup.number === 5 && /^[WD]\d$/i.test(code);
        const batch: any = await Batch.findOneAndUpdate(
          { semesterId: semester._id, batchCode: code },
          { $set: {
            batchName: practicalGroup ? `Practical Group ${code}` : `Batch ${code}`,
            batchType: practicalGroup ? 'lab-group' : 'standard',
            studentCount: 0,
            active: true,
            needsVerification: true
          } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        batchIds.push(batch._id);
      }
      semester.batchIds = batchIds;
      await semester.save();
    }
    console.log('Seed complete: FAMT Ratnagiri AY 2026-27 Odd Semester grids and source batch labels are draft/unverified. No subjects, faculty IDs, rooms, or assignments were fabricated.');
  } finally {
    await disconnectDatabase();
  }
}

void seed().catch(error => { console.error(`Seed failed: ${error.message}`); process.exitCode = 1; });
