/**
 * ════════════════════════════════════════════════════
 *  Netlify BACKGROUND Function: grade-offline-background
 *  ────────────────────────────────────────────────
 *  Checks one Offline Test Series answer script (runs up to 15 min; the
 *  caller gets an immediate 202). Triggered by offline-test.js with an
 *  HMAC signature so nobody else can start (and bill) a check.
 *
 *    1. Load the attempt, the test, the teacher's question paper + answer
 *       key (offlineTestKeys) and the student's script pages.
 *    2. The AI (OpenAI GPT or Google Gemini — vision + PDFs) marks the
 *       script against the answer key and writes the full evaluation report
 *       (question-wise marks, where the marks went, tips, corrections &
 *       model answers, red-pen marks).
 *    3. Integrity checks:
 *         • AI + web search: answers copied from solution sites /
 *           AI-generated wording.
 *         • In-script signals from the marking pass (handwriting changes,
 *           printed text, verbatim answer-key wording…).
 *         • Server signals: PDF created before the test started, the same
 *           PDF submitted by another student, late or very fast submission.
 *    4. offlineReports/{attemptId} → status 'ai_checked'. The teacher then
 *       reviews it in "AnswerScript Approval" and approves it.
 *
 *  REQUIRED ENV VARS: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT, and
 *    OPENAI_API_KEY (OpenAI API key — platform.openai.com, billed per use;
 *    a ChatGPT app subscription does not include API use) and/or GEMINI_API_KEY.
 *  OPTIONAL:
 *    AI_GRADER               openai | gemini (default: openai when its key is set)
 *    OPENAI_GRADER_MODEL     default gpt-6.1-sol, then gpt-6-astra, gpt-5.4, gpt-5.1
 *    OPENAI_WEBCHECK_MODEL   default gpt-6-luna (with web search)
 *    OPENAI_REASONING_EFFORT default medium
 *    GEMINI_GRADER_MODEL     default gemini-2.5-pro, falls back to flash
 * ════════════════════════════════════════════════════
 */
const https  = require('https');
const crypto = require('crypto');
const {
  request, fetchBinary, getServiceAccountAccessToken, fsGet, fsPatch, decFields
} = require('./_google');

const GEMINI_HOST = 'generativelanguage.googleapis.com';
// Gemini caps one request at ~20 MB, so inline parts share a budget; anything
// past it (big scanned PDFs, long scripts) goes through the Files API instead.
const INLINE_BUDGET_BYTES = 14 * 1024 * 1024;
const UPLOAD_GRACE_MIN = 15;

// Keep in sync with graderSignature() in offline-test.js.
function graderSignature(attemptId) {
  const secret = crypto.createHash('sha256').update(String(process.env.FIREBASE_SERVICE_ACCOUNT || '')).digest();
  return crypto.createHmac('sha256', secret).update('grade:' + attemptId).digest('hex');
}

// ── Raw HTTPS (binary bodies + response headers) for the Gemini Files API ──
function rawRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Inline while the request budget lasts; otherwise upload to the Gemini Files API.
async function geminiPart(apiKey, buffer, mimeType, name, budget) {
  const cost = Math.ceil(buffer.length * 4 / 3);   // base64 size
  if (cost <= budget.left) {
    budget.left -= cost;
    return { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } };
  }
  const start = await rawRequest(`https://${GEMINI_HOST}/upload/v1beta/files?key=${apiKey}`, 'POST', {
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': String(buffer.length),
    'X-Goog-Upload-Header-Content-Type': mimeType,
    'Content-Type': 'application/json'
  }, JSON.stringify({ file: { display_name: name } }));
  const uploadUrl = start.headers['x-goog-upload-url'];
  if (!uploadUrl) throw new Error('Could not upload ' + name + ' to the AI (' + start.status + ')');
  const up = await rawRequest(uploadUrl, 'POST', {
    'Content-Length': String(buffer.length),
    'X-Goog-Upload-Offset': '0',
    'X-Goog-Upload-Command': 'upload, finalize'
  }, buffer);
  let file = up.json && up.json.file;
  if (!file || !file.uri) throw new Error('AI file upload failed for ' + name);
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const g = await rawRequest(`https://${GEMINI_HOST}/v1beta/${file.name}?key=${apiKey}`, 'GET', {});
    if (g.json) file = g.json;
  }
  if (file.state === 'FAILED') throw new Error('The AI could not read ' + name);
  return { file_data: { mime_type: mimeType, file_uri: file.uri } };
}

