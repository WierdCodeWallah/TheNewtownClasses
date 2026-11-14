/* Online Test Series (all-India) rules shared by the portal and the Netlify
   functions: price, profile validation, subject keys and leaderboard maths.
   Pure functions only: no network, no storage. */
(function (root) {
  'use strict';
  // Chapter-wise tests ₹199, full mock tests ₹499. A test marked free costs nothing.
  const PRICES = { chapter: 199, mock: 499 };
  const KINDS = { chapter: 'Chapter-wise test', mock: 'Full mock test' };
  const PRICE_INR = PRICES.mock;
  // Online students get one free full mock on a subject they choose.
  // Enrolled TNC students get every test free, so no free-mock claim is needed.
  const FREE_MOCKS = { online: 1, enrolled: 0 };
  // Custom module tests (Classes 9–12): the student picks chapters; the team
  // makes one paper per subject. ₹199 a chapter for the first 4, ₹150 after.
  // minPerPaper: each subject's paper needs at least 2 chapters (one chapter = a chapter-wise test).
  const MODULE = { classes: ['9', '10', '11', '12'], first: 199, firstCount: 4, rest: 150, maxChapters: 40, readyHours: 24, minPerPaper: 2 };
  // Mock packs: a set of full-syllabus mocks, one a week at a fixed day and time.
  // Each pack has its own price (e.g. 8 mocks ₹3199, 4 mocks ₹1699); presets below.
  const PACK_PRESETS = [{ mocks: 8, priceInr: 3199 }, { mocks: 4, priceInr: 1699 }];
  const PACK_REMIND_DAYS = 3;   // admins are reminded this many days before a mock opens
  // Weekly schedule: first date 'YYYY-MM-DD' + time 'HH:MM' (India time).
  function packSchedule(firstDate, time, count) {
    const start = Date.parse(`${firstDate}T${time || '10:00'}:00+05:30`);
    if (!Number.isFinite(start)) return [];
    return Array.from({ length: Math.max(0, Math.min(52, Number(count) || 0)) }, (_, i) => new Date(start + i * 7 * 86400000).toISOString());
  }
  // Custom modules are paid by everyone, TNC students included (only chapter-wise
  // tests and full mocks are free for them). The second argument is ignored.
  function modulePrice(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const a = Math.min(n, MODULE.firstCount);
    return a * MODULE.first + (n - a) * MODULE.rest;
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

  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const phone = v => { const d = String(v == null ? '' : v).replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, ''); return d; };

  // Every field the onboarding form collects. `enrolled` students keep the
  // class/board/name the institute holds; they may update contact details.
  function validateProfile(input, opts) {
    const o = opts || {}, x = input || {}, errors = {};
    const v = {
      name: clean(x.name, 80), dob: clean(x.dob, 10), gender: clean(x.gender, 20), phone: phone(x.phone),
      class: clean(x.class, 3), board: clean(x.board, 20), school: clean(x.school, 120),
      subjects: (Array.isArray(x.subjects) ? x.subjects : []).map(s => clean(s, 30)).filter((s, i, a) => SUBJECTS.includes(s) && a.indexOf(s) === i),
      target: clean(x.target, 20),
      address: clean(x.address, 200), city: clean(x.city, 60), state: clean(x.state, 60), pincode: String(x.pincode == null ? '' : x.pincode).replace(/\D/g, '').slice(0, 6),
      guardianName: clean(x.guardianName, 80), guardianRelation: clean(x.guardianRelation, 20), guardianPhone: phone(x.guardianPhone)
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
    return { ok: !Object.keys(errors).length, value: v, errors };
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

  const api = { PRICE_INR, PRICES, KINDS, FREE_MOCKS, MODULE, modulePrice, PACK_PRESETS, PACK_REMIND_DAYS, packSchedule, kindOf, priceFor, CLASSES, BOARDS, SUBJECTS, TARGETS, GENDERS, RELATIONS, STATES,
    validateProfile, onlineId, subjectKey, boardKey, shortName, rank, averageOf, rankFrom, phone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NTCOnlinePolicy = api;
})(typeof window === 'undefined' ? null : window);
