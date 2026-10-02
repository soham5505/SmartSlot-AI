# Dependency security review

## ExcelJS / uuid advisory

The audit showed two moderate findings for the transitive chain `exceljs@4.4.0 → uuid@8.3.2` (GHSA-w5hq-g745-h8pq / CVE-2026-41907). The advisory describes missing output-buffer bounds validation in UUID API methods `v3()`, `v5()`, and `v6()` when a caller supplies an output buffer; it lists `uuid@11.1.1` as patched. See the [GitHub Advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

The checked-in ExcelJS code calls only `uuid.v4()` with no buffer in its extended conditional-formatting serializer (`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`). That usage does not appear to reach the affected methods/argument path. The project nevertheless pins the transitive dependency at the patched version rather than ignoring the audit result:

```json
"overrides": {
  "uuid": "11.1.1"
}
```

This preserves ExcelJS 4.4.0 and its importer/exporter instead of applying npm's suggested forced ExcelJS downgrade. `uuid@11.1.1` continues to expose the CommonJS `v4()` API used by ExcelJS. A regression test writes and reloads an ExcelJS extended data-bar rule, forcing that UUID-backed serialization path. The Excel import, generated timetable exports, and this path should be included in tests after future dependency changes.

Verified after the override:

- `npm ls uuid --all` resolves ExcelJS to `uuid@11.1.1`.
- Both `npm audit` and `npm audit --omit=dev` report zero vulnerabilities.
- API import/export unit tests, including the UUID-backed conditional-formatting round-trip, pass.

Re-run `npm install` after changing the override, then inspect `npm ls uuid --all` and run the API tests. Do not apply `npm audit fix --force` without reviewing its proposed dependency changes.