// ── Response schema for the marking pass ──
const STR = { type: 'string' }, NUM = { type: 'number' }, INT = { type: 'integer' };
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    studentNameOnScript: STR,
    choiceNote: STR,
    questions: { type: 'array', items: { type: 'object', properties: {
      q: STR, section: STR, topic: STR, max: NUM, awarded: NUM,
      status: { type: 'string', enum: ['full', 'partial', 'zero', 'not_attempted'] },
      remark: STR, pages: { type: 'array', items: INT }
    }, required: ['q', 'topic', 'max', 'awarded', 'status', 'remark'] } },
    sections: { type: 'array', items: { type: 'object', properties: {
      name: STR, label: STR, awarded: NUM, max: NUM
    }, required: ['name', 'label', 'awarded', 'max'] } },
    lossCategories: { type: 'array', items: { type: 'object', properties: {
      category: STR, refs: STR, marks: NUM
    }, required: ['category', 'refs', 'marks'] } },
    teacherRemark: STR,
    markingNotes: STR,
    tips: { type: 'array', items: { type: 'object', properties: { title: STR, detail: STR }, required: ['title', 'detail'] } },
    corrections: { type: 'array', items: { type: 'object', properties: {
      q: STR, title: STR, scored: NUM, max: NUM, notAttempted: { type: 'boolean' },
      whatWentWrong: STR, solution: STR
    }, required: ['q', 'title', 'scored', 'max', 'whatWentWrong', 'solution'] } },
    annotations: { type: 'array', items: { type: 'object', properties: {
      page: INT,
      kind: { type: 'string', enum: ['tick', 'cross', 'score', 'note'] },
      text: STR,
      box: { type: 'array', items: INT }
    }, required: ['page', 'kind', 'box'] } },
    integrityObservations: { type: 'array', items: { type: 'object', properties: {
      type: STR, detail: STR, q: STR,
      severity: { type: 'string', enum: ['low', 'medium', 'high'] }
    }, required: ['type', 'detail', 'severity'] } }
  },
  required: ['questions', 'sections', 'lossCategories', 'teacherRemark', 'markingNotes', 'tips', 'corrections', 'annotations', 'integrityObservations']
};

const SAFETY = [
  'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'
].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

async function generate(apiKey, models, payload) {
  let lastErr = '';
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await request(GEMINI_HOST, `/v1beta/models/${model}:generateContent?key=${apiKey}`, 'POST',
        { 'Content-Type': 'application/json' }, payload);
      if (r.status === 200) {
        const cand = r.body && r.body.candidates && r.body.candidates[0];
        const text = (cand && cand.content && cand.content.parts || []).map(p => p.text).filter(Boolean).join('').trim();
        const u = r.body.usageMetadata || {};
        if (text) return { model, text, grounding: cand.groundingMetadata || null,
          usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), reasoning: u.thoughtsTokenCount || 0 } };
        lastErr = `${model}: empty response (${cand && cand.finishReason})`;
        break;
      }
      const msg = (r.body && r.body.error && r.body.error.message) || '';
      lastErr = `${model}: ${r.status} ${msg}`;
      if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 8000)); continue; }
      break;   // 400/404: try the next model
    }
  }
  throw new Error('AI check failed — ' + lastErr);
}

const half = n => Math.round((Number(n) || 0) * 2) / 2;

