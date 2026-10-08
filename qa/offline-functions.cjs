/* Offline Test Series — server function checks (no network).
   Runs netlify/functions/offline-test.js and grade-offline-background.js
   against an in-memory Firestore, fake ID tokens and a fake Gemini.
   Run: node qa/offline-functions.cjs */
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.FIREBASE_PROJECT_ID = 'fixture';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"fixture":true}';
process.env.GEMINI_API_KEY = 'fixture-key';
process.env.URL = 'https://example.test';

// ── In-memory stand-in for ./_google ──
const db = new Map();
const calls = { gemini: [], triggers: [], openai: [] };
let openaiMode = [];
let geminiMode = 'ok';
const pdfWith = created => Buffer.from(`%PDF-1.4\n1 0 obj << /Producer (Fixture Scanner) /CreationDate (D:${created}) >> endobj\n%%EOF`, 'latin1');
const files = {
  'https://ucarecdn.com/q/': Buffer.from('%PDF-1.4 question'),
  'https://ucarecdn.com/a/': Buffer.from('%PDF-1.4 answers')
};
const aiReport = {
  studentNameOnScript: 'Riya', choiceNote: '',
  questions: [
    { q: '1', section: 'A', topic: 'Coulomb', max: 2, awarded: 5, status: 'full', remark: 'ok', pages: [1] },           // over max → clamped
    { q: '2', section: 'A', topic: 'Field', max: 3, awarded: 1.3, status: 'partial', remark: 'direction?', pages: [1] }, // → 1.5
    { q: '3', section: 'B', topic: 'Gauss', max: 5, awarded: 0, status: 'not_attempted', remark: 'Not attempted.' }
  ],
  sections: [{ name: 'Section A', label: 'Short', awarded: 99, max: 99 }, { name: 'Section B', label: 'Long', awarded: 0, max: 5 }],
  lossCategories: [{ category: 'Blank', refs: 'Q3', marks: 5 }, { category: 'Direction', refs: 'Q2', marks: 1.5 }, { category: 'Zero', refs: '', marks: 0 }],
  teacherRemark: 'Good try.', markingNotes: 'Step marking.', tips: [{ title: 'Attempt all', detail: 'x' }],
  corrections: [{ q: '3', title: 'Gauss', scored: 0, max: 5, notAttempted: true, whatWentWrong: 'Blank', solution: '$\\phi=q/\\varepsilon_0$' }],
  annotations: [{ page: 1, kind: 'tick', text: '', box: [10, 20, 30, 1200] }, { page: 9, kind: 'tick', text: '', box: [1, 2, 3, 4] }, { page: 1, kind: 'note', text: 'unit?', box: [1, 2] }],
  integrityObservations: [{ type: 'Handwriting changes', detail: 'Page 2 looks different', q: 'Q2', severity: 'medium' }]
};
const stub = {
  async verifyFirebaseIdToken(token) { if (!/^uid:/.test(token || '')) throw new Error('Invalid Firebase ID token'); return { uid: token.slice(4) }; },
  async getServiceAccountAccessToken() { return 'sa'; },
  async fsGet(_p, _t, p) { return db.has(p) ? { fields: db.get(p) } : null; },
  async fsPatch(_p, _t, p, obj) { db.set(p, JSON.parse(JSON.stringify(obj))); return {}; },
  decFields(doc) { return JSON.parse(JSON.stringify(doc.fields || {})); },
  async fetchBinary(url) {
    if (files[url]) return { buffer: files[url], contentType: url.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf' };
    throw new Error('unexpected fetch ' + url);
  },
  async request(host, p, method, headers, body) {
    if (host === 'example.test') { calls.triggers.push(body); return { status: 202, body: '' }; }
    if (p.endsWith(':runQuery')) {
      const hash = body.structuredQuery.where.fieldFilter.value.stringValue;
      return { status: 200, body: [...db.entries()].filter(([k, v]) => k.startsWith('offlineReports/') && v.scriptHash === hash).map(([, v]) => ({ document: { fields: v } })) };
    }
    if (host === 'api.openai.com') {
      calls.openai.push({ p, body, headers });
      const mode = openaiMode.shift() || 'ok';
      if (mode === 'missing-model') return { status: 404, body: { error: { code: 'model_not_found', message: `The model \`${body.model}\` does not exist` } } };
      if (mode === 'no-credit') return { status: 429, body: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } } };
      if (mode === 'error') return { status: 400, body: { error: { message: 'Something unexpected' } } };
      if (body.tools) return { status: 200, body: { model: body.model, status: 'completed', usage: { input_tokens: 9000, output_tokens: 700 }, output: [
        { type: 'web_search_call', action: { type: 'search', sources: [{ url: 'https://toppr.example/q1', title: 'Toppr' }] } },
        { type: 'message', content: [{ type: 'output_text', text: '{"webMatches":[],"aiStyle":{"likely":false,"detail":""},"summary":"No copying found."}', annotations: [] }] }
      ] } };
      return { status: 200, body: { model: body.model, status: 'completed', usage: { input_tokens: 48000, output_tokens: 21000, output_tokens_details: { reasoning_tokens: 12000 } }, output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(aiReport), annotations: [] }] }
      ] } };
    }
    if (host === 'generativelanguage.googleapis.com') {
      calls.gemini.push({ p, body });
      if (geminiMode === 'fail') return { status: 400, body: { error: { message: 'bad request' } } };
      if (body.tools) return { status: 200, body: { candidates: [{ content: { parts: [{ text: '```json\n{"webMatches":[{"q":"Q1","source":"Brainly","url":"https://brainly.example/x","similarity":"high","detail":"Same wording"}],"aiStyle":{"likely":false,"detail":""},"summary":"One copy."}\n```' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://brainly.example/x', title: 'Brainly' } }] } }] } };
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(aiReport) }] } }] } };
    }
    throw new Error('unexpected request ' + host + p);
  }
};
const googlePath = require.resolve(path.join(__dirname, '../netlify/functions/_google.js'));
require.cache[googlePath] = { id: googlePath, filename: googlePath, loaded: true, exports: stub };
const offline = require('../netlify/functions/offline-test.js');
const grader = require('../netlify/functions/grade-offline-background.js');

