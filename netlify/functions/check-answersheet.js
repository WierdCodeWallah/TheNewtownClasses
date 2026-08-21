/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: check-answersheet
 *  ────────────────────────────────────────────────
 *  AI grader for handwritten SUBJECTIVE answer sheets.
 *
 *  The student dashboard uploads answer-sheet page images to Uploadcare and
 *  calls this function with { idToken, subjectiveTestId, pageUrls[] }. We:
 *    1. Verify the caller's Firebase ID token.
 *    2. Read the question paper + marking key + the student's profile using
 *       the SERVICE ACCOUNT (so the marking key never touches the browser).
 *    3. Send the questions + marking scheme + the answer-sheet images to
 *       Gemini vision and get back structured per-part marks + feedback.
 *    4. Write subjectiveResults/{id} with status 'ai_graded' (service account,
 *       so a student can't fabricate marks). The teacher reviews & releases it.
 *
 *  REQUIRED ENV VARS:
 *    GEMINI_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT
 * ════════════════════════════════════════════════════
 */
const {
  request, fetchBinary,
  verifyFirebaseIdToken, getServiceAccountAccessToken,
  fsGet, fsPatch, decFields
} = require('./_google');

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type'                : 'application/json'
};
function bad(status, msg, extra) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg, ...(extra || {}) }) };
}

const MAX_PAGES = 15;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;   // per image
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;  // all images combined

// Vision-capable models, in preference order. Cached once one works.
const MODEL_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash-latest'];
let _workingModel = null;

function gradeBand(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  return 'D';
}

// JSON schema we ask Gemini to fill (OpenAPI subset understood by the API).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          qId:     { type: 'string' },
          label:   { type: 'string' },
          awarded: { type: 'number' },
          max:     { type: 'number' },
          verdict: { type: 'string', enum: ['full', 'partial', 'zero'] },
          markers: {
            type: 'array',
            items: {
              type: 'object',
              properties: { code: { type: 'string' }, text: { type: 'string' }, ok: { type: 'boolean' } },
              required: ['code', 'text', 'ok']
            }
          },
          comment: { type: 'string' },
          topic:   { type: 'string' }
        },
        required: ['qId', 'label', 'awarded', 'max', 'verdict', 'markers', 'comment', 'topic']
      }
    },
    topicProficiency: {
      type: 'array',
      items: { type: 'object', properties: { topic: { type: 'string' }, pct: { type: 'number' } }, required: ['topic', 'pct'] }
    },
    studyPlan: {
      type: 'array',
      items: { type: 'object', properties: { rank: { type: 'number' }, topic: { type: 'string' }, action: { type: 'string' } }, required: ['rank', 'topic', 'action'] }
    }
  },
  required: ['parts', 'topicProficiency', 'studyPlan']
};

function buildGradingSpec(questions, answers) {
  const keyById = {};
  (answers || []).forEach(a => { keyById[a.qId] = a; });
  return (questions || []).map(q => {
    const k = keyById[q.qId] || {};
    return {
      qId: q.qId,
      label: q.label,
      questionText: q.questionText,
      maxMarks: q.maxMarks,
      topic: q.topic || k.topic || '',
      modelAnswer: k.modelAnswer || '',
      markingPoints: (k.markingPoints || []).map((mp, i) => ({ code: mp.code || ('F' + (i + 1)), text: mp.text || '', marks: mp.marks || 0 }))
    };
  });
}