function buildMarkingPrompt(ctx) {
  return [
    `You are a senior examiner at The NewTown Classes (Newtown, Kolkata) checking a handwritten answer script.`,
    `Test: "${ctx.testName}" — ${ctx.subject}, Class ${ctx.cls}${ctx.board ? ' (' + ctx.board + ')' : ''}. Chapter/syllabus: ${ctx.chapter || 'as per paper'}.`,
    `Maximum marks: ${ctx.totalMarks || 'as printed on the paper'}. Student: ${ctx.studentName || 'the student'}.`,
    ``,
    `INPUTS, in this order: (1) the QUESTION PAPER (PDF); (2) the teacher's ANSWER KEY / MARKING SCHEME (PDF) — this is authoritative;`,
    `(3) the student's handwritten script as images labelled "Page 1", "Page 2", ….`,
    ``,
    `MARK like a careful ${ctx.board || 'board'} examiner:`,
    `• Step marking. Marks are multiples of ½. Never exceed a question's maximum; take maxima from the question paper.`,
    `• Use the answer key's values and scheme. A different but fully correct method earns full credit.`,
    `• Deduct ½ for a missing/wrong unit in a final answer, at most once per question. An error carried forward is penalised once.`,
    `• For OR choices grade the option the student attempted; label it e.g. "10 (OR)" and say so in choiceNote.`,
    `• A question with nothing relevant written is status "not_attempted" with 0. Unreadable work earns 0 for that part — say so.`,
    ``,
    `RETURN (JSON, schema provided):`,
    `• questions — EVERY question of the paper in order. q = numbering exactly as in the paper ("1", "10 (OR)"); section = section letter if the paper has sections;`,
    `  topic = short topic; remark = a specific examiner remark per part, e.g. "(a) correct; (b) unit μC missing; (c) correct conclusion, no reason."; pages = script pages used.`,
    `• sections — one per paper section: name "Section A", label like "Objective · Q1" or "Short answer · Q2–5", with awarded and max. Empty if the paper has no sections.`,
    `• lossCategories — group EVERY lost mark into categories such as "Questions or parts left blank", "Direction, reason or diagram missing", "Units missing",`,
    `  "Graph reading and arithmetic slips", "Incomplete answers", "Concept error"; refs like "Q3, Q4, Q5(b)". The marks must add up to the total marks lost.`,
    `• teacherRemark — 3–4 warm, specific sentences addressed to the student by first name, quantifying where marks went.`,
    `• markingNotes — one sentence on the marking conventions used.`,
    `• tips — 4–6 "before you hand in your next paper" tips: title = short imperative phrase, detail = one line tied to THIS script.`,
    `• corrections — for EVERY question or part where marks were lost (including not attempted): q label, title (topic), scored, max, notAttempted,`,
    `  whatWentWrong (specific, quoting what the student wrote), solution (a complete, exam-ready model solution).`,
    `  Write ALL maths in LaTeX with $…$ inline and $$…$$ for display lines; use **bold** for key words; new paragraphs with blank lines.`,
    `• annotations — red-pen marks for the script pages: a "tick" or "cross" at the end of each answer part's final line; a "score" with the marks for`,
    `  each question (e.g. "8½/10") beside its question number; short "note" corrections (max 10 words, e.g. "unit? → N C⁻¹", "read ×10⁴ on axis") beside the mistake.`,
    `  page = 1-based page number; box = [ymin, xmin, ymax, xmax] normalised 0–1000 on that page image. Place marks where the work actually is.`,
    `• integrityObservations — only REAL signs of malpractice visible in the script: handwriting that changes between answers/pages, printed/typed or`,
    `  photographed-from-book text, wording copied verbatim from the answer key (including its unique phrasing or typos), answers to questions not in`,
    `  this paper, pages that look like another student's or another test. Empty array if none. Never invent.`,
    `• studentNameOnScript — the name written on the script, if any.`,
    ``,
    `Be accurate and fair. Respond with ONLY the JSON.`
  ].join('\n');
}

function normaliseReport(ai, ctx) {
  const questions = (ai.questions || []).map(q => {
    const max = Math.max(0, half(q.max));
    const awarded = Math.max(0, Math.min(max, half(q.awarded)));
    let status = q.status;
    if (status !== 'not_attempted') status = awarded >= max && max > 0 ? 'full' : awarded <= 0 ? 'zero' : 'partial';
    return {
      q: String(q.q || ''), section: String(q.section || '').replace(/^section\s*/i, '').trim().toUpperCase(),
      topic: String(q.topic || ''), max, awarded, status, remark: String(q.remark || ''),
      pages: Array.isArray(q.pages) ? q.pages.map(n => parseInt(n, 10)).filter(n => n > 0) : []
    };
  });
  const sumMax = questions.reduce((a, q) => a + q.max, 0);
  const totalMax = Number(ctx.totalMarks) > 0 ? Number(ctx.totalMarks) : sumMax;
  const totalAwarded = Math.min(totalMax, half(questions.reduce((a, q) => a + q.awarded, 0)));

  // Section totals are recomputed from the questions so they always agree.
  const sections = (ai.sections || []).map(s => {
    const letter = String(s.name || '').replace(/^section\s*/i, '').trim().toUpperCase();
    const qs = questions.filter(q => q.section && q.section === letter);
    return {
      name: String(s.name || ''), label: String(s.label || ''),
      awarded: qs.length ? half(qs.reduce((a, q) => a + q.awarded, 0)) : half(s.awarded),
      max: qs.length ? half(qs.reduce((a, q) => a + q.max, 0)) : half(s.max)
    };
  }).filter(s => s.max > 0);

  const pageCount = ctx.pageCount;
  const annotations = (ai.annotations || []).map(a => ({
    page: parseInt(a.page, 10), kind: a.kind, text: String(a.text || '').slice(0, 80),
    box: (Array.isArray(a.box) ? a.box : []).slice(0, 4).map(n => Math.max(0, Math.min(1000, parseInt(n, 10) || 0)))
  })).filter(a => a.page >= 1 && a.page <= pageCount && a.box.length === 4);

  return {
    version: 1,
    studentNameOnScript: String(ai.studentNameOnScript || ''),
    choiceNote: String(ai.choiceNote || ''),
    questions, sections,
    totalAwarded, totalMax,
    pct: totalMax ? Math.round(totalAwarded / totalMax * 1000) / 10 : 0,
    lossCategories: (ai.lossCategories || []).map(l => ({ category: String(l.category || ''), refs: String(l.refs || ''), marks: half(l.marks) })).filter(l => l.marks > 0),
    teacherRemark: String(ai.teacherRemark || ''),
    markingNotes: String(ai.markingNotes || ''),
    tips: (ai.tips || []).map(t => ({ title: String(t.title || ''), detail: String(t.detail || '') })).slice(0, 8),
    corrections: (ai.corrections || []).map(c => ({
      q: String(c.q || ''), title: String(c.title || ''), scored: half(c.scored), max: half(c.max),
      notAttempted: !!c.notAttempted, whatWentWrong: String(c.whatWentWrong || ''), solution: String(c.solution || '')
    })),
    annotations
  };
}