const call = async (body) => {
  const r = await offline.handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

(async () => {
  db.set('students/stu1', { name: 'Riya Sharma', studentId: 'NTC001', class: '11', board: 'CBSE' });
  db.set('students/stu2', { name: 'Aman', studentId: 'NTC002', class: '11', board: 'CBSE' });
  db.set('students/stu12', { name: 'Old', class: '12' });
  db.set('teachers/teach1', { name: 'Aarav Sen' });
  db.set('offlineTests/otsphy1', { testName: 'Unit Test', class: '11', subject: 'Physics', chapter: 'Electrostatics', totalMarks: 10, durationMin: 60, isActive: true, teacherUid: 'teach1', teacherName: 'Aarav Sen' });
  db.set('offlineTestKeys/otsphy1', { questionPdfUrl: 'https://ucarecdn.com/q/', answerPdfUrl: 'https://ucarecdn.com/a/' });

  // ── start ──
  assert.equal((await call({ idToken: 'nope', action: 'start', testId: 'otsphy1' })).status, 401, 'bad token rejected');
  assert.equal((await call({ idToken: 'uid:stu12', action: 'start', testId: 'otsphy1' })).status, 403, 'other class rejected');
  const s1 = await call({ idToken: 'uid:stu1', action: 'start', testId: 'otsphy1' });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.questionPdfUrl, 'https://ucarecdn.com/q/', 'question paper handed out on Start');
  assert.equal(s1.body.answerPdfUrl, undefined, 'answer key never sent to the student');
  assert.equal(Date.parse(s1.body.deadline) - Date.parse(s1.body.startedAt), 60 * 60000, '60 minute deadline');
  const again = await call({ idToken: 'uid:stu1', action: 'start', testId: 'otsphy1' });
  assert.equal(again.body.deadline, s1.body.deadline, 'reopening keeps the same deadline');
  console.log('✓ start: auth, class check, server deadline, idempotent, answer key never exposed');

  // ── submit ──
  const ok1 = 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/';
  const pg = 'https://ucarecdn.com/22222222-2222-2222-2222-222222222222/page-1.jpg';
  assert.equal((await call({ idToken: 'uid:stu2', action: 'submit', testId: 'otsphy1', scriptPdfUrl: ok1, pageUrls: [pg] })).status, 409, 'cannot submit before starting');
  assert.equal((await call({ idToken: 'uid:stu1', action: 'submit', testId: 'otsphy1', scriptPdfUrl: 'https://drive.google.com/x', pageUrls: [pg] })).status, 400, 'links rejected — PDF upload only');
  assert.equal((await call({ idToken: 'uid:stu1', action: 'submit', testId: 'otsphy1', scriptPdfUrl: ok1, pageUrls: Array(26).fill(pg) })).status, 400, 'page limit');
  // Pretend the student started 3 hours ago so this submission is late.
  const att = db.get('offlineAttempts/otsphy1__stu1');
  att.startedAt = new Date(Date.now() - 180 * 60000).toISOString();
  att.deadline = new Date(Date.now() - 120 * 60000).toISOString();
  const sub = await call({ idToken: 'uid:stu1', action: 'submit', testId: 'otsphy1', scriptPdfUrl: ok1, pageUrls: [pg] });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.lateByMin, 120);
  assert.equal(db.get('offlineAttempts/otsphy1__stu1').status, 'checking');
  assert.equal(db.get('offlineReports/otsphy1__stu1').status, 'checking');
  assert.equal(calls.triggers.length, 1, 'AI check triggered');
  assert.equal((await call({ idToken: 'uid:stu1', action: 'submit', testId: 'otsphy1', scriptPdfUrl: ok1, pageUrls: [pg] })).status, 409, 'no double submission');
  console.log('✓ submit: PDF-only, page limit, late minutes recorded, single submission, background check triggered');

  // ── background grader ──
  assert.equal((await grader.handler({ body: JSON.stringify({ attemptId: 'otsphy1__stu1', sig: 'forged' }) })).statusCode, 403, 'forged trigger refused');
  // The script PDF says it was created a day before the test started.
  files[ok1] = pdfWith('20261001090000Z');
  files[pg] = Buffer.from([0xff, 0xd8, 0xff]);
  // Another student already submitted the identical file.
  const crypto = require('node:crypto');
  db.set('offlineReports/otsphy1__stu2', { attemptId: 'otsphy1__stu2', studentName: 'Aman', studentId: 'NTC002', testName: 'Unit Test', scriptHash: crypto.createHash('sha256').update(files[ok1]).digest('hex') });
  const g = await grader.handler({ body: JSON.stringify(calls.triggers[0]) });
  assert.equal(g.statusCode, 200);
  const rep = db.get('offlineReports/otsphy1__stu1');
  assert.equal(rep.status, 'ai_checked', rep.error);
  assert.equal(db.get('offlineAttempts/otsphy1__stu1').status, 'ai_checked');
  const r = JSON.parse(rep.finalReport);
  assert.deepEqual(r.questions.map(q => q.awarded), [2, 1.5, 0], 'marks clamped to max and rounded to ½');
  assert.equal(r.questions[2].status, 'not_attempted');
  assert.equal(r.totalAwarded, 3.5); assert.equal(r.totalMax, 10); assert.equal(r.pct, 35);
  assert.deepEqual(r.sections.map(s => [s.awarded, s.max]), [[3.5, 5], [0, 5]], 'section totals recomputed from questions');
  assert.equal(r.lossCategories.length, 2, 'zero-mark categories dropped');
  assert.equal(r.annotations.length, 1, 'annotations on missing pages / bad boxes dropped');
  assert.equal(r.annotations[0].box[3], 1000, 'boxes clamped to the page');
  const integ = JSON.parse(rep.integrity);
  const types = integ.flags.map(f => f.type);
  assert(types.includes('PDF made before the test started'), types);
  assert(types.includes('Same PDF submitted by another student'), types);
  assert(types.includes('Late submission'), types);
  assert(types.includes('Matches an online source'), types);
  assert(types.includes('Handwriting changes'), types);
  assert.equal(integ.level, 'high');
  assert.equal(integ.web.sources[0].url, 'https://brainly.example/x');
  assert.equal(rep.integrityLevel, 'high');
  const marking = calls.gemini.find(c => !c.body.tools);
  assert(marking.p.includes('gemini-2.5-pro'), 'grades with the strongest model first');
  assert.equal(marking.body.contents[0].parts.filter(x => x.inline_data && x.inline_data.mime_type === 'application/pdf').length, 2, 'question paper + answer key sent as PDFs');
  assert(calls.gemini.some(c => c.body.tools && c.body.tools[0].google_search), 'web check uses Google Search');
  console.log('✓ AI check: marks normalised, sections recomputed, red-pen marks validated, report saved for approval');
  console.log('✓ integrity: pre-made PDF, duplicate file, late, web copy and in-script flags → level high');

  // ── approved scripts are never re-graded; failures are recorded ──
  const before = calls.gemini.length;
  db.set('offlineReports/otsphy1__stu1', { ...db.get('offlineReports/otsphy1__stu1'), status: 'approved' });
  await grader.handler({ body: JSON.stringify(calls.triggers[0]) });
  assert.equal(calls.gemini.length, before, 'approved report left alone');
  assert.equal((await call({ idToken: 'uid:teach1', action: 'regrade', attemptId: 'otsphy1__stu1' })).status, 409, 'cannot re-check an approved script');
  db.set('offlineReports/otsphy1__stu1', { ...db.get('offlineReports/otsphy1__stu1'), status: 'ai_checked' });
  assert.equal((await call({ idToken: 'uid:stu1', action: 'regrade', attemptId: 'otsphy1__stu1' })).status, 403, 'students cannot re-run checks');
  geminiMode = 'fail';
  const rg = await call({ idToken: 'uid:teach1', action: 'regrade', attemptId: 'otsphy1__stu1' });
  assert.equal(rg.status, 200);
  await grader.handler({ body: JSON.stringify(calls.triggers[calls.triggers.length - 1]) });
  assert.equal(db.get('offlineReports/otsphy1__stu1').status, 'failed');
  assert(/AI check failed/.test(db.get('offlineReports/otsphy1__stu1').error));
  console.log('✓ approved scripts never re-graded; teacher-only re-check; AI failures saved as "failed" for a retry');

  // ── OpenAI (ChatGPT models) as the checker ──
  process.env.OPENAI_API_KEY = 'sk-fixture';
  geminiMode = 'ok';
  const ok3 = 'https://ucarecdn.com/33333333-3333-3333-3333-333333333333/';
  files[ok3] = pdfWith('20991231000000Z');
  db.set('students/stu3', { name: 'Isha', studentId: 'NTC003', class: '11', board: 'CBSE' });
  await call({ idToken: 'uid:stu3', action: 'start', testId: 'otsphy1' });
  await call({ idToken: 'uid:stu3', action: 'submit', testId: 'otsphy1', scriptPdfUrl: ok3, pageUrls: [pg] });
  const trig3 = calls.triggers[calls.triggers.length - 1];
  const regrade3 = async () => {
    db.set('offlineReports/otsphy1__stu3', { ...db.get('offlineReports/otsphy1__stu3'), status: 'checking' });
    await grader.handler({ body: JSON.stringify(trig3) });
    return db.get('offlineReports/otsphy1__stu3');
  };

  calls.openai = []; calls.gemini = []; openaiMode = ['missing-model'];
  let r3 = await regrade3();
  assert.equal(r3.status, 'ai_checked', r3.error);
  assert.equal(calls.gemini.length, 0, 'Gemini not used when OpenAI works');
  const mark = calls.openai.filter(c => !c.body.tools);
  assert.deepEqual(mark.map(c => c.body.model), ['gpt-6.1-sol', 'gpt-6-astra'], 'missing model → next model');
  const b = mark[1].body;
  assert.equal(mark[1].headers.Authorization, 'Bearer sk-fixture');
  assert.equal(b.store, false, 'scripts not stored at OpenAI');
  assert.equal(b.reasoning.effort, 'medium');
  assert.equal(b.text.format.type, 'json_schema'); assert.equal(b.text.format.strict, true);
  const walk = (sch, path) => {
    if (sch.type === 'object') {
      assert.equal(sch.additionalProperties, false, path);
      assert.deepEqual([...sch.required].sort(), Object.keys(sch.properties).sort(), path + ' requires every key');
      Object.entries(sch.properties).forEach(([k, v]) => walk(v, path + '.' + k));
    } else if (sch.type === 'array') walk(sch.items, path + '[]');
  };
  walk(b.text.format.schema, 'report');
  const content = b.input[0].content;
  assert.equal(content.filter(c => c.type === 'input_file' && /^data:application\/pdf;base64,/.test(c.file_data)).length, 2, 'question paper + answer key as PDFs');
  assert.equal(content.filter(c => c.type === 'input_image' && c.detail === 'high').length, 1, 'script pages as high-detail images');
  assert(/senior examiner/.test(b.instructions), 'marking instructions sent');
  const web3 = calls.openai.find(c => c.body.tools);
  assert.equal(web3.body.tools[0].type, 'web_search');
  assert.deepEqual(web3.body.include, ['web_search_call.action.sources']);
  assert.equal(web3.body.model, 'gpt-6-luna');
  assert.equal(r3.aiModel, 'gpt-6-astra');
  const usage = JSON.parse(r3.aiUsage);
  assert.equal(usage.marking.input, 48000); assert.equal(usage.marking.output, 21000); assert.equal(usage.marking.reasoning, 12000);
  assert.equal(usage.web.model, 'gpt-6-luna'); assert.equal(usage.web.searches, 1);
  assert.equal(JSON.parse(r3.integrity).web.sources[0].url, 'https://toppr.example/q1');
  assert.equal(JSON.parse(r3.finalReport).totalAwarded, 3.5, 'same report normalisation for OpenAI');
  console.log('✓ OpenAI: strict report schema, PDFs + page images, no storage, model fallback, web search sources, token usage saved');

  calls.openai = []; calls.gemini = []; openaiMode = ['no-credit'];
  r3 = await regrade3();
  assert.equal(r3.status, 'failed');
  assert(/no credit left/.test(r3.error), r3.error);
  assert.equal(calls.gemini.filter(c => !c.body.tools).length, 0, 'no silent switch to Gemini when OpenAI credit runs out');
  console.log('✓ OpenAI out of credit → clear "add credit" error for the teacher, no silent switch');

  calls.openai = []; calls.gemini = []; openaiMode = ['error'];
  r3 = await regrade3();
  assert.equal(r3.status, 'ai_checked', r3.error);
  assert(/^gemini/.test(r3.aiModel), 'fell back to Gemini');
  assert(/Something unexpected/.test(JSON.parse(r3.aiUsage).marking.fallbackReason));
  console.log('✓ other OpenAI errors → Gemini checks the script instead and the reason is recorded');

  process.env.AI_GRADER = 'gemini'; calls.openai = []; calls.gemini = [];
  r3 = await regrade3();
  assert.equal(calls.openai.length, 0, 'AI_GRADER=gemini forces Gemini');
  delete process.env.AI_GRADER;
  console.log('✓ AI_GRADER switch');
})().catch(e => { console.error(e); process.exit(1); });
