/**
 * ════════════════════════════════════════════════════
 *  NTC Offline Test Series — Answer Script Evaluation report (shared)
 *  ──────────────────────────────────────────────────
 *  Renders the printable A4 report for an AI-checked, teacher-approved
 *  answer script, in the institute's letterhead style:
 *    1. Summary: score, section bars, question-wise chart, teacher's remark
 *    2. Question-wise marks, where the marks went, tips
 *    3. The student's own pages with red-pen marks
 *    4. Corrections & model answers (KaTeX maths)
 *  Every page carries "Checked using Trained AI models & Approved by …".
 *
 *  Used by student-dashboard.html (view / download) and
 *  teacher-dashboard.html (preview while approving).
 *
 *    NTCOfflineReport.render(container, { meta, report, approval, draft })
 *    NTCOfflineReport.download(container, fileName)   // print → Save as PDF
 * ════════════════════════════════════════════════════
 */
(function () {
  if (window.NTCOfflineReport) return;
  var PAGE_W = 794;   // A4 at 96 dpi; the whole document is zoomed to fit

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 8.5 → "8½"
  function mk(n) {
    n = Math.round((Number(n) || 0) * 2) / 2;
    var whole = Math.floor(n), frac = n - whole;
    if (!frac) return String(whole);
    return (whole ? String(whole) : '') + '½';
  }
  function fmtDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtDuration(min) {
    min = Number(min) || 0;
    if (!min) return '';
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m === 30) return (h === 1 ? '1½ hours' : h + '½ hours');
    if (h && !m) return h === 1 ? '1 hour' : h + ' hours';
    if (h) return h + ' h ' + m + ' min';
    return m + ' minutes';
  }
  function qShort(q) { return 'Q' + String(q || '').replace(/\s*\(\s*or\s*\)\s*/i, '').trim(); }

  // Minimal Markdown → HTML that leaves $…$ maths for KaTeX.
  function md(src) {
    var blocks = String(src || '').replace(/\r/g, '').split(/\n{2,}/);
    return blocks.map(function (b) {
      var lines = b.split('\n');
      var list = lines.every(function (l) { return /^\s*([-*•]|\d+[.)])\s+/.test(l); });
      var inline = function (t) {
        return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
      };
      if (list) {
        var ordered = /^\s*\d/.test(lines[0]);
        return '<' + (ordered ? 'ol' : 'ul') + '>' + lines.map(function (l) {
          return '<li>' + inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')) + '</li>';
        }).join('') + '</' + (ordered ? 'ol' : 'ul') + '>';
      }
      if (/^\s*\$\$[\s\S]*\$\$\s*$/.test(b)) return '<div class="orp-display">' + esc(b) + '</div>';
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  }

  function injectStyles() {
    if (document.getElementById('orp-styles')) return;
    var font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,600;0,700;1,400&family=Caveat:wght@600;700&display=swap';
    document.head.appendChild(font);
    var css = `
    .orp-doc{width:${PAGE_W}px;margin:0 auto;font-family:'Noto Serif',Georgia,serif;color:#1f2937;--navy:#1f3864;--navy-soft:#dfe5f1;--red:#b3261e;}
    .orp-doc *{box-sizing:border-box;}
    .orp-sheet{position:relative;width:${PAGE_W}px;min-height:1123px;background:#fff;margin:0 auto 18px;padding:34px 40px 64px;box-shadow:0 6px 24px rgba(15,23,42,.12);overflow:hidden;}
    .orp-sheet::before{content:"";position:absolute;inset:14px;border:1.5px solid var(--navy);pointer-events:none;}
    .orp-wm{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-38deg);font:700 54px 'Noto Serif',serif;color:rgba(31,56,100,.045);white-space:nowrap;pointer-events:none;letter-spacing:2px;}
    .orp-foot{position:absolute;left:40px;right:40px;bottom:26px;display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;border-top:1px solid #c9d2e3;padding-top:7px;font-size:10.5px;color:#475569;}
    .orp-foot b{color:var(--navy);}
    .orp-foot .r{text-align:right;}
    .orp-verify{display:flex;align-items:center;justify-content:center;gap:6px;font:600 9.5px 'DM Sans',system-ui,sans-serif;color:#166534;letter-spacing:.2px;}
    .orp-verify.draft{color:#b45309;}
    .orp-lh{text-align:center;border-bottom:1.5px solid var(--navy);padding-bottom:8px;margin-bottom:10px;}
    .orp-lh h1{font:700 27px 'Noto Serif',serif;color:var(--navy);letter-spacing:.5px;margin:0;}
    .orp-lh .tag{font:700 14px 'Noto Serif',serif;color:var(--navy);margin-top:2px;}
    .orp-lh .addr{font-size:10.5px;color:#334155;margin-top:3px;line-height:1.45;}
    .orp-title{text-align:center;margin:6px 0 8px;}
    .orp-title h2{font:700 17px 'Noto Serif',serif;color:var(--navy);letter-spacing:.6px;margin:0;}
    .orp-title div{font:600 12.5px 'Noto Serif',serif;color:#334155;margin-top:2px;}
    .orp-syl{background:var(--navy-soft);border-left:7px solid var(--navy);border-right:7px solid var(--navy);text-align:center;font-size:11.5px;padding:5px 10px;margin-bottom:6px;}
    .orp-info{display:grid;grid-template-columns:1.1fr 1.1fr 1fr;border-top:1px solid #c9d2e3;border-bottom:1px solid #c9d2e3;font-size:11.5px;}
    .orp-info div{padding:5px 4px;border-bottom:1px solid #e2e8f0;}
    .orp-info b{font-weight:700;}
    .orp-score{display:grid;grid-template-columns:170px 1fr;gap:18px;border:1px solid #c9d2e3;border-radius:10px;background:#f6f8fc;padding:14px 18px;margin:12px 0;}
    .orp-score .big{text-align:center;border-right:1px solid #c9d2e3;padding-right:14px;display:flex;flex-direction:column;justify-content:center;}
    .orp-score .big .n{font:700 40px/1 'Noto Serif',serif;color:var(--navy);}
    .orp-score .big .n small{font-size:20px;color:#475569;font-weight:600;}
    .orp-score .big .p{font:700 16px 'Noto Serif',serif;color:var(--navy);margin-top:6px;}
    .orp-score .big .c{font-size:9.5px;color:#475569;margin-top:6px;line-height:1.35;}
    .orp-secs{display:flex;flex-direction:column;justify-content:center;gap:9px;}
    .orp-sec{display:grid;grid-template-columns:190px 1fr 58px;align-items:center;gap:10px;font-size:11.5px;}
    .orp-sec b{color:#111827;}
    .orp-sec span.l{color:#475569;}
    .orp-bar{height:11px;background:var(--navy-soft);border-radius:6px;overflow:hidden;}
    .orp-bar i{display:block;height:100%;background:var(--navy);border-radius:6px;}
    .orp-sec .v{text-align:right;font-weight:700;}
    .orp-band{background:var(--navy);color:#fff;font:700 12.5px 'Noto Serif',serif;letter-spacing:.3px;padding:6px 8px;margin:14px 0 6px;text-transform:uppercase;}
    .orp-cap{font-size:10.5px;font-style:italic;color:#475569;margin-bottom:6px;}
    .orp-remark{border-left:5px solid var(--navy);background:#f6f8fc;padding:10px 14px;margin-top:12px;font-size:11.5px;line-height:1.55;}
    .orp-remark h4{font:700 13px 'Noto Serif',serif;color:var(--navy);margin:0 0 5px;}
    .orp-remark .sig{text-align:right;font-style:italic;color:#475569;margin-top:4px;}
    .orp-stamp{margin-top:14px;display:flex;align-items:center;gap:12px;border:1.5px dashed #16a34a;border-radius:10px;padding:9px 14px;background:#f0fdf4;font:600 12px 'DM Sans',system-ui,sans-serif;color:#14532d;}
    .orp-stamp .ic{width:30px;height:30px;border-radius:50%;background:#16a34a;color:#fff;display:grid;place-items:center;font-size:16px;flex:none;}
    .orp-stamp.draft{border-color:#d97706;background:#fffbeb;color:#92400e;}
    .orp-stamp.draft .ic{background:#d97706;}
    .orp-table{width:100%;border-collapse:collapse;font-size:11px;}
    .orp-table th{background:var(--navy-soft);color:var(--navy);text-align:left;padding:6px 7px;border:1px solid #c9d2e3;font-weight:700;}
    .orp-table td{padding:6px 7px;border:1px solid #d7deea;vertical-align:top;line-height:1.4;}
    .orp-table td.c{text-align:center;}
    .orp-table td.m{text-align:center;font-weight:700;color:var(--navy);}
    .orp-table td.m.zero{color:var(--red);}
    .orp-table tr.tot td{background:var(--navy-soft);font-weight:700;}
    /* The portals turn tables into stacked cards on phones (portal-shell.css);
       the report is a fixed A4 page, so keep it a real table. */
    body[data-portal] .orp-doc table.orp-table{width:100%!important;display:table!important;}
    body[data-portal] .orp-doc .orp-table thead{display:table-header-group!important;}
    body[data-portal] .orp-doc .orp-table tbody{display:table-row-group!important;}
    body[data-portal] .orp-doc .orp-table tr{display:table-row!important;border:0!important;border-radius:0!important;padding:0!important;margin:0!important;background:transparent!important;}
    body[data-portal] .orp-doc .orp-table td,body[data-portal] .orp-doc .orp-table th{display:table-cell!important;padding:6px 7px!important;border:1px solid #d7deea!important;font-size:11px!important;min-height:0!important;width:auto;overflow-wrap:normal!important;}
    body[data-portal] .orp-doc .orp-table th{border-color:#c9d2e3!important;}
    body[data-portal] .orp-doc .orp-table tr.tot td{background:var(--navy-soft)!important;}
    .orp-loss h3{font:700 13.5px 'Noto Serif',serif;color:var(--navy);margin:14px 0 6px;}
    .orp-loss .row{display:grid;grid-template-columns:230px 1fr 40px;gap:12px;align-items:center;margin-bottom:6px;font-size:11px;}
    .orp-loss .row small{display:block;color:#475569;font-size:9.5px;}
    .orp-loss .bar{height:10px;background:#eef1f6;border-radius:6px;overflow:hidden;}
    .orp-loss .bar i{display:block;height:100%;background:var(--red);border-radius:6px;}
    .orp-loss .v{text-align:right;font-weight:700;}
    .orp-notes{font-size:10px;color:#475569;margin-top:8px;line-height:1.45;}
    .orp-tips{border:1.5px solid var(--navy);border-radius:10px;background:#f6f8fc;padding:12px 16px;margin-top:14px;}
    .orp-tips h4{font:700 13.5px 'Noto Serif',serif;color:var(--navy);margin:0 0 6px;}
    .orp-tips ol{margin:0;padding-left:20px;font-size:11.5px;line-height:1.6;}
    .orp-shead{display:flex;justify-content:space-between;border-bottom:1.5px solid var(--navy);padding-bottom:6px;margin-bottom:10px;font:700 12.5px 'Noto Serif',serif;color:var(--navy);}
    .orp-script{position:relative;border:1px solid #c9d2e3;background:#f8fafc;}
    .orp-script img{display:block;width:100%;height:auto;}
    .orp-pen{position:absolute;font-family:'Caveat',cursive;font-weight:700;color:#c62828;line-height:1.05;text-shadow:0 0 2px #fff,0 0 3px #fff;pointer-events:none;}
    .orp-pen.tick,.orp-pen.cross{font-size:30px;transform:translate(-10%,-60%);}
    .orp-pen.score{border:2.5px solid #c62828;border-radius:50%;padding:1px 10px;font-size:22px;white-space:nowrap;transform:translateY(-15%);background:rgba(255,255,255,.55);}
    .orp-pen.note{font-size:18px;max-width:42%;}
    .orp-corr{margin-bottom:16px;break-inside:avoid;}
    .orp-corr .h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;border-bottom:1px solid #c9d2e3;padding-bottom:3px;margin-bottom:6px;}
    .orp-corr .h b{font:700 13px 'Noto Serif',serif;color:var(--navy);}
    .orp-corr .h span{font-size:11px;font-weight:700;color:var(--navy);white-space:nowrap;}
    .orp-corr .h span.na{color:var(--red);}
    .orp-wrong{background:#fdecec;border-left:4px solid var(--red);padding:6px 10px;font-size:11px;line-height:1.5;margin-bottom:6px;}
    .orp-sol{font-size:11.5px;line-height:1.6;}
    .orp-sol p{margin:0 0 6px;}
    .orp-sol ul,.orp-sol ol{margin:0 0 6px;padding-left:20px;}
    .orp-display{margin:4px 0 8px;overflow-x:auto;}
    .orp-sol .katex{font-size:1.05em;}
    @media print{
      @page{size:A4;margin:0;}
      html,body{background:#fff!important;}
      body *{visibility:hidden!important;}
      .orp-print,.orp-print *{visibility:visible!important;}
      .orp-print{position:absolute;left:0;top:0;width:100%;zoom:1!important;}
      .orp-print .orp-doc{zoom:1!important;}
      .orp-sheet{box-shadow:none;margin:0;width:210mm;min-height:297mm;break-after:page;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .orp-sheet:last-child{break-after:auto;}
    }`;
    var s = document.createElement('style');
    s.id = 'orp-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function chart(questions) {
    var qs = questions.filter(function (q) { return q.max > 0; });
    if (!qs.length) return '';
    var W = 700, H = 280, L = 44, R = 10, T = 18, B = 70, ch = H - T - B;
    var slot = (W - L - R) / qs.length, bw = Math.min(26, slot * 0.5);
    var g = '';
    [0, 25, 50, 75, 100].forEach(function (p) {
      var y = T + ch - ch * p / 100;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#e2e8f0"/>';
      g += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" font-size="11" text-anchor="end" fill="#475569">' + p + '%</text>';
    });
    qs.forEach(function (q, i) {
      var cx = L + slot * i + slot / 2, pct = q.max ? q.awarded / q.max : 0, h = ch * pct;
      g += '<rect x="' + (cx - bw / 2) + '" y="' + T + '" width="' + bw + '" height="' + ch + '" fill="#dfe5f1"/>';
      if (h > 0) g += '<rect x="' + (cx - bw / 2) + '" y="' + (T + ch - h) + '" width="' + bw + '" height="' + h + '" fill="#1f3864"/>';
      g += '<text x="' + cx + '" y="' + (T + ch - h - 5) + '" font-size="11" font-weight="700" text-anchor="middle" fill="#1f2937">' + esc(mk(q.awarded) + '/' + mk(q.max)) + '</text>';
      if (q.status === 'not_attempted') {
        g += '<text transform="translate(' + (cx + 4) + ',' + (T + ch - 30) + ') rotate(-90)" font-size="10" font-style="italic" fill="#64748b">not attempted</text>';
      }
      g += '<text x="' + cx + '" y="' + (T + ch + 16) + '" font-size="12" font-weight="700" text-anchor="middle" fill="#1f2937">' + esc(qShort(q.q)) + '</text>';
    });
    // Section brackets under the axis.
    var runs = [];
    qs.forEach(function (q, i) {
      var s = q.section || '';
      if (!runs.length || runs[runs.length - 1].s !== s) runs.push({ s: s, a: i, b: i });
      else runs[runs.length - 1].b = i;
    });
    if (runs.length > 1 || (runs[0] && runs[0].s)) {
      runs.forEach(function (r) {
        if (!r.s) return;
        var x1 = L + slot * r.a + 6, x2 = L + slot * (r.b + 1) - 6, y = T + ch + 30;
        g += '<path d="M' + x1 + ' ' + (y - 5) + 'V' + y + 'H' + x2 + 'V' + (y - 5) + '" fill="none" stroke="#94a3b8"/>';
        g += '<text x="' + ((x1 + x2) / 2) + '" y="' + (y + 15) + '" font-size="11" text-anchor="middle" fill="#475569">Section ' + esc(r.s) + '</text>';
      });
    }
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ch) + '" y2="' + (T + ch) + '" stroke="#94a3b8"/>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Question-wise marks">' + g + '</svg>';
  }

  function buildSheets(data) {
    var meta = data.meta || {}, r = data.report || {}, ap = data.approval || {};
    var qs = r.questions || [];
    var name = meta.studentName || r.studentNameOnScript || 'Student';
    var first = name.split(/\s+/)[0];
    var clsLine = (meta.board ? meta.board + ' ' : '') + 'Class ' + (meta.studentClass || '') + ' ' + (meta.subject || '');
    var approved = !data.draft && ap.name;
    var verifyText = approved
      ? '✓ Checked using Trained AI models &amp; Approved by ' + esc(ap.name)
      : '⏳ Checked using Trained AI models · awaiting teacher approval';
    var sheets = [];

    // ── 1. Summary ──
    var secRows = (r.sections || []).map(function (s) {
      var p = s.max ? Math.round(s.awarded / s.max * 100) : 0;
      return '<div class="orp-sec"><div><b>' + esc(s.name) + '</b> <span class="l">' + esc(s.label) + '</span></div>' +
        '<div class="orp-bar"><i style="width:' + p + '%"></i></div><div class="v">' + mk(s.awarded) + ' / ' + mk(s.max) + '</div></div>';
    }).join('') || '<div style="font-size:11.5px;color:#475569;">' + qs.length + ' questions checked</div>';
    sheets.push(
      '<div class="orp-lh"><h1>THE NEWTOWN CLASSES</h1><div class="tag">Class 7–12 | Olympiads | JEE | NEET</div>' +
      '<div class="addr">DD-80, Street No-302, Action Area 1, Opposite Newtown School Gate No. 4, Above Annapurna Sweets, Newtown, Kolkata<br>' +
      'Ph: +91 9903461361 | thenewtownclasses@gmail.com | www.thenewtownclasses.com</div></div>' +
      '<div class="orp-title"><h2>ANSWER SCRIPT EVALUATION</h2><div>' + esc(meta.testName || 'Test') + ' — ' + esc(meta.subject || '') +
      ' · Class ' + esc(meta.studentClass || '') + (meta.board ? ' (' + esc(meta.board) + ')' : '') + '</div></div>' +
      (meta.chapter ? '<div class="orp-syl"><b>Syllabus:</b> ' + esc(meta.chapter) + '</div>' : '') +
      '<div class="orp-info">' +
        '<div><b>Student:</b> ' + esc(name) + '</div>' +
        '<div>' + (meta.school ? '<b>School:</b> ' + esc(meta.school) : (meta.studentId ? '<b>Student ID:</b> ' + esc(meta.studentId) : '')) + '</div>' +
        '<div>' + (meta.school && meta.studentId ? '<b>Student ID:</b> ' + esc(meta.studentId) : '') + '</div>' +
        '<div><b>Maximum Marks:</b> ' + mk(r.totalMax) + '</div>' +
        '<div><b>Time:</b> ' + esc(fmtDuration(meta.durationMin)) + '</div>' +
        '<div><b>Checked on:</b> ' + esc(fmtDate(ap.at || meta.checkedAt)) + '</div>' +
      '</div>' +
      '<div class="orp-score"><div class="big"><div class="n">' + mk(r.totalAwarded) + ' <small>/ ' + mk(r.totalMax) + '</small></div>' +
        '<div class="p">' + (Math.round((r.pct || 0) * 10) / 10) + ' %</div>' +
        (r.choiceNote ? '<div class="c">' + esc(r.choiceNote) + '</div>' : '') + '</div>' +
        '<div class="orp-secs">' + secRows + '</div></div>' +
      '<div class="orp-band">Question-wise performance</div>' +
      '<div class="orp-cap">Each dark bar shows the marks scored as a share of that question’s maximum; the light bar behind it is full marks.</div>' +
      chart(qs) +
      (r.teacherRemark ? '<div class="orp-remark"><h4>Teacher’s remark</h4>' + esc(r.teacherRemark) +
        '<div class="sig">— ' + esc(approved ? ap.name : (meta.subject ? meta.subject + ' Faculty' : 'Faculty')) + ', TNC</div></div>' : '') +
      '<div class="orp-stamp' + (approved ? '' : ' draft') + '"><span class="ic">' + (approved ? '✓' : '…') + '</span><div>' +
        (approved
          ? 'Checked using Trained AI models &amp; Approved by <b>' + esc(ap.name) + '</b>' + (ap.at ? ' on ' + esc(fmtDate(ap.at)) : '')
          : 'Checked using Trained AI models · <b>draft — awaiting teacher approval</b>') +
      '</div></div>'
    );

    // ── 2. Question-wise marks, where the marks went, tips ──
    var lost = Math.max(0, (r.totalMax || 0) - (r.totalAwarded || 0));
    var rows = qs.map(function (q) {
      return '<tr><td class="c">' + esc(q.q) + '</td><td>' + esc(q.topic) + '</td><td class="c">' + mk(q.max) + '</td>' +
        '<td class="m' + (q.awarded <= 0 ? ' zero' : '') + '">' + mk(q.awarded) + '</td><td>' + esc(q.remark) + '</td></tr>';
    }).join('');
    var maxLoss = Math.max.apply(null, [1].concat((r.lossCategories || []).map(function (l) { return l.marks; })));
    var loss = (r.lossCategories || []).map(function (l) {
      return '<div class="row"><div>' + esc(l.category) + '<small>' + esc(l.refs) + '</small></div>' +
        '<div class="bar"><i style="width:' + Math.round(l.marks / Math.max(maxLoss, lost || 1) * 100) + '%"></i></div><div class="v">' + mk(l.marks) + '</div></div>';
    }).join('');
    var tips = (r.tips || []).map(function (t) {
      return '<li><b>' + esc(t.title) + '</b> ' + esc(t.detail) + '</li>';
    }).join('');
    sheets.push(
      '<div class="orp-band" style="margin-top:0;">Question-wise marks</div>' +
      '<table class="orp-table"><thead><tr><th style="width:52px;text-align:center;">Q</th><th style="width:170px;">Topic</th>' +
      '<th style="width:40px;text-align:center;">Max</th><th style="width:50px;text-align:center;">Marks</th><th>Examiner’s remark</th></tr></thead>' +
      '<tbody>' + rows + '<tr class="tot"><td></td><td>Total</td><td class="c">' + mk(r.totalMax) + '</td><td class="m">' + mk(r.totalAwarded) +
      '</td><td>' + (lost ? mk(lost) + ' marks lost' + (loss ? ' — breakdown below' : '') : 'Full marks') + '</td></tr></tbody></table>' +
      (loss ? '<div class="orp-loss"><h3>Where the ' + mk(lost) + ' marks went</h3>' + loss + '</div>' : '') +
      (r.markingNotes ? '<div class="orp-notes"><b>Marking notes:</b> ' + esc(r.markingNotes) + '</div>' : '') +
      (tips ? '<div class="orp-tips"><h4>Before you hand in your next paper</h4><ol>' + tips + '</ol></div>' : '')
    );

    // ── 3. Checked script pages with red-pen marks ──
    var pages = meta.pageUrls || [];
    pages.forEach(function (url, i) {
      var marks = (r.annotations || []).filter(function (a) { return a.page === i + 1; }).map(function (a) {
        var y0 = a.box[0] / 10, x0 = a.box[1] / 10, y1 = a.box[2] / 10, x1 = a.box[3] / 10;
        if (a.kind === 'tick' || a.kind === 'cross') {
          return '<span class="orp-pen ' + a.kind + '" style="left:' + Math.min(95, x1) + '%;top:' + ((y0 + y1) / 2) + '%">' + (a.kind === 'tick' ? '✓' : '✗') + '</span>';
        }
        if (a.kind === 'score') {
          return '<span class="orp-pen score" style="left:' + x0 + '%;top:' + y0 + '%">' + esc(a.text) + '</span>';
        }
        return '<span class="orp-pen note" style="left:' + Math.min(70, x0) + '%;top:' + y0 + '%">' + esc(a.text) + '</span>';
      }).join('');
      sheets.push(
        '<div class="orp-shead"><span>THE NEWTOWN CLASSES</span><span>Checked Answer Script · ' + esc(first) + ' · Sheet ' + (i + 1) + ' of ' + pages.length + '</span></div>' +
        '<div class="orp-script"><img src="' + esc(url) + '" alt="Answer script page ' + (i + 1) + '">' + marks + '</div>'
      );
    });

    // ── 4. Corrections & model answers (about three per sheet) ──
    var corr = r.corrections || [];
    var chunk = [], weight = 0, firstChunk = true;
    function flush() {
      if (!chunk.length) return;
      sheets.push((firstChunk
        ? '<div class="orp-band" style="margin-top:0;">Corrections &amp; model answers</div><div class="orp-cap">Only the questions and parts where marks were lost are worked here. Ticked work on the script is not repeated.</div>'
        : '') + chunk.join(''));
      firstChunk = false; chunk = []; weight = 0;
    }
    corr.forEach(function (c) {
      var html = '<div class="orp-corr"><div class="h"><b>Question ' + esc(c.q) + (c.title ? ' — ' + esc(c.title) : '') + '</b>' +
        (c.notAttempted ? '<span class="na">Not attempted · 0 / ' + mk(c.max) + '</span>' : '<span>Scored ' + mk(c.scored) + ' / ' + mk(c.max) + '</span>') + '</div>' +
        (c.whatWentWrong ? '<div class="orp-wrong"><b>What went wrong:</b> ' + esc(c.whatWentWrong) + '</div>' : '') +
        '<div class="orp-sol">' + md(c.solution) + '</div></div>';
      var w = 260 + (c.solution || '').length + (c.whatWentWrong || '').length;
      if (weight && weight + w > 3000) flush();
      chunk.push(html); weight += w;
    });
    flush();
    return { sheets: sheets, footer: esc(name) + ' · ' + esc(clsLine.trim()) + ' — Answer Script Evaluation', verifyText: verifyText, approved: approved };
  }

  function render(container, data) {
    injectStyles();
    var built = buildSheets(data || {});
    var n = built.sheets.length;
    container.innerHTML = '<div class="orp-doc">' + built.sheets.map(function (inner, i) {
      return '<section class="orp-sheet"><div class="orp-wm">www.thenewtownclasses.com</div>' + inner +
        '<div class="orp-foot"><b>The Newtown Classes</b><div style="text-align:center;">' + built.footer +
        '<div class="orp-verify' + (built.approved ? '' : ' draft') + '">' + built.verifyText + '</div></div>' +
        '<div class="r">Page ' + (i + 1) + ' of ' + n + '</div></div></section>';
    }).join('') + '</div>';
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(container, {
          delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true },
                       { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }],
          throwOnError: false
        });
      } catch (_) {}
    }
    fit(container);
    if (!container._orpResize) {
      container._orpResize = function () { fit(container); };
      window.addEventListener('resize', container._orpResize);
    }
  }

  // Scale the fixed-width A4 pages to the available width (phones).
  function fit(container) {
    var doc = container.querySelector('.orp-doc');
    if (!doc) return;
    var w = container.clientWidth || PAGE_W;
    doc.style.zoom = String(Math.min(1, w / PAGE_W));
  }

  // Opens the print dialog with only the report visible → "Save as PDF".
  function download(container, fileName) {
    var oldTitle = document.title;
    if (fileName) document.title = fileName;
    container.classList.add('orp-print');
    var imgs = Array.prototype.slice.call(container.querySelectorAll('img'));
    Promise.all(imgs.map(function (im) {
      return im.complete ? null : new Promise(function (res) { im.onload = im.onerror = res; });
    })).then(function () {
      var done = function () {
        container.classList.remove('orp-print'); document.title = oldTitle;
        window.removeEventListener('afterprint', done);
      };
      window.addEventListener('afterprint', done);
      window.print();
      setTimeout(done, 2000);
    });
  }

  window.NTCOfflineReport = { render: render, download: download, fit: fit, markText: mk, md: md };
})();