// ── Server-side integrity signals ──
function pdfDate(buf, key) {
  const head = buf.toString('latin1');
  const m = head.match(new RegExp('/' + key + '\\s*\\(D:(\\d{4})(\\d{2})?(\\d{2})?(\\d{2})?(\\d{2})?(\\d{2})?([+\\-Z])?(\\d{2})?\'?(\\d{2})?'));
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, th = '00', tm = '00'] = m;
  let iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  iso += !sign || sign === 'Z' ? 'Z' : `${sign}${th}:${tm}`;
  const t = new Date(iso);
  return isNaN(t) ? null : t;
}
function pdfProducer(buf) {
  const m = buf.toString('latin1').match(/\/(?:Producer|Creator)\s*\(([^)]{1,80})\)/);
  return m ? m[1].replace(/[^\x20-\x7e]/g, '').trim() : '';
}

async function findDuplicateScripts(projectId, sa, hash, attemptId) {
  const r = await request('firestore.googleapis.com',
    `/v1/projects/${projectId}/databases/(default)/documents:runQuery`, 'POST',
    { Authorization: `Bearer ${sa}`, 'Content-Type': 'application/json' },
    { structuredQuery: {
      from: [{ collectionId: 'offlineReports' }],
      where: { fieldFilter: { field: { fieldPath: 'scriptHash' }, op: 'EQUAL', value: { stringValue: hash } } },
      limit: 5
    } });
  if (r.status !== 200 || !Array.isArray(r.body)) return [];
  return r.body.filter(x => x.document).map(x => decFields(x.document))
    .filter(d => d.attemptId && d.attemptId !== attemptId)
    .map(d => ({ studentName: d.studentName || '', studentId: d.studentId || '', testName: d.testName || '' }));
}

// ── Web-check prompt + reply parsing (shared by both providers) ──
function webCheckPrompt(ctx) {
  return [
    `You are checking a student's handwritten ${ctx.subject} answer script (Class ${ctx.cls}, chapter: ${ctx.chapter || 'n/a'}) for copying.`,
    `Read the answers in the page images. Pick the 3–6 most distinctive sentences, derivations or worded answers and SEARCH THE WEB to see whether`,
    `they were copied from online solution sources (e.g. Toppr, BYJU'S, Doubtnut, Brainly, Vedantu, Meritnation, Shaalaa, Chegg, Quora, NCERT solution`,
    `sites) or look AI-generated (ChatGPT-style phrasing, unusually polished wording for a timed handwritten test).`,
    `Ordinary textbook definitions and standard formulae are NOT evidence of copying — only flag unusual, specific wording or full worked solutions`,
    `that match a source closely.`,
    `Reply with ONLY this JSON (no markdown):`,
    `{"webMatches":[{"q":"Q2","source":"site","url":"https://…","similarity":"high|medium|low","detail":"what matched"}],`,
    ` "aiStyle":{"likely":false,"detail":""},"summary":"one or two sentences"}`
  ].join('\n');
}
function parseWebReply(text, sources) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  let parsed = {};
  try { parsed = JSON.parse(m ? m[0] : text); } catch {}
  return {
    webMatches: Array.isArray(parsed.webMatches) ? parsed.webMatches.slice(0, 8).map(w => ({
      q: String(w.q || ''), source: String(w.source || ''), url: String(w.url || ''),
      similarity: ['high', 'medium', 'low'].includes(w.similarity) ? w.similarity : 'low', detail: String(w.detail || '')
    })) : [],
    aiStyle: parsed.aiStyle && typeof parsed.aiStyle === 'object'
      ? { likely: !!parsed.aiStyle.likely, detail: String(parsed.aiStyle.detail || '') } : { likely: false, detail: '' },
    summary: String(parsed.summary || ''),
    sources: sources.filter((s, i, arr) => s.url && arr.findIndex(x => x.url === s.url) === i).slice(0, 10)
  };
}

