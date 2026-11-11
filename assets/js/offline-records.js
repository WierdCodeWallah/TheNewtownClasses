/* Offline Test Series records for staff views (teacher review desk, admin).
   Turns offlineReports documents into flat, searchable records organised as
   Class → Subject → Chapter → Module / Part → Test, and builds the per-student
   and class × subject counts. Pure functions: no network, no storage. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  // Only the fields the lists need; keeps large AI reports out of list reads.
  const FIELDS = ['uid', 'testId', 'studentName', 'studentId', 'studentClass', 'studentBoard', 'studentSection', 'board',
    'subject', 'chapter', 'module', 'testName', 'totalMarks', 'status', 'reviewMode', 'score', 'aiScore', 'aiMax',
    'finalReport', 'teacherName', 'teacherUid', 'approvedByName', 'teacherRemark', 'submittedAt', 'approvedAt',
    'reviewDueAt', 'lateByMin', 'scriptPdfUrl', 'checkedScriptUrl'];
  const STAGES = { pending: 'Awaiting review', checking: 'Being checked', returned: 'Returned' };
  const subjectName = value => (root && root.PortalUI && root.PortalUI.subject) ? root.PortalUI.subject(value) : String(value || 'General').trim();
  const classNumber = c => { const m = String(c || '').match(/\d+/); return m ? parseInt(m[0], 10) : 9999; };
  const byClass = (a, b) => classNumber(a) - classNumber(b) || String(a).localeCompare(String(b), undefined, { numeric: true });
  const delivery = url => (root && root.NTCUploadcare && url) ? root.NTCUploadcare.deliveryUrl(url) : (url || '');

  function listUrl(projectId, apiKey, pageSize) {
    return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/offlineReports?key=${apiKey}&pageSize=${pageSize || 300}`
      + FIELDS.map(f => '&mask.fieldPaths=' + f).join('');
  }

  function parse(doc, now) {
    now = now || Date.now();
    const f = doc.fields || {};
    const s = k => (f[k] && f[k].stringValue) || '';
    const n = k => { const v = f[k]; if (!v) return null; const x = Number(v.doubleValue != null ? v.doubleValue : v.integerValue); return Number.isFinite(x) ? x : null; };
    const status = s('status') || 'submitted';
    const stage = status === 'approved' ? 'returned' : ['checking', 'grading'].includes(status) ? 'checking' : 'pending';
    const totalMarks = n('totalMarks') || 0;
    let score = stage === 'returned' ? n('score') : null;
    if (stage === 'returned' && score == null) {
      try { const r = JSON.parse(s('finalReport') || '{}'); if (Number.isFinite(Number(r.totalAwarded))) score = Number(r.totalAwarded); } catch (_) {}
      if (score == null) score = n('aiScore');
    }
    const submittedAt = s('submittedAt');
    const due = Date.parse(s('reviewDueAt')) || (Date.parse(submittedAt) ? Date.parse(submittedAt) + 2 * DAY : 0);
    return {
      id: (doc.name || '').split('/').pop(), uid: s('uid'), testId: s('testId'),
      studentName: s('studentName') || 'Student', studentId: s('studentId'), section: s('studentSection'),
      class: s('studentClass') || 'Unassigned', board: s('studentBoard') || s('board') || '',
      subject: subjectName(s('subject')), chapter: s('chapter') || 'General', module: s('module') || 'Full chapter',
      test: s('testName') || 'Test', totalMarks, score,
      pct: score != null && totalMarks > 0 ? Math.round(score / totalMarks * 100) : null,
      status, stage, stageLabel: STAGES[stage], reviewMode: s('reviewMode') || 'ai',
      teacher: s('approvedByName') || s('teacherName'), assignedTeacher: s('teacherName'), assignedTeacherUid: s('teacherUid'), remark: s('teacherRemark'),
      submittedAt, approvedAt: s('approvedAt'), dueAt: due ? new Date(due).toISOString() : '',
      overdue: stage !== 'returned' && !!due && now > due, lateByMin: n('lateByMin') || 0,
      scriptPdfUrl: delivery(s('scriptPdfUrl')), checkedScriptUrl: delivery(s('checkedScriptUrl'))
    };
  }

  // Search/filter index: only human-readable fields, never file links.
  function item(r) {
    return { id: r.id, class: r.class, board: r.board, subject: r.subject, chapter: r.chapter, module: r.module, test: r.test,
      stage: r.stageLabel, studentName: r.studentName, studentId: r.studentId, section: r.section, teacher: r.teacher };
  }

  const average = list => { const scored = list.filter(r => r.pct != null); return scored.length ? Math.round(scored.reduce((a, r) => a + r.pct, 0) / scored.length) : null; };

  function students(records) {
    const map = new Map();
    records.forEach(r => {
      const key = r.uid || r.studentId || r.studentName;
      const s = map.get(key) || { uid: r.uid, studentName: r.studentName, studentId: r.studentId, class: r.class, board: r.board, section: r.section, records: [], last: '' };
      s.records.push(r);
      if ((r.submittedAt || '') > s.last) { s.last = r.submittedAt || ''; s.class = r.class; s.board = r.board || s.board; s.studentName = r.studentName; }
      map.set(key, s);
    });
    return [...map.values()].map(s => {
      const bySubject = new Map();
      s.records.forEach(r => { const list = bySubject.get(r.subject) || []; list.push(r); bySubject.set(r.subject, list); });
      const subjects = [...bySubject].map(([subject, list]) => ({ subject, count: list.length, returned: list.filter(r => r.stage === 'returned').length, average: average(list) }))
        .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject));
      return { uid: s.uid, studentName: s.studentName, studentId: s.studentId, class: s.class, board: s.board, section: s.section,
        total: s.records.length, returned: s.records.filter(r => r.stage === 'returned').length,
        pending: s.records.filter(r => r.stage !== 'returned').length, average: average(s.records), last: s.last,
        subjects, subjectNames: subjects.map(x => x.subject) };
    }).sort((a, b) => byClass(a.class, b.class) || a.studentName.localeCompare(b.studentName));
  }

  function summary(records) {
    const classes = [...new Set(records.map(r => r.class))].sort(byClass);
    const subjects = [...new Set(records.map(r => r.subject))].sort((a, b) => a.localeCompare(b));
    const cells = new Map();
    records.forEach(r => { const k = r.class + '\0' + r.subject; const list = cells.get(k) || []; list.push(r); cells.set(k, list); });
    const cell = (c, s) => { const list = cells.get(c + '\0' + s) || []; return { count: list.length, students: new Set(list.map(r => r.uid || r.studentId)).size, average: average(list), pending: list.filter(r => r.stage !== 'returned').length }; };
    return {
      total: records.length,
      returned: records.filter(r => r.stage === 'returned').length,
      pending: records.filter(r => r.stage === 'pending').length,
      checking: records.filter(r => r.stage === 'checking').length,
      overdue: records.filter(r => r.overdue).length,
      students: new Set(records.map(r => r.uid || r.studentId)).size,
      average: average(records), classes, subjects, cell
    };
  }

  function fileName(r, kind) {
    return `${r.studentName}_${r.studentId}_${r.test}${kind === 'checked' ? '_checked' : ''}`.replace(/[^a-z0-9_-]+/gi, '_') + '.pdf';
  }
  const date = iso => { const t = Date.parse(iso); return t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  const sortRecords = (list, stage) => list.slice().sort(stage === 'returned'
    ? (a, b) => (b.approvedAt || b.submittedAt).localeCompare(a.approvedAt || a.submittedAt)
    : (a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));

  const api = { FIELDS, STAGES, listUrl, parse, item, students, summary, fileName, date, sortRecords, byClass };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NTCOfflineRecords = api;
})(typeof window === 'undefined' ? null : window);
