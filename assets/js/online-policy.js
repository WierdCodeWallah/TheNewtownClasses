/* Online Test Series (all-India) rules shared by the portal and the Netlify
   functions: price, profile validation, subject keys and leaderboard maths.
   Pure functions only: no network, no storage. */
(function (root) {
  'use strict';
  // Chapter-wise tests ₹299, full mock tests ₹499. A test marked free costs nothing.
  const PRICES = { chapter: 299, mock: 499 };
  // Regular prices, shown struck through next to the price above.
  const LIST_PRICES = { chapter: 399, mock: 699 };
  const KINDS = { chapter: 'Chapter-wise test', mock: 'Full mock test' };
  const PRICE_INR = PRICES.mock;
  // Fixed paper format per type: marks, writing time, and the extra minutes to
  // scan and upload the answers after the timer ends.
  const PAPER = { chapter: { marks: 40, durationMin: 90, graceMin: 10 }, mock: { marks: 80, durationMin: 180, graceMin: 20 } };
  const paperFor = kind => PAPER[kind === 'mock' || kind === 'package' ? 'mock' : 'chapter'];
  // Online students get one free full mock on a subject they choose.
  // Enrolled TNC students get every test free, so no free-mock claim is needed.
  const FREE_MOCKS = { online: 1, enrolled: 0 };
  // Custom module tests (Classes 7–12): the student picks chapters; the team
  // makes one paper per subject. ₹199 a chapter for the first 4, ₹150 after.
  // minPerPaper: each subject's paper needs at least 2 chapters (one chapter = a chapter-wise test).
  // Picking every chapter of a subject makes that paper a Custom full mock at
  // a flat fullMock price (when that is cheaper than its chapters).
  const MODULE = { classes: ['7', '8', '9', '10', '11', '12'], first: 199, firstCount: 4, rest: 150, maxChapters: 40, readyHours: 24, minPerPaper: 2, fullMock: 699 };
  // Mock packs: a set of full-syllabus mocks, one a week at a fixed day and time.
  // Each pack has its own price (e.g. 8 mocks ₹3199, 4 mocks ₹1699); presets below.
  const PACK_PRESETS = [{ mocks: 8, priceInr: 3199 }, { mocks: 4, priceInr: 1699 }];
  const PACK_REMIND_DAYS = 3;
  const PACK_CLASSES = ['9', '10', '11', '12'];   // mock packs are offered to Classes 9–12 only   // admins are reminded this many days before a mock opens
  // Weekly schedule: first date 'YYYY-MM-DD' + time 'HH:MM' (India time).
  function packSchedule(firstDate, time, count) {
    const start = Date.parse(`${firstDate}T${time || '10:00'}:00+05:30`);
    if (!Number.isFinite(start)) return [];
    return Array.from({ length: Math.max(0, Math.min(52, Number(count) || 0)) }, (_, i) => new Date(start + i * 7 * 86400000).toISOString());
  }
  // Price of n chapters at the per-chapter rate. TNC students order free (the
  // server charges ₹0); pass enrolled = true to get 0.
  function modulePrice(count, enrolled) {
    if (enrolled) return 0;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const a = Math.min(n, MODULE.firstCount);
    return a * MODULE.first + (n - a) * MODULE.rest;
  }
  // A subject's paper is a Custom full mock when every chapter is picked and
  // the flat price is lower than paying for its chapters.
  const isFullMock = (picked, inBook) => Number(inBook) > 0 && Number(picked) === Number(inBook) && modulePrice(inBook) > MODULE.fullMock;
  // Whole cart: papers [{ count, full }]. Full mocks cost MODULE.fullMock each;
  // every other chapter is priced together at the per-chapter rate.
  // listInr is what the full mocks' chapters would cost (shown struck through).
  function cartPrice(papers, enrolled) {
    const list = Array.isArray(papers) ? papers : [];
    const full = list.filter(p => p && p.full), chapters = list.filter(p => p && !p.full).reduce((n, p) => n + (Number(p.count) || 0), 0);
    const chapterInr = modulePrice(chapters), fullInr = full.length * MODULE.fullMock;
    const listInr = full.reduce((n, p) => n + modulePrice(p.count), 0);
    return { totalInr: enrolled ? 0 : chapterInr + fullInr, chapters, chapterInr, fullCount: full.length, fullInr, fullListInr: listInr };
  }
  // Each paper's share of a cart's price (for the per-subject request records).
  function paperValues(papers) {
    const list = Array.isArray(papers) ? papers : [], c = cartPrice(list);
    return list.map(p => p.full ? MODULE.fullMock : c.chapters ? c.chapterInr * (Number(p.count) || 0) / c.chapters : 0);
  }
  const CLASSES = ['7', '8', '9', '10', '11', '12'];
  const BOARDS = ['CBSE', 'ICSE', 'State Board', 'Other'];
  const SUBJECTS = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Science', 'Computer', 'English'];
  const TARGETS = ['School exams', 'NEET', 'JEE', 'Olympiad', 'Other'];
  const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'];
  const RELATIONS = ['Father', 'Mother', 'Guardian'];
  const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
    'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra',
    'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

  // Subjects by board: CBSE studies one combined Science up to Class 10 and
  // Physics / Chemistry / Biology from Class 11; ICSE / ISC always studies
  // Physics, Chemistry and Biology separately (no combined Science). Other
  // boards: Science up to Class 10, the three sciences at any class.
  const PCB = ['Physics', 'Chemistry', 'Biology'];
  function subjectAllowed(subject, board, cls) {
    const b = String(board || '').toUpperCase(), c = parseInt(cls, 10) || 0;
    if (subject === 'Science') return b === 'ICSE' ? false : !(c >= 11);
    if (PCB.includes(subject)) return !(b === 'CBSE' && c && c <= 10);
    return true;
  }
  const subjectsFor = (board, cls) => SUBJECTS.filter(s => subjectAllowed(s, board, cls));
  // Needed to start; the rest of the form can be filled in later from Profile.
  const QUICK_FIELDS = ['name', 'class', 'board', 'subjects', 'phone', 'guardianPhone'];

  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const phone = v => { const d = String(v == null ? '' : v).replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, ''); return d; };

  // Every field the onboarding form collects. `enrolled` students keep the
  // class/board/name the institute holds; they may update contact details.
  // opts.quick: only QUICK_FIELDS are required; any other field may be left
  // empty (but must be valid when filled). `complete` says whether every
  // field of the full form is filled in.
  function validateProfile(input, opts) {
    const o = opts || {}, x = input || {}, errors = {};
    const v = {
      name: clean(x.name, 80), dob: clean(x.dob, 10), gender: clean(x.gender, 20), phone: phone(x.phone),
      class: clean(x.class, 3), board: clean(x.board, 20), school: clean(x.school, 120),
      subjects: (Array.isArray(x.subjects) ? x.subjects : []).map(s => clean(s, 30)).filter((s, i, a) => SUBJECTS.includes(s) && a.indexOf(s) === i)
        .filter(s => subjectAllowed(s, clean(x.board, 20), clean(x.class, 3))),
      target: clean(x.target, 20),
      address: clean(x.address, 200), city: clean(x.city, 60), state: clean(x.state, 60), pincode: String(x.pincode == null ? '' : x.pincode).replace(/\D/g, '').slice(0, 6),
      guardianName: clean(x.guardianName, 80), guardianRelation: clean(x.guardianRelation, 20), guardianPhone: phone(x.guardianPhone),
      guardianEmail: clean(x.guardianEmail, 120).toLowerCase()
    };
    const need = (k, ok, msg) => { if (!ok) errors[k] = msg; };
    if (!o.enrolled) {
      need('name', v.name.length >= 2 && /\p{L}/u.test(v.name), 'Enter your full name.');
      need('class', CLASSES.includes(v.class), 'Choose your class.');
      need('board', BOARDS.includes(v.board), 'Choose your board.');
    }
    const dob = Date.parse(v.dob + 'T00:00:00Z'), age = (Date.now() - dob) / (365.25 * 86400000);
    need('dob', /^\d{4}-\d{2}-\d{2}$/.test(v.dob) && age >= 8 && age <= 30, 'Enter a valid date of birth.');
    if (v.gender && !GENDERS.includes(v.gender)) v.gender = '';
    need('phone', /^[6-9]\d{9}$/.test(v.phone), 'Enter a 10-digit mobile number.');
    need('school', v.school.length >= 3, 'Enter your school name.');
    need('subjects', v.subjects.length > 0, 'Pick at least one subject.');
    if (v.target && !TARGETS.includes(v.target)) v.target = '';
    need('address', v.address.length >= 5, 'Enter your address.');
    need('city', v.city.length >= 2, 'Enter your city or town.');
    need('state', STATES.includes(v.state), 'Choose your state.');
    need('pincode', /^[1-9]\d{5}$/.test(v.pincode), 'Enter a 6-digit PIN code.');
    need('guardianName', v.guardianName.length >= 2, "Enter your parent or guardian's name.");
    need('guardianRelation', RELATIONS.includes(v.guardianRelation), 'Choose the relation.');
    need('guardianPhone', /^[6-9]\d{9}$/.test(v.guardianPhone), 'Enter a 10-digit mobile number.');
    // Optional: results are emailed here when a checked script is sent back.
    need('guardianEmail', !v.guardianEmail || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v.guardianEmail), 'Enter a valid email, or leave it empty.');
    const complete = !Object.keys(errors).length;
    if (o.quick) Object.keys(errors).forEach(k => { const val = v[k]; if (!QUICK_FIELDS.includes(k) && (val === '' || val == null)) delete errors[k]; });
    return { ok: !Object.keys(errors).length, value: v, errors, complete };
  }

  // Short public label for a student who is not enrolled at the institute.
  const onlineId = uid => 'TNC-ON-' + String(uid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  const subjectKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
  const boardKey = (cls, subject) => 'c' + String(cls || '').replace(/\D/g, '') + '_' + subjectKey(subject);
  // Leaderboard shows first name + surname initial ("Riya S.").
  function shortName(name) {
    const parts = clean(name, 80).split(' ').filter(Boolean);
    if (!parts.length) return 'Student';
    return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.' : parts[0];
  }
  const round2 = n => Math.round(n * 100) / 100;
  // Older tests without a kind count as full mocks when named that way.
  function kindOf(t) {
    t = t || {};
    if (['mock', 'chapter', 'custom', 'package'].includes(t.kind)) return t.kind;
    return /full\s*syllabus|mock/i.test(`${t.chapter || ''} ${t.testName || ''}`) ? 'mock' : 'chapter';
  }
  function priceFor(t, prices, enrolled) {
    if (t && t.isFree) return 0;
    const k = kindOf(t), p = prices || PRICES;
    if (enrolled || k === 'custom' || k === 'package') return 0;   // paid for by the module order / the pack
    return Number(p[k]) || PRICES[k];
  }

  // Struck-through regular price for a paid chapter-wise test or full mock, or 0.
  function listPriceFor(t, prices, listPrices, enrolled) {
    const k = kindOf(t), price = priceFor(t, prices, enrolled), list = Number((listPrices || LIST_PRICES)[k]) || 0;
    return price > 0 && list > price ? list : 0;
  }
  // TNC faculty name shown to students instead of a teacher's name.
  const facultyName = subject => 'TNC ' + ({ Computer: 'Computer Science', Maths: 'Mathematics' }[clean(subject, 40)] || clean(subject, 40) || 'Subject') + ' Faculty';

  // Average percentage per student over their checked tests in one class +
  // subject. rows: [{ uid, name, score, totalMarks, approvedAt }].
  // Ties share a rank (1, 2, 2, 4); the order within a tie favours more tests,
  // then whoever reached the score first.
  function rank(rows) {
    const by = new Map();
    (rows || []).forEach(r => {
      const max = Number(r.totalMarks), score = Number(r.score);
      if (!r.uid || !(max > 0) || !Number.isFinite(score)) return;
      const s = by.get(r.uid) || { uid: r.uid, name: r.name || '', total: 0, tests: 0, last: '' };
      s.total += Math.max(0, Math.min(100, score / max * 100)); s.tests++;
      if ((r.approvedAt || '') > s.last) { s.last = r.approvedAt || ''; if (r.name) s.name = r.name; }
      by.set(r.uid, s);
    });
    const list = [...by.values()].map(s => ({ uid: s.uid, name: s.name, tests: s.tests, last: s.last, avgPct: round2(s.total / s.tests) }))
      .sort((a, b) => b.avgPct - a.avgPct || b.tests - a.tests || a.last.localeCompare(b.last) || a.uid.localeCompare(b.uid));
    list.forEach((s, i) => { s.rank = i && list[i - 1].avgPct === s.avgPct ? list[i - 1].rank : i + 1; });
    return list;
  }
  // A student's own average from their results, matching rank() exactly.
  function averageOf(results) {
    const pcts = (results || []).filter(r => Number(r.totalMarks) > 0 && Number.isFinite(Number(r.score)))
      .map(r => Math.max(0, Math.min(100, Number(r.score) / Number(r.totalMarks) * 100)));
    return pcts.length ? round2(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  }
  // Rank from the anonymous, descending score list stored on the leaderboard.
  function rankFrom(scores, avg) {
    if (avg == null || !Array.isArray(scores) || !scores.length) return null;
    return 1 + scores.filter(s => s > avg).length;
  }

  const api = { PRICE_INR, PRICES, LIST_PRICES, PAPER, paperFor, KINDS, FREE_MOCKS, MODULE, modulePrice, isFullMock, cartPrice, paperValues, listPriceFor, facultyName, PACK_PRESETS, PACK_REMIND_DAYS, PACK_CLASSES, packSchedule, kindOf, priceFor, CLASSES, BOARDS, SUBJECTS, TARGETS, GENDERS, RELATIONS, STATES,
    validateProfile, QUICK_FIELDS, subjectAllowed, subjectsFor, onlineId, subjectKey, boardKey, shortName, rank, averageOf, rankFrom, phone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NTCOnlinePolicy = api;
})(typeof window === 'undefined' ? null : window);