// ═══════════════ Gemini ═══════════════
async function markWithGemini(ctx, files) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Server is missing GEMINI_API_KEY');
  const budget = { left: INLINE_BUDGET_BYTES };
  const imageParts = [];
  for (let i = 0; i < files.pages.length; i++) {
    const p = files.pages[i];
    imageParts.push({ text: `Page ${i + 1}` });
    imageParts.push(await geminiPart(apiKey, p.buffer, /png/i.test(p.contentType) ? 'image/png' : 'image/jpeg', `page-${i + 1}.jpg`, budget));
  }
  const qPart = await geminiPart(apiKey, files.qPdf.buffer, 'application/pdf', 'question-paper.pdf', budget);
  const aPart = await geminiPart(apiKey, files.aPdf.buffer, 'application/pdf', 'answer-key.pdf', budget);
  // Strongest model first; the "latest" aliases keep working if a version is retired.
  const models = [process.env.GEMINI_GRADER_MODEL || 'gemini-2.5-pro', 'gemini-pro-latest', 'gemini-2.5-flash', 'gemini-flash-latest']
    .filter((m, i, arr) => m && arr.indexOf(m) === i);
  files.geminiImageParts = imageParts;   // reused by the web check
  return generate(apiKey, models, {
    contents: [{ role: 'user', parts: [
      { text: 'QUESTION PAPER:' }, qPart,
      { text: 'ANSWER KEY / MARKING SCHEME:' }, aPart,
      { text: `STUDENT ANSWER SCRIPT — ${files.pages.length} page image(s):` }, ...imageParts
    ] }],
    systemInstruction: { parts: [{ text: buildMarkingPrompt(ctx) }] },
    generationConfig: { temperature: 0.15, maxOutputTokens: 65536, responseMimeType: 'application/json', responseSchema: REPORT_SCHEMA },
    safetySettings: SAFETY
  });
}

