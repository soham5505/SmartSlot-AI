# CampusChronos (SmartSlot-AI repository)

A college timetable planning application with a React/TypeScript web client, an Express/TypeScript API backed by MongoDB/Mongoose, and an independent FastAPI/OR-Tools CP-SAT scheduling service.

> **Local readiness:** the application builds and its API/scheduler test suites pass. It is ready for local development when Node.js, Python, and a running MongoDB instance are configured. A complete MongoDB-backed integration run has not yet passed in this workspace, so do not treat the end-to-end data/import/generation workflow as verified. The FAMT seed data is intentionally draft and incomplete.

> **Reference-data status:** the user supplied FAMT Ratnagiri AY 2026–27 Odd Semester timetable images for SE IT III, TE IT V, and BE IT VII; their period grids, breaks, course codes, weekly contact-hour totals, and batch labels have been visually transcribed. Seeded semester grids remain draft/unverified; no faculty IDs/emails, actual room inventory, or assignments were fabricated. The BE Friday break conflict and duplicate course-code cases need administrator decisions before import/generation. See the [source review](docs/institutional-reference-review.md), [workbook guide](docs/import-workbooks.md), and generated [demo workbook](examples/FAMT_AY2026-27_Timetable_Demo.xlsx).

## What is included

- Role-aware sign-in and protected resource, import, report, and timetable APIs (Admin, HOD, Faculty, Student).
- Dashboard status card backed by a readiness endpoint that checks MongoDB and the CP-SAT scheduler without disclosing connection strings or credentials.
- Configurable academic years, semesters, working days, period grids, breaks, nested batches, faculty availability, subjects, assignments, and rooms.
- Excel `.xlsx` templates, row/reference validation, preview, duplicate checks, explicit import confirmation, import history, and downloadable error reports.
- CP-SAT timetable generation with locked-session preservation, server-side independent schedule validation, conflict-checked editing, publication guards, and version history.
- Timetable and report exports in Excel/PDF, plus workload, hours, room-utilization, conflict, archive, free-period, and batch reports.

## Requirements

- Node.js 20 or newer with npm.
- Python 3.10 or newer (Python 3.11 has been tested); `pip` and `venv` are required.
- MongoDB 6 or newer, running locally or reachable through `MONGODB_URI`. The API does not start MongoDB for you.
- These shell commands are for Linux, macOS, or WSL2. On native Windows, WSL2 is the simplest path because the Python test scripts use `.venv/bin/python`.

## Local development

Run the commands from the repository root (`SmartSlot-AI`). Keep MongoDB, the scheduler, the API, and the web client running in separate terminals.

1. Install dependencies and create your local environment file:

   ```bash
   npm ci
   cp .env.example .env
   python3 -m venv .venv
   .venv/bin/python -m pip install --upgrade pip
   .venv/bin/python -m pip install -r services/scheduler/requirements.txt
   ```

   Edit `.env`. The defaults point to a local MongoDB database named `smartslot`; change `MONGODB_URI` if your local service uses another address. Replace `JWT_SECRET` and `SCHEDULER_API_TOKEN` with different, random values (for example, generate each with `openssl rand -hex 32`). `JWT_SECRET` must be at least 32 characters. The scheduler and API must receive the same `SCHEDULER_API_TOKEN`. Keep `.env` private and out of version control.

2. Start MongoDB separately using your local MongoDB Community installation/service. Confirm that the URI in `.env` accepts a connection before starting the API; API startup exits if MongoDB is unavailable.

3. Start the scheduler in Terminal 1:

   ```bash
   set -a
   source .env
   set +a
   cd services/scheduler
   ../../.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

   Check <http://127.0.0.1:8000/health>. The health route is public; `/generate` and `/validate` require the configured service token.

4. Start the API in Terminal 2, from the repository root:

   ```bash
   npm run dev:api
   ```

   Check <http://127.0.0.1:4000/health>. The API reads the repository-root `.env` and connects to MongoDB before listening.

5. Start the web client in Terminal 3, from the repository root:

   ```bash
   npm run dev:web
   ```

   Open <http://localhost:5173>. Vite proxies `/api` to `http://127.0.0.1:4000` by default; the browser does not call the scheduler directly.

6. On the sign-in screen, choose **Set up first administrator**. The first account created is assigned the Admin role; later registrations require an Admin. Do not expose first-user registration to the public internet during initial setup.

7. Optional: seed the FAMT semester/batch placeholders:

   ```bash
   npm run seed
   ```

   The seed is idempotent for those records and marks them draft/unverified. It creates the common period/break grid and the SE/TE/BE batch labels only—**no subjects, faculty, room inventory, or assignments**. A timetable cannot be generated until complete, verified institutional records and assignments are supplied. Do not mark the FAMT periods verified until the source issues in [the review](docs/institutional-reference-review.md) are resolved.

For a Windows machine, use WSL2 and follow the commands above, or adapt the virtual-environment paths (`.venv\Scripts\python.exe` and `.venv\Scripts\uvicorn.exe`) and shell environment-loading steps. The root `npm test` script currently assumes the POSIX `.venv/bin/python` path.

