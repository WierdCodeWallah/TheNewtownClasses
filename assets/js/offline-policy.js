/* Offline Test Series records are permanent: checked PDFs, marks, feedback and
   history never expire. Shared by the dashboards and server functions. */
(function (root) {
  const DAY = 86400000;
  const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const iso = ms => Number.isFinite(ms) && ms ? new Date(ms).toISOString() : '';
  function history(r) {
    return { reportId: r.attemptId || r.reportId, testName: r.testName || '', subject: r.subject || '', chapter: r.chapter || r.topic || 'General',
      module: r.module || 'Full chapter', class: r.studentClass || r.class || '', submittedAt: r.submittedAt,
      reviewDueAt: iso(time(r.submittedAt) + 2 * DAY), status: r.status || 'submitted' };
  }
  function stats(historyRows, results) {
    const rows = new Map();
    [...historyRows, ...results].filter(r => r.reportId).forEach(r => rows.set(r.reportId, { ...rows.get(r.reportId), ...r }));
    const chapters = new Map();
    for (const r of rows.values()) {
      if (r.status !== 'approved' && r.score == null) continue;
      const max = Number(r.totalMarks), score = Number(r.score);
      if (!(max > 0) || !Number.isFinite(score)) continue;
      const chapter = r.chapter || r.topic || 'General', key = `${r.subject}\0${chapter}`;
      const group = chapters.get(key) || { subject: r.subject, chapter, count: 0, totalPct: 0 };
      group.count++; group.totalPct += score / max * 100; chapters.set(key, group);
    }
    return { count: rows.size, chapters: [...chapters.values()].map(c => ({ ...c, average: Math.round(c.totalPct / c.count) })) };
  }
  const api = { DAY, history, stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NTCOfflinePolicy = api;
})(typeof window === 'undefined' ? null : window);