async function webCheckGemini(ctx, files) {
  const apiKey = process.env.GEMINI_API_KEY;
  const imageParts = files.geminiImageParts || files.pages.flatMap((p, i) => [
    { text: `Page ${i + 1}` },
    { inline_data: { mime_type: /png/i.test(p.contentType) ? 'image/png' : 'image/jpeg', data: p.buffer.toString('base64') } }
  ]);
  const res = await generate(apiKey, ['gemini-2.5-flash', 'gemini-flash-latest'], {
    contents: [{ role: 'user', parts: [{ text: webCheckPrompt(ctx) }, ...imageParts] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    safetySettings: SAFETY
  });
  const sources = ((res.grounding && res.grounding.groundingChunks) || [])
    .map(c => c.web).filter(Boolean).map(w => ({ title: String(w.title || ''), url: String(w.uri || '') }));
  return { ...parseWebReply(res.text, sources), model: res.model, usage: res.usage };
}

// ═══════════════ OpenAI (Responses API) ═══════════════
const OPENAI_HOST = 'api.openai.com';
const OPENAI_INLINE_PDF_BYTES = 20 * 1024 * 1024;   // bigger PDFs are passed by URL

// Strict structured outputs: every object lists all its keys as required and
// allows nothing else.
function strictSchema(s) {
  if (s.type === 'object') {
    const props = {};
    Object.keys(s.properties).forEach(k => { props[k] = strictSchema(s.properties[k]); });
    return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
  }
  if (s.type === 'array') return { type: 'array', items: strictSchema(s.items) };
  return { ...s };
}

function openaiPdf(file, filename) {
  return file.buffer.length <= OPENAI_INLINE_PDF_BYTES
    ? { type: 'input_file', filename, file_data: 'data:application/pdf;base64,' + file.buffer.toString('base64') }
    : { type: 'input_file', file_url: file.url };
}
function openaiPages(files) {
  return files.pages.flatMap((p, i) => [
    { type: 'input_text', text: `Page ${i + 1}` },
    { type: 'input_image', detail: 'high',
      image_url: `data:${/png/i.test(p.contentType) ? 'image/png' : 'image/jpeg'};base64,${p.buffer.toString('base64')}` }
  ]);
}

async function openaiRespond(models, payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  let lastErr = '';
  for (const model of models) {
    let body = { ...payload, model };
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await request(OPENAI_HOST, '/v1/responses', 'POST',
        { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body);
      if (r.status === 200) {
        const res = r.body || {};
        if (res.status === 'incomplete') {
          throw new Error('The AI ran out of space while writing the report (' + ((res.incomplete_details && res.incomplete_details.reason) || 'incomplete') + '). Re-run the check.');
        }
        const parts = (res.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []);
        const refusal = parts.find(p => p.type === 'refusal');
        if (refusal) throw new Error('The AI declined to check this script: ' + refusal.refusal);
        const text = parts.filter(p => p.type === 'output_text').map(p => p.text).join('').trim();
        if (!text) { lastErr = `${model}: empty response`; break; }
        const sources = [];
        (res.output || []).forEach(o => {
          if (o.type === 'web_search_call' && o.action && Array.isArray(o.action.sources)) {
            o.action.sources.forEach(s => sources.push({ title: String(s.title || ''), url: String(s.url || '') }));
          }
        });
        parts.forEach(p => (p.annotations || []).forEach(a => {
          if (a.type === 'url_citation') sources.push({ title: String(a.title || ''), url: String(a.url || '') });
        }));
        const u = res.usage || {};
        return {
          model: res.model || model, text, sources,
          usage: { input: u.input_tokens || 0, output: u.output_tokens || 0,
                   reasoning: (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0,
                   searches: (res.output || []).filter(o => o.type === 'web_search_call').length }
        };
      }
      const err = (r.body && r.body.error) || {};
      const msg = err.message || JSON.stringify(r.body || '').slice(0, 300);
      lastErr = `${model}: ${r.status} ${msg}`;
      if (r.status === 401) throw new Error('OpenAI rejected the API key (OPENAI_API_KEY). Check it in Netlify → Environment variables.');
      if (r.status === 429 && (err.code === 'insufficient_quota' || /quota|billing/i.test(msg))) {
        throw Object.assign(new Error('Your OpenAI API account has no credit left. Add credit at platform.openai.com → Settings → Billing, then re-run the check.'), { noFallback: true });
      }
      if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 10000)); continue; }
      if (r.status === 400 && body.reasoning && /reasoning/i.test(msg)) { body = { ...body }; delete body.reasoning; continue; }
      if (r.status === 404 || err.code === 'model_not_found' || /model .*(does not exist|not found|not supported)|do not have access to (the )?model/i.test(msg)) break;
      throw new Error('OpenAI error — ' + lastErr);
    }
  }
  throw new Error('AI check failed — ' + lastErr);
}

async function markWithOpenAI(ctx, files) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Server is missing OPENAI_API_KEY');
  const models = [process.env.OPENAI_GRADER_MODEL || 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.4', 'gpt-5.1']
    .filter((m, i, arr) => m && arr.indexOf(m) === i);
  return openaiRespond(models, {
    instructions: buildMarkingPrompt(ctx),
    input: [{ role: 'user', content: [
      { type: 'input_text', text: 'QUESTION PAPER:' }, openaiPdf(files.qPdf, 'question-paper.pdf'),
      { type: 'input_text', text: 'ANSWER KEY / MARKING SCHEME:' }, openaiPdf(files.aPdf, 'answer-key.pdf'),
      { type: 'input_text', text: `STUDENT ANSWER SCRIPT — ${files.pages.length} page image(s):` }, ...openaiPages(files)
    ] }],
    reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || 'medium' },
    max_output_tokens: 64000,
    text: { format: { type: 'json_schema', name: 'answer_script_report', strict: true, schema: strictSchema(REPORT_SCHEMA) } },
    store: false   // student scripts are not kept on OpenAI's side
  });
}

