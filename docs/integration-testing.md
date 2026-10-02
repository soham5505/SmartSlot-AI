# Database and timetable integration tests

`apps/api/src/__tests__/campus.integration.test.ts` exercises real Mongoose persistence through Express/Supertest and runs the Python FastAPI scheduler as a child process. It covers:

- Create/list/read/update/soft-delete for semesters, faculty, subjects, batches, classrooms, and assignments.
- Invalid ObjectId/reference handling and duplicate-key error mapping.
- An `.xlsx` upload through validate/confirm, stored resource relations and import history, CP-SAT generation through the API, persisted timetable retrieval, independent validation, timetable display, and PDF/XLSX export.
- The pilot fixture is intentionally synthetic and clearly labelled; it is not sourced from the official institutional timetable PDFs.

Run with an installed local disposable MongoDB database:

```bash
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/smartslot_api_integration \
  npm run test:integration -w @smartslot/api
```

The suite **clears the named database** before each case. Do not point `MONGODB_TEST_URI` at production or any database containing user data. The suite checks the database name is exactly `smartslot_api_integration`. It starts the test scheduler from `.venv/bin/python` automatically; set `SCHEDULER_TEST_PYTHON` if using a different Python executable.

If `MONGODB_TEST_URI` is omitted, `mongodb-memory-server` starts a real MongoDB server binary in a temporary process and downloads MongoDB 7.0.24 on first use. Alternatively, point `MONGOMS_SYSTEM_BINARY` at an installed `mongod` executable. This is a real MongoDB server, not an in-memory JavaScript mock.

## Execution result in this sandbox

The integration suite was invoked after adding it. Its TypeScript compile error was corrected. Execution then failed before database startup because this environment has no `mongod`, `mongosh`, Docker, or configured MongoDB URI, and network egress to `fastdl.mongodb.org` is blocked (`ECONNRESET` while downloading `mongodb-linux-x86_64-debian12-7.0.24.tgz`). Debian package repositories were also unreachable. Consequently, none of the DB CRUD assertions or the full API→OR-Tools→persist→display→export assertions have run against MongoDB in this checkout. Do not report them as passing until the command above completes against a disposable database.

The ordinary API unit suite deliberately excludes `*.integration.test.ts` so a blocked external MongoDB binary does not make unit tests look like application failures. Run the integration command separately when a local/test MongoDB connection or cached server binary is available.
