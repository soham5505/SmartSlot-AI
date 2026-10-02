# Architecture and operating model

## Service boundaries

- **Web:** `apps/web` is a React 18, TypeScript, Vite, and Tailwind application. It talks to the API with relative `/api` URLs; Vite proxies those requests in development.
- **API:** `apps/api` is an Express 4/TypeScript service. Mongoose models own MongoDB persistence, Zod schemas validate resource writes, JWT middleware authorizes routes, and audit records capture timetable/import actions.
- **Scheduler:** `services/scheduler` is a Python FastAPI service. OR-Tools CP-SAT chooses candidate sessions; the service has no database credentials and accepts generation/validation requests only when the shared bearer token is configured.

The API loads the repository `.env` and then `apps/api/.env` as a fallback. The scheduler does not load dotenv itself; export the shared variables before starting it (the README command sources the root `.env`).

## Resource model

Academic years own multiple semesters. A semester contains its own working-day list, period definitions, break configuration, status, and `configurationVerified` flag. Subjects, batches, and assignments reference a semester; faculty and classrooms can be department-scoped. Batch records can form a parent/child tree, allowing a parent lecture cohort and its practical groups to be represented independently. These structures are configuration-driven; the solver has no department- or semester-specific timetable baked into its model.

Resource deletion is soft deactivation so existing timetable versions and audit references remain available. Resource routes enforce role checks; HOD writes and reads are scoped to the HOD's department. Students can read active resources needed by published timetables but cannot manage academic configuration.

## Generation and safety flow

1. An Admin or HOD requests diagnostics or generation for a semester.
2. The API loads active semester resources and rejects incomplete configuration (including an unverified semester) before generation.
3. When regenerating, the API passes locked sessions from the prior version if `preserveLockedSessions` is enabled. Published sessions from other semesters are also supplied as external room/resource occupancy data.
4. The Python service builds a CP-SAT model and returns `OPTIMAL`, `FEASIBLE`, `INFEASIBLE`, or a model/configuration diagnostic. The API does not trust a solver status alone: it independently validates any returned schedule and discards a schedule that fails validation.
5. The API stores a new version. Timetable edits are independently validated; a hard-conflict edit is rejected unless the caller explicitly saves it as a draft with conflicts. A published or locked timetable cannot be edited in place.
6. Publishing requires `FEASIBLE`/`OPTIMAL` status and a fresh zero-conflict validation. Published student views and exports are restricted to published versions.

Hard validation covers configured days and period alignment, duration and weekly-hours consistency, breaks, resource overlap, batch parent/child scope, faculty availability and workload, room availability/type/capacity/eligibility, and assignment references. Preferences are optimization objectives, not permission to violate hard constraints. See `services/scheduler/app/solver.py`, `services/scheduler/app/validation.py`, and `apps/api/src/services/validateTimetable.ts` for the executable rules.

## Import confirmation and failure handling

The Excel pipeline has separate `validate` and `confirm` calls. Validation parses every populated row, rejects formulas and unsupported columns, checks required values, types/ranges/enums, duplicate keys, reference integrity, and linked assignment compatibility, then stores a preview/history record. Invalid imports cannot be confirmed. Clean imports require an explicit `importId` confirmation and preserve the `updateExisting` choice made during validation. Confirmation processes parent batches before child batches and writes an audit record.

A failed confirm attempts compensating rollback for its writes and records whether rollback completed. This is safer than partial success in a standalone MongoDB development install, but it is not crash-atomic across a multi-document import; production deployments with replica-set support should consider MongoDB transactions or a durable import job.

## Authentication and roles

Passwords are bcrypt-hashed. JWTs use issuer/audience claims and an eight-hour default expiry. The first successfully registered account is Admin; later registration requires an authenticated Admin. The login/register routes are rate-limited. Role-specific behavior is enforced in the API, not only hidden in the frontend. Configure a long random `JWT_SECRET`, deploy behind HTTPS, limit CORS to actual web origins, and keep `SCHEDULER_API_TOKEN` private between the API and scheduler.

## Environment and deployment checklist

- Set `MONGODB_URI`, strong `JWT_SECRET`, `SCHEDULER_URL`, and a separate strong `SCHEDULER_API_TOKEN`.
- Set `NODE_ENV=production`, use a managed MongoDB service with backups, and create/verify indexes because automatic indexing is off in production.
- Restrict `CORS_ORIGINS`; use a reverse proxy so browser requests reach the API through the same site or an explicitly allowed origin.
- Keep the scheduler on a private network. Its `/health` route is intentionally unauthenticated; `/generate` and `/validate` require the shared token.
- Configure logs, request limits, TLS, secrets rotation, and monitoring for the hosting environment. The repository does not yet provide a container/orchestrator deployment manifest.

## Reference timetable data

The reference PDFs were named in the request but were not mounted in this checkout. The seed therefore includes only clearly unverified placeholder semester/batch structures and empty subject/faculty/room/assignment tables. It does not assert exact college subjects, faculty, room labels, timetable cells, or batch-to-lab relationships. Reattach the PDFs before producing a PDF-matched academic workbook or loading authoritative reference data.