async function webCheckOpenAI(ctx, files) {
  const res = await openaiRespond([process.env.OPENAI_WEBCHECK_MODEL || 'gpt-6-luna', 'gpt-5.4-mini', 'gpt-5-mini']
    .filter((m, i, arr) => m && arr.indexOf(m) === i), {
    input: [{ role: 'user', content: [{ type: 'input_text', text: webCheckPrompt(ctx) }, ...openaiPages(files)] }],
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    reasoning: { effort: 'low' },
    max_output_tokens: 16000,
    store: false
  });
  return { ...parseWebReply(res.text, res.sources), model: res.model, usage: res.usage };
}

// Which AI checks the scripts: AI_GRADER=openai|gemini, otherwise OpenAI when
// its key is set. An OpenAI failure (other than running out of credit) falls
// back to Gemini when a Gemini key is available, so a script is never stuck.
function graderProvider() {
  const want = String(process.env.AI_GRADER || '').toLowerCase();
  if (want === 'openai' || want === 'gemini') return want;
  return process.env.OPENAI_API_KEY ? 'openai' : 'gemini';
}
async function markScript(ctx, files) {
  if (graderProvider() === 'gemini') return markWithGemini(ctx, files);
  try { return await markWithOpenAI(ctx, files); }
  catch (e) {
    if (e.noFallback || !process.env.GEMINI_API_KEY) throw e;
    console.warn('[grade-offline] OpenAI failed, using Gemini:', e.message);
    const res = await markWithGemini(ctx, files);
    return { ...res, fallbackReason: e.message };
  }
}
async function webCheck(ctx, files) {
  return graderProvider() === 'openai' ? webCheckOpenAI(ctx, files) : webCheckGemini(ctx, files);
}

