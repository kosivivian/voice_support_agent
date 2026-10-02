// The Agent SDK calls process.report.getReport() every time it starts a
// process, to check whether Linux uses glibc. A full report includes every open
// socket, and in containers each one can trigger a ~5 s blocking name lookup,
// freezing the whole server mid-call. Leave network details out, and reuse the
// first report, since the only thing read from it (the libc version) never changes.
const report = process.report as (NodeJS.ProcessReport & { excludeNetwork?: boolean }) | undefined;

if (report && process.platform === "linux") {
  report.excludeNetwork = true;
  const original = report.getReport.bind(report);
  let cached: ReturnType<typeof original> | null = null;
  report.getReport = ((err?: Error) => (err ? original(err) : (cached ??= original()))) as typeof report.getReport;
  const started = Date.now();
  report.getReport();
  console.log(`[boot] process report cached in ${Date.now() - started} ms`);
}