async function callGeminiVision(apiKey, systemText, userText, images) {
  const parts = [{ text: userText }];
  images.forEach(img => parts.push({ inline_data: { mime_type: img.mimeType, data: img.b64 } }));
  const requestBody = {
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { temperature: 0.15, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };
  const order = _workingModel ? [_workingModel, ...MODEL_FALLBACKS.filter(m => m !== _workingModel)] : MODEL_FALLBACKS.slice();
  let lastError = null;
  for (const model of order) {
    const r = await request('generativelanguage.googleapis.com',
      `/v1beta/models/${model}:generateContent?key=${apiKey}`, 'POST',
      { 'Content-Type': 'application/json' }, requestBody);
    if (r.status === 200) {
      _workingModel = model;
      const cand = r.body?.candidates?.[0];
      const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim();
      if (!text) {
        if (cand?.finishReason === 'SAFETY') throw new Error('The AI could not process this answer sheet. Please re-upload clearer photos.');
        throw new Error('AI returned an empty grading response');
      }
      return text;
    }
    const errMsg = r.body?.error?.message || '';
    if (r.status === 404 || /not found|is not supported/i.test(errMsg)) { lastError = `Model ${model}: ${errMsg}`; continue; }
    if (r.status === 429) throw new Error('The AI grader is busy right now (high demand). Please try again in a minute.');
    throw new Error(`AI service error (${r.status}): ${errMsg || JSON.stringify(r.body)}`);
  }
  throw new Error(`AI service error: no available vision model. Last: ${lastError}`);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return bad(405, 'Method not allowed');

  const missing = ['GEMINI_API_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT'].filter(k => !process.env[k]);
  if (missing.length) return bad(500, `Server is missing env vars: ${missing.join(', ')}`);
  const projectId = process.env.FIREBASE_PROJECT_ID;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }
  const { idToken, subjectiveTestId, pageUrls } = body;
  if (!subjectiveTestId || typeof subjectiveTestId !== 'string') return bad(400, 'Missing subjectiveTestId');
  if (!Array.isArray(pageUrls) || !pageUrls.length) return bad(400, 'No answer-sheet pages provided');
  if (pageUrls.length > MAX_PAGES) return bad(400, `Too many pages (max ${MAX_PAGES}).`);
  if (!pageUrls.every(u => typeof u === 'string' && /^https:\/\/ucarecdn\.com\//i.test(u))) {
    return bad(400, 'Invalid page URL(s).');
  }

  try {
    const { uid } = await verifyFirebaseIdToken(idToken, projectId);
    const saToken = await getServiceAccountAccessToken();

    // Load the assignment, the marking key, and the student profile.
    const [testDoc, keyDoc, studentDoc] = await Promise.all([
      fsGet(projectId, saToken, `subjectiveTests/${subjectiveTestId}`),
      fsGet(projectId, saToken, `subjectiveTestKeys/${subjectiveTestId}`),
      fsGet(projectId, saToken, `students/${uid}`)
    ]);
    if (!testDoc)    return bad(404, 'This assignment no longer exists.');
    if (!studentDoc) return bad(403, 'Only enrolled students can submit answer sheets.');

    const test    = decFields(testDoc);
    const key      = keyDoc ? decFields(keyDoc) : {};
    const student  = decFields(studentDoc);
    const cycle    = parseInt(test.activeCycle || 1, 10) || 1;
    const resultId = `${subjectiveTestId}__${cycle}__${uid}`;

    // Block a second submission for the same cycle (avoids re-billing / overwrite).
    const existing = await fsGet(projectId, saToken, `subjectiveResults/${resultId}`);
    if (existing) return bad(409, 'You have already submitted this answer sheet. Your teacher will review it.');

    let questions = [], answers = [];
    try { questions = JSON.parse(test.questions || '[]'); } catch {}
    try { answers   = JSON.parse(key.answers   || '[]'); } catch {}
    if (!questions.length) return bad(400, 'This assignment has no questions configured.');
    const spec = buildGradingSpec(questions, answers);
    const totalMax = spec.reduce((a, q) => a + (Number(q.maxMarks) || 0), 0);

    // Fetch + inline the answer-sheet images.
    const images = [];
    let totalBytes = 0;
    for (const url of pageUrls) {
      const { buffer, contentType } = await fetchBinary(url);
      if (buffer.length > MAX_IMAGE_BYTES) return bad(400, 'One of the images is too large. Please upload smaller/compressed photos.');
      totalBytes += buffer.length;
      if (totalBytes > MAX_TOTAL_BYTES) return bad(400, 'Uploaded images are too large in total. Please use fewer/smaller photos.');
      const mimeType = /png/i.test(contentType) ? 'image/png' : 'image/jpeg';
      images.push({ mimeType, b64: buffer.toString('base64') });
    }

    const systemText =
      "You are a strict but fair Indian school examiner grading a handwritten SUBJECTIVE answer sheet " +
      "(ICSE/CBSE, classes 7-12). You are given the question paper with each question's maximum marks, the " +
      "model answer, and the specific marking points (F1, F2, ...) that earn marks. Read the student's " +
      "handwriting from the images and grade EACH question/part: award marks per marking point (partial " +
      "marks allowed, never exceed the max), decide verdict full/partial/zero, mark which points were met " +
      "(ok true/false) with a SHORT reason, and give a one-line comment. Be encouraging but honest. If a " +
      "page/answer is unreadable or missing, award 0 for that part and say so in the comment. Also return " +
      "topicProficiency (0-100 per topic based only on this paper) and a studyPlan ranked by marks impact " +
      "(weakest topics first). Respond with ONLY the JSON matching the provided schema.";
    const userText =
      "QUESTION PAPER + MARKING SCHEME (JSON):\n" + JSON.stringify(spec, null, 1) +
      "\n\nThe answer-sheet page images follow. Grade every question above.";

    const raw = await callGeminiVision(process.env.GEMINI_API_KEY, systemText, userText, images);
    let ai;
    try { ai = JSON.parse(raw); } catch { throw new Error('AI returned malformed grading. Please try again.'); }

    // Normalise + clamp marks server-side; compute authoritative totals.
    const maxById = {}; spec.forEach(q => { maxById[q.qId] = Number(q.maxMarks) || 0; });
    const parts = (ai.parts || []).map(p => {
      const max = maxById[p.qId] != null ? maxById[p.qId] : (Number(p.max) || 0);
      let awarded = Number(p.awarded); if (!isFinite(awarded)) awarded = 0;
      awarded = Math.max(0, Math.min(awarded, max));
      const verdict = awarded >= max && max > 0 ? 'full' : (awarded <= 0 ? 'zero' : 'partial');
      return {
        qId: p.qId, label: p.label || '', awarded, max, verdict,
        markers: Array.isArray(p.markers) ? p.markers.map(m => ({ code: String(m.code || ''), text: String(m.text || ''), ok: !!m.ok })) : [],
        comment: String(p.comment || ''), topic: String(p.topic || '')
      };
    });
    const totalAwarded = Math.round(parts.reduce((a, p) => a + p.awarded, 0) * 100) / 100;
    const pct = totalMax > 0 ? Math.round(totalAwarded / totalMax * 100) : 0;

    const grading = {
      parts,
      totalAwarded, totalMax, pct, grade: gradeBand(pct),
      topicProficiency: Array.isArray(ai.topicProficiency) ? ai.topicProficiency.map(t => ({ topic: String(t.topic || ''), pct: Math.max(0, Math.min(100, Math.round(Number(t.pct) || 0))) })) : [],
      studyPlan: Array.isArray(ai.studyPlan) ? ai.studyPlan.map((s, i) => ({ rank: Number(s.rank) || (i + 1), topic: String(s.topic || ''), action: String(s.action || '') })) : []
    };

    const nowIso = new Date().toISOString();
    // Student-readable status marker (the full result stays hidden until the
    // teacher releases it). Lets the dashboard show "awaiting review" vs "new".
    await fsPatch(projectId, saToken, `students/${uid}/answerSheetSubs/${subjectiveTestId}`, {
      subjectiveTestId, cycle, status: 'submitted', submittedAt: nowIso
    }).catch(() => {});
    await fsPatch(projectId, saToken, `subjectiveResults/${resultId}`, {
      subjectiveTestId, uid, cycleAttempted: cycle,
      studentName:  student.name || '',
      studentId:    student.studentId || '',
      studentClass: student.class || '',
      testName:     test.testName || '',
      subject:      test.subject || '',
      teacherUid:   test.teacherUid || '',
      pageUrls,
      status: 'ai_graded',
      grading:      JSON.stringify(grading),
      finalGrading: JSON.stringify(grading),   // teacher edits this copy before release
      teacherNotes: '',
      submittedAt: nowIso, gradedAt: nowIso, releasedAt: ''
    });

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, status: 'ai_graded', resultId }) };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/Invalid Firebase ID token|Missing idToken|token expired/i.test(msg)) return bad(401, msg);
    if (/already submitted/i.test(msg)) return bad(409, msg);
    if (/busy right now/i.test(msg))    return bad(429, msg);
    console.error('[check-answersheet]', e);
    return bad(500, msg);
  }
};