exports.handler = async function (event) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const attemptId = String(body.attemptId || '');
  if (!/^[A-Za-z0-9_-]+__[A-Za-z0-9]+$/.test(attemptId)) return { statusCode: 400 };
  const sig = String(body.sig || '');
  const want = graderSignature(attemptId);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { statusCode: 403 };

  let sa;
  try { sa = await getServiceAccountAccessToken(); } catch (e) { console.error('[grade-offline] token', e); return { statusCode: 500 }; }
  const repPath = `offlineReports/${attemptId}`, attPath = `offlineAttempts/${attemptId}`;

  const [repDoc, attDoc] = await Promise.all([fsGet(projectId, sa, repPath), fsGet(projectId, sa, attPath)]);
  if (!repDoc || !attDoc) return { statusCode: 404 };
  const rep = decFields(repDoc), att = decFields(attDoc);
  if (rep.status === 'approved') return { statusCode: 200 };
  // A second trigger while a check is already running is ignored.
  if (rep.status === 'grading' && rep.gradingStartedAt && Date.now() - Date.parse(rep.gradingStartedAt) < 14 * 60000) return { statusCode: 200 };

  const save = (repPatch, attStatus) => Promise.all([
    fsPatch(projectId, sa, repPath, { ...rep, ...repPatch }),
    attStatus ? fsPatch(projectId, sa, attPath, { ...att, status: attStatus }) : null
  ]);
  await save({ status: 'grading', gradingStartedAt: new Date().toISOString(), error: '' }, null);

  try {
    const [testDoc, keyDoc] = await Promise.all([
      fsGet(projectId, sa, `offlineTests/${rep.testId}`),
      fsGet(projectId, sa, `offlineTestKeys/${rep.testId}`)
    ]);
    const test = testDoc ? decFields(testDoc) : {};
    const key = keyDoc ? decFields(keyDoc) : {};
    if (!key.questionPdfUrl || !key.answerPdfUrl) throw new Error('The question paper or answer key PDF is missing for this test.');

    const pageUrls = Array.isArray(rep.pageUrls) ? rep.pageUrls : [];
    const [qPdf, aPdf, scriptPdf, ...pages] = await Promise.all([
      fetchBinary(key.questionPdfUrl), fetchBinary(key.answerPdfUrl), fetchBinary(rep.scriptPdfUrl),
      ...pageUrls.map(u => fetchBinary(u))
    ]);
    const ctx = {
      testName: rep.testName || test.testName || '', subject: rep.subject || test.subject || '',
      cls: rep.studentClass || test.class || '', board: rep.board || test.board || '',
      chapter: rep.chapter || test.chapter || '', totalMarks: Number(rep.totalMarks || test.totalMarks) || 0,
      studentName: rep.studentName || '', pageCount: pages.length
    };

    const files = {
      qPdf: { ...qPdf, url: key.questionPdfUrl }, aPdf: { ...aPdf, url: key.answerPdfUrl },
      pages: pages.map((p, i) => ({ ...p, url: pageUrls[i] }))
    };

    // Marking pass and web check run side by side; the web check is best-effort.
    const markingP = markScript(ctx, files);
    const webP = webCheck(ctx, files).catch(e => ({ error: e.message, webMatches: [], aiStyle: { likely: false, detail: '' }, summary: '', sources: [] }));

    const marking = await markingP;
    let ai;
    try { ai = JSON.parse(marking.text); } catch { throw new Error('The AI returned an unreadable report. Please re-run the check.'); }
    const report = normaliseReport(ai, ctx);
    const web = await webP;

    // ── Integrity flags ──
    const flags = [];
    const scriptHash = crypto.createHash('sha256').update(scriptPdf.buffer).digest('hex');
    const created = pdfDate(scriptPdf.buffer, 'CreationDate');
    const started = new Date(rep.startedAt);
    if (created && created < new Date(started.getTime() - 2 * 60000)) {
      flags.push({ type: 'PDF made before the test started', severity: 'high',
        detail: `The PDF's creation time (${created.toISOString()}) is before the student pressed Start (${started.toISOString()}). The script may have been prepared in advance. (Some phones set this time wrongly — check the pages.)` });
    }
    const producer = pdfProducer(scriptPdf.buffer);
    const dups = await findDuplicateScripts(projectId, sa, scriptHash, attemptId).catch(() => []);
    dups.forEach(d => flags.push({ type: 'Same PDF submitted by another student', severity: 'high',
      detail: `Identical file to ${d.studentName || 'another student'}${d.studentId ? ' (' + d.studentId + ')' : ''} — ${d.testName}.` }));
    const late = Number(rep.lateByMin) || 0;
    if (late > UPLOAD_GRACE_MIN) {
      flags.push({ type: 'Late submission', severity: late > 60 ? 'high' : 'medium',
        detail: `Submitted ${late} min after the timer ended (${UPLOAD_GRACE_MIN} min are allowed for scanning and uploading).` });
    }
    const used = Number(rep.usedMin) || 0, dur = Number(rep.durationMin) || 0;
    if (dur && used < dur * 0.25 && report.pct >= 70) {
      flags.push({ type: 'Very fast high score', severity: 'medium',
        detail: `Scored ${report.pct}% but submitted after only ${used} of ${dur} minutes.` });
    }
    (ai.integrityObservations || []).forEach(o => flags.push({
      type: String(o.type || 'Observation'), severity: ['low', 'medium', 'high'].includes(o.severity) ? o.severity : 'low',
      detail: String(o.detail || '') + (o.q ? ` (${o.q})` : '')
    }));
    (web.webMatches || []).filter(w => w.similarity !== 'low').forEach(w => flags.push({
      type: 'Matches an online source', severity: w.similarity === 'high' ? 'high' : 'medium',
      detail: `${w.q ? w.q + ': ' : ''}${w.detail}${w.source ? ' — ' + w.source : ''}`, url: w.url
    }));
    if (web.aiStyle && web.aiStyle.likely) flags.push({ type: 'Possibly AI-written', severity: 'medium', detail: web.aiStyle.detail });

    const order = { none: 0, low: 1, medium: 2, high: 3 };
    const level = flags.reduce((lv, f) => order[f.severity] > order[lv] ? f.severity : lv, 'none');
    const integrity = {
      level, flags,
      web: { summary: web.summary, matches: web.webMatches, sources: web.sources, error: web.error || '' },
      pdf: { createdAt: created ? created.toISOString() : '', producer, pages: pages.length },
      timing: { startedAt: rep.startedAt, submittedAt: rep.submittedAt, usedMin: used, durationMin: dur, lateByMin: late }
    };

    const nowIso = new Date().toISOString();
    await save({
      status: 'ai_checked', aiReport: JSON.stringify(report), finalReport: JSON.stringify(report),
      integrity: JSON.stringify(integrity), integrityLevel: level,
      aiScore: report.totalAwarded, aiMax: report.totalMax,
      scriptHash, aiModel: marking.model, checkedAt: nowIso, error: '',
      aiUsage: JSON.stringify({
        marking: { model: marking.model, ...(marking.usage || {}), fallbackReason: marking.fallbackReason || '' },
        web: { model: web.model || '', ...(web.usage || {}) }
      })
    }, 'ai_checked');
  } catch (e) {
    console.error('[grade-offline]', attemptId, e);
    await save({ status: 'failed', error: (e && e.message) || String(e) }, 'failed').catch(() => {});
  }
  return { statusCode: 200 };
};
