/**
 * ════════════════════════════════════════════════════
 *  NTC Answer-Sheet Report renderer  (shared)
 *  ──────────────────────────────────────────────────
 *  Renders the AI subjective-grading report (ClassMap-style):
 *  header + grade badge, marks breakdown grid, per-answer feedback
 *  markers, topic-proficiency bars, and a ranked study plan.
 *
 *  Used by BOTH student-dashboard.html (released report) and
 *  teacher-dashboard.html (review preview). Self-contained styling
 *  (prefix .asr-), injected once, with a print stylesheet.
 *
 *  Usage:
 *    NTCAnswerSheetReport.injectStyles();
 *    container.innerHTML = NTCAnswerSheetReport.render({
 *      studentName, studentClass, subject, testName, date, grading, pageUrls
 *    });
 *    NTCAnswerSheetReport.print(reportEl);   // print-to-PDF one element
 * ════════════════════════════════════════════════════
 */
(function () {
  if (window.NTCAnswerSheetReport) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(n) { return (Math.round(Number(n) * 100) / 100).toString(); }
  function gradeColor(g) {
    return ({ 'A+': '#059669', 'A': '#0ea5e9', 'B+': '#2563eb', 'B': '#d97706', 'C': '#ea580c', 'D': '#dc2626' })[g] || '#003087';
  }
  function verdictColor(v) {
    return v === 'full' ? '#059669' : v === 'partial' ? '#d97706' : '#dc2626';
  }
  function verdictBg(v) {
    return v === 'full' ? '#f0fdf4' : v === 'partial' ? '#fffbeb' : '#fff5f5';
  }

  function injectStyles() {
    if (document.getElementById('asr-styles')) return;
    var css = `
    .asr { font-family: 'DM Sans', system-ui, sans-serif; color: #1e293b; max-width: 860px; margin: 0 auto; }
    .asr * { box-sizing: border-box; }
    .asr-head { background: linear-gradient(135deg,#003087,#0ea5e9); color:#fff; border-radius:18px; padding:1.4rem 1.5rem; display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; }
    .asr-head .asr-meta-grid { display:grid; grid-template-columns:repeat(2,auto); gap:.15rem 1.4rem; font-size:.8rem; }
    .asr-head .asr-meta-grid b { opacity:.7; font-weight:600; }
    .asr-head h2 { font-family:'Syne',sans-serif; font-size:1.15rem; margin:0 0 .5rem; }
    .asr-badge { text-align:center; background:rgba(255,255,255,.14); border-radius:16px; padding:.9rem 1.2rem; min-width:140px; }
    .asr-badge .g { font-size:2rem; font-weight:800; line-height:1; }
    .asr-badge .s { font-size:1.5rem; font-weight:800; margin-top:.25rem; }
    .asr-badge .s small { font-size:1rem; opacity:.75; }
    .asr-badge .p { font-size:.82rem; opacity:.85; margin-top:.1rem; }
    .asr-section-title { font-family:'Syne',sans-serif; font-weight:800; color:#003087; font-size:1rem; margin:1.6rem 0 .8rem; display:flex; align-items:center; gap:.4rem; }
    .asr-legend { font-size:.72rem; color:#64748b; font-weight:500; margin-left:auto; }
    .asr-breakdown { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:.5rem; }
    .asr-mk { border-radius:10px; padding:.5rem .6rem; text-align:center; border:1px solid rgba(0,48,135,.08); }
    .asr-mk .l { font-size:.72rem; color:#546e7a; font-weight:600; }
    .asr-mk .v { font-size:1rem; font-weight:800; }
    .asr-ans { border:1.5px solid; border-radius:12px; padding:1rem; margin-bottom:.7rem; }
    .asr-ans .top { display:flex; justify-content:space-between; align-items:center; gap:.6rem; margin-bottom:.5rem; }
    .asr-ans .qlabel { font-weight:800; color:#003087; }
    .asr-ans .marks { font-weight:800; }
    .asr-ans .verdict { font-size:.66rem; font-weight:700; text-transform:uppercase; padding:.12rem .5rem; border-radius:999px; color:#fff; }
    .asr-ans .topic { font-size:.72rem; color:#64748b; margin-bottom:.4rem; }
    .asr-marker { display:flex; align-items:flex-start; gap:.45rem; font-size:.82rem; padding:.18rem 0; }
    .asr-marker .ic { flex-shrink:0; font-weight:800; }
    .asr-comment { margin-top:.5rem; font-size:.82rem; color:#334155; background:rgba(0,48,135,.04); border-radius:8px; padding:.45rem .7rem; }
    .asr-topics { display:flex; flex-direction:column; gap:.5rem; }
    .asr-topic { display:grid; grid-template-columns:1fr auto; gap:.2rem .8rem; align-items:center; }
    .asr-topic .name { font-size:.82rem; font-weight:600; color:#334155; }
    .asr-topic .pct { font-size:.8rem; font-weight:700; }
    .asr-bar { grid-column:1/-1; height:8px; background:#eef2ff; border-radius:99px; overflow:hidden; }
    .asr-bar > span { display:block; height:100%; border-radius:99px; }
    .asr-plan { counter-reset:asr; display:flex; flex-direction:column; gap:.55rem; }
    .asr-plan .row { display:flex; gap:.7rem; align-items:flex-start; background:#fff; border:1px solid rgba(0,48,135,.1); border-radius:12px; padding:.7rem .9rem; }
    .asr-plan .rank { background:#003087; color:#fff; border-radius:8px; min-width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.85rem; flex-shrink:0; }
    .asr-plan .row.first .rank { background:#dc2626; }
    .asr-plan .t { font-weight:700; color:#003087; font-size:.9rem; }
    .asr-plan .a { font-size:.8rem; color:#546e7a; }
    .asr-pages { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:.5rem; }
    .asr-pages a { display:block; border:1px solid rgba(0,48,135,.12); border-radius:10px; overflow:hidden; }
    .asr-pages img { display:block; width:100%; height:120px; object-fit:cover; }
    .asr-foot { text-align:center; color:#90a4ae; font-size:.72rem; margin-top:1.5rem; }
    @media (max-width:560px){
      .asr-head { padding:1.1rem; }
      .asr-head h2 { font-size:1rem; }
      .asr-badge { min-width:120px; padding:.7rem .9rem; }
      .asr-breakdown { grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); }
    }
    @media print {
      body * { visibility:hidden; }
      .asr-print, .asr-print * { visibility:visible; }
      .asr-print { position:absolute; left:0; top:0; width:100%; }
      .asr-head { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .asr-ans, .asr-plan .row { break-inside:avoid; }
    }`;
    var s = document.createElement('style');
    s.id = 'asr-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function render(data) {
    data = data || {};
    var g = data.grading || {};
    var parts = g.parts || [];
    var pct = g.pct != null ? g.pct : 0;
    var grade = g.grade || '';
    var gc = gradeColor(grade);

    var head = `
      <div class="asr-head">
        <div>
          <h2>Assessment Report</h2>
          <div class="asr-meta-grid">
            <div><b>Student</b><br>${esc(data.studentName || '—')}</div>
            <div><b>Class</b><br>${esc(data.studentClass || '—')}</div>
            <div><b>Subject</b><br>${esc(data.subject || '—')}</div>
            <div><b>Test</b><br>${esc(data.testName || '—')}</div>
            <div><b>Date</b><br>${esc(data.date || new Date().toLocaleDateString('en-IN'))}</div>
            <div><b>Powered by</b><br>NewTown Classes AI</div>
          </div>
        </div>
        <div class="asr-badge">
          <div class="g" style="color:${gc};background:#fff;border-radius:10px;padding:.1rem .5rem;display:inline-block;">${esc(grade)}</div>
          <div class="s">${fmt(g.totalAwarded || 0)}<small>/${fmt(g.totalMax || 0)}</small></div>
          <div class="p">${pct}%</div>
        </div>
      </div>`;

    var breakdown = `
      <div class="asr-section-title">📊 Marks Breakdown
        <span class="asr-legend">● full ● partial ● low/zero</span>
      </div>
      <div class="asr-breakdown">
        ${parts.map(function (p) {
          var c = verdictColor(p.verdict);
          return `<div class="asr-mk" style="background:${verdictBg(p.verdict)};border-color:${c}33;">
            <div class="l">Q${esc(p.label)}</div>
            <div class="v" style="color:${c};">${fmt(p.awarded)}/${fmt(p.max)}</div>
          </div>`;
        }).join('')}
      </div>`;

    var feedback = `
      <div class="asr-section-title">📝 Answer-by-Answer Feedback</div>
      ${parts.map(function (p) {
        var c = verdictColor(p.verdict);
        return `<div class="asr-ans" style="border-color:${c}44;background:${verdictBg(p.verdict)};">
          <div class="top">
            <span class="qlabel">Q${esc(p.label)}</span>
            <span><span class="verdict" style="background:${c};">${esc(p.verdict)}</span>
            <span class="marks" style="color:${c};margin-left:.5rem;">${fmt(p.awarded)}/${fmt(p.max)}</span></span>
          </div>
          ${p.topic ? `<div class="topic">Topic: ${esc(p.topic)}</div>` : ''}
          ${(p.markers || []).map(function (m) {
            return `<div class="asr-marker"><span class="ic" style="color:${m.ok ? '#059669' : '#dc2626'};">${m.ok ? '✓' : '✗'}</span><span><b>${esc(m.code)}</b> ${esc(m.text)}</span></div>`;
          }).join('')}
          ${p.comment ? `<div class="asr-comment">💬 ${esc(p.comment)}</div>` : ''}
        </div>`;
      }).join('')}`;

    var topics = (g.topicProficiency && g.topicProficiency.length) ? `
      <div class="asr-section-title">🎯 Topic Proficiency</div>
      <div class="asr-topics">
        ${g.topicProficiency.map(function (t) {
          var col = t.pct >= 70 ? '#059669' : t.pct >= 40 ? '#d97706' : '#dc2626';
          return `<div class="asr-topic">
            <span class="name">${esc(t.topic)}</span>
            <span class="pct" style="color:${col};">${t.pct}%</span>
            <div class="asr-bar"><span style="width:${Math.max(3, t.pct)}%;background:${col};"></span></div>
          </div>`;
        }).join('')}
      </div>` : '';

    var plan = (g.studyPlan && g.studyPlan.length) ? `
      <div class="asr-section-title">📚 Your Study Plan <span class="asr-legend">ranked by marks impact</span></div>
      <div class="asr-plan">
        ${g.studyPlan.slice().sort(function (a, b) { return (a.rank || 99) - (b.rank || 99); }).map(function (s, i) {
          return `<div class="row ${i === 0 ? 'first' : ''}">
            <div class="rank">${s.rank || (i + 1)}</div>
            <div><div class="t">${esc(s.topic)}</div><div class="a">${esc(s.action)}</div></div>
          </div>`;
        }).join('')}
      </div>` : '';

    var pages = (data.pageUrls && data.pageUrls.length && data.showPages !== false) ? `
      <div class="asr-section-title">📄 Submitted Answer Sheet</div>
      <div class="asr-pages">
        ${data.pageUrls.map(function (u, i) { return `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Page ${i + 1}" loading="lazy"></a>`; }).join('')}
      </div>` : '';

    return `<div class="asr">${head}${breakdown}${feedback}${topics}${plan}${pages}
      <div class="asr-foot">Report generated by The NewTown Classes AI · ${esc(data.date || new Date().toLocaleDateString('en-IN'))} · Confidential — for student &amp; parent use only</div>
    </div>`;
  }

  // Print one report element to PDF (adds a temporary .asr-print marker).
  function print(el) {
    if (!el) { window.print(); return; }
    el.classList.add('asr-print');
    var cleanup = function () { el.classList.remove('asr-print'); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 1500);
  }

  window.NTCAnswerSheetReport = { injectStyles: injectStyles, render: render, print: print };
})();