## Build and test

From the repository root:

```bash
npm test
npm run build
npm run demo:workbook -w @smartslot/api
```

`npm test` runs the API unit tests and Python scheduler tests. The workbook command regenerates `examples/FAMT_AY2026-27_Timetable_Demo.xlsx`; it is a layout/source-review example, **not** an API import workbook.

When a disposable MongoDB is available, run the database-backed integration suite separately:

```bash
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/smartslot_api_integration npm run test:integration -w @smartslot/api
```

**Warning:** the integration suite clears the database named `smartslot_api_integration`. Never point it at production or at a database containing user data. If `MONGODB_TEST_URI` is omitted, `mongodb-memory-server` attempts to download a real MongoDB binary; see [integration-test instructions and the sandbox failure](docs/integration-testing.md). A successful build/unit run is not a substitute for the database-backed import → generation → persistence → validation → display → export test.

## Main API areas

All application routes except health and initial registration/login require a bearer token unless noted.

| Area | Routes |
| --- | --- |
| Authentication | `/api/auth/register`, `/api/auth/login`, `/api/auth/me` |
| Academic resources | `/api/departments`, `/api/academicYears`, `/api/semesters`, `/api/faculty`, `/api/subjects`, `/api/batches`, `/api/classrooms`, `/api/assignments` |
| Excel import | `/api/import/template/:type`, `/api/import/validate`, `/api/import/confirm`, `/api/import/history` |
| Timetables | `/api/timetables/diagnostics/:semesterId`, `/api/timetables/generate`, `/api/timetables`, `/api/timetables/:id/validate`, `/api/timetables/:id`, `/api/timetables/:id/publish` |
| Exports | `/api/timetables/:id/export/excel`, `/api/timetables/:id/export/pdf`, `/api/reports/export/:type?format=xlsx\|pdf` |
| Reports | `/api/reports/:type` |
| Health | `GET /health`, `GET /api/health`, `GET /api/health/readiness` (reports API, MongoDB, and scheduler status; `503` when a dependency is unavailable) |

HOD access is scoped to their department. Students are limited to published timetables. See [architecture and operations](docs/architecture.md) for the broader model and safety boundaries.

## Production notes and known limitations

- Put the API behind HTTPS and a trusted reverse proxy; restrict `CORS_ORIGINS` to the deployed web origins. Use strong, independently generated JWT and scheduler service secrets. Do not expose the Python scheduler to public traffic.
- Configure MongoDB backups, monitoring, and production indexes before go-live. Automatic Mongoose index creation is disabled when `NODE_ENV=production`.
- ExcelJS 4.4.0 still declares `uuid@^8.3.0`; the root npm override resolves that transitive dependency to `uuid@11.1.1`. `npm ls uuid --all` resolves the pinned version, and both `npm audit` and `npm audit --omit=dev` report zero vulnerabilities. The API export tests round-trip ExcelJS's extended conditional-formatting path, which exercises its CommonJS `uuid.v4()` call. See [the dependency review](docs/security-dependencies.md); recheck the override and exports when upgrading ExcelJS.
- The import confirmation path uses compensating rollback rather than a MongoDB multi-document transaction so it also runs on standalone local MongoDB. For multi-user production imports, consider a replica-set transaction or a durable import-job/rollback design.
- FAMT Ratnagiri AY 2026–27 Odd Semester timetable images now define the demo periods/breaks and course/batch transcription. Do not mark a semester verified until the missing employee IDs/emails, room inventory mapping, subject-code collisions, lab session lengths, and BE Friday break exception are resolved; see [the source review](docs/institutional-reference-review.md). No reference timetable is embedded in the solver.

## Last verified in this workspace

- API unit tests: **31 passed across 6 suites** (including dependency-readiness endpoint coverage).
- API and web production builds: **passed** (Vite transformed 1,656 modules).
- Scheduler tests: **10 passed**.
- Dashboard now includes a refreshable service-readiness card backed by `GET /api/health/readiness`; the endpoint reports API, MongoDB, and scheduler availability without exposing configuration values.
- The FAMT demo workbook was regenerated and read back as a valid `.xlsx` with 10 sheets, three blank seven-period grids, both common break columns, source course/group references, and review flags. Timetable web and Excel views include break columns; generated Excel exports also retain a detailed `Sessions` sheet.
- `npm audit` and `npm audit --omit=dev`: **0 vulnerabilities** after the UUID override; ExcelJS import/export and the UUID-backed extension round-trip tests passed.
- MongoDB integration/E2E suite: **not passed**. It is implemented, but the sandbox could not obtain/start a MongoDB server; see the exact failure in [integration-testing.md](docs/integration-testing.md).
- FAMT reference review: **visually transcribed from the six attached timetable/course-table images**. Common period slots and break headers, batch structures, subject codes, faculty labels, and weekly contact-hour totals are recorded. Employee master data, room identities/capacities, lab session lengths, code collisions, and the BE Friday exception still need administrator verification.

Do not call the project complete until DB integration and a pilot based on the administrator-confirmed reference PDFs have run successfully.
