/**
 * ════════════════════════════════════════════════════
 *  THE NEWTOWN CLASSES — Live Classes Module (Zoom)
 * ════════════════════════════════════════════════════
 *
 *  This module is a thin Firestore + Zoom helper. It does NOT embed Zoom.
 *  The teacher/admin pastes a Zoom meeting link when scheduling a class,
 *  and each dashboard renders a "Join Class" button that opens that link
 *  in a new tab (so Android/iOS will hand it off to the Zoom app when
 *  installed, or fall back to Zoom's mobile web client otherwise).
 *
 *  Firestore collection: `liveClasses`
 *    className, subject, classGrade, teacherUid, teacherName,
 *    date, time, durationMins, status ('scheduled'|'ended'|'cancelled'),
 *    scheduledTs, zoomJoinUrl, zoomMeetingId (optional), zoomPasscode (optional)
 *
 *  ── RECORDING FIELDS (added 2026) ──
 *    recordingUrl       — public play_url (Zoom Cloud Recording, YouTube, Drive, etc.)
 *    recordingPassword  — optional viewer password (Zoom share password)
 *    recordingSource    — 'zoom_cloud' | 'youtube' | 'drive' | 'other'
 *    recordingAddedAt   — epoch ms when the recording was attached
 * ════════════════════════════════════════════════════
 */

import { FIREBASE_CONFIG } from './firebase-config.js';

const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const IST_OFFSET = 5.5 * 60; // minutes

// ════════════════════════════════════════════════════
// ── ZOOM LINK HELPERS ──
// ════════════════════════════════════════════════════

/**
 * Normalises whatever the admin pastes (full https://us02web.zoom.us/j/…,
 * zoommtg://…, bare ID, "123 456 7890", etc.) into a safe https URL that
 * every OS + browser can open. Returns { url, meetingId } or null if the
 * input doesn't look like a Zoom meeting.
 */
export function parseZoomInput(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Already a Zoom HTTP(S) link — keep it intact (it may contain pwd=… we
  // don't want to strip). Only validate the host.
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (/(^|\.)zoom\.us$/i.test(u.hostname)) {
      const m = u.pathname.match(/\/(?:j|my|w|s)\/([A-Za-z0-9]+)/);
      return {
        url: u.toString().replace(/^http:/i, 'https:'),
        meetingId: m ? m[1] : ''
      };
    }
  } catch {}

  // zoommtg:// or zoomus:// app scheme — convert to web URL
  const appMatch = s.match(/^zoom(?:mtg|us):\/\/[^/]*\/join\?.*\bconfno=(\d+)(?:.*\bpwd=([^&]+))?/i);
  if (appMatch) {
    const id = appMatch[1];
    const pwd = appMatch[2] ? `?pwd=${appMatch[2]}` : '';
    return { url: `https://zoom.us/j/${id}${pwd}`, meetingId: id };
  }

  // Just a meeting ID like "123 456 7890" or "1234567890"
  const idOnly = s.replace(/\s|-/g, '');
  if (/^\d{9,11}$/.test(idOnly)) {
    return { url: `https://zoom.us/j/${idOnly}`, meetingId: idOnly };
  }

  return null;
}

/**
 * The URL we hand to window.open / anchor href. We always return the
 * https form — the OS/browser will deep-link into the Zoom app automatically
 * when it is installed (Android intent filter, iOS Universal Link, Chrome on
 * desktop), and otherwise fall back to Zoom's web client. No iframe.
 *
 * Optional `opts.uname` prefills the display name on Zoom's web client
 * (used when a teacher joins so they show up as "The NewTown Classes"
 * instead of their personal Zoom profile name). The Zoom desktop/mobile
 * apps may ignore this param and use the signed-in Zoom profile name,
 * so teachers should also rename their Zoom profile to match.
 */
export function buildZoomJoinUrl(zoomJoinUrl, opts) {
  const parsed = parseZoomInput(zoomJoinUrl);
  if (!parsed) return '';
  let url = parsed.url;
  const uname = opts && opts.uname;
  if (uname) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}uname=${encodeURIComponent(uname)}`;
  }
  return url;
}

/**
 * Formats the meeting ID for display, e.g. "1234567890" -> "123 456 7890".
 */
export function formatMeetingId(id) {
  const s = String(id || '').replace(/\D/g, '');
  if (s.length === 10) return `${s.slice(0,3)} ${s.slice(3,6)} ${s.slice(6)}`;
  if (s.length === 11) return `${s.slice(0,3)} ${s.slice(3,7)} ${s.slice(7)}`;
  return s;
}

// ════════════════════════════════════════════════════
// ── FIRESTORE CRUD (liveClasses collection) ──
// ════════════════════════════════════════════════════
function fsVal(v) {
  if (v === null || v === undefined)     return { nullValue: null };
  if (typeof v === 'string')             return { stringValue: v };
  if (typeof v === 'number')             return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean')            return { booleanValue: v };
  return { nullValue: null };
}
function fsRead(f) {
  if (!f) return null;
  if (f.stringValue  !== undefined) return f.stringValue;
  if (f.doubleValue  !== undefined) return Number(f.doubleValue);
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.booleanValue !== undefined) return f.booleanValue;
  return null;
}
function docToClass(doc) {
  const f = doc.fields || {};
  const id = doc.name.split('/').pop();
  return {
    id,
    className    : fsRead(f.className),
    subject      : fsRead(f.subject),
    chapter      : fsRead(f.chapter) || '',
    module       : fsRead(f.module) || '',
    classGrade   : fsRead(f.classGrade),
    teacherUid   : fsRead(f.teacherUid),
    teacherName  : fsRead(f.teacherName),
    date         : fsRead(f.date),
    time         : fsRead(f.time),
    durationMins : fsRead(f.durationMins),
    status       : fsRead(f.status) || 'scheduled',
    scheduledTs  : fsRead(f.scheduledTs),
    zoomJoinUrl  : fsRead(f.zoomJoinUrl) || '',
    zoomMeetingId: fsRead(f.zoomMeetingId) || '',
    zoomPasscode : fsRead(f.zoomPasscode) || '',
    // Role-based content type: 'regular' | 'foundation' | 'jee' | 'neet'.
    // Legacy classes (uploaded before this field existed) fall back to 'regular'
    // so they remain visible to every student of the target grade.
    classType    : (fsRead(f.classType) || 'regular'),
    // Optional board/subject targeting (added 2026): empty string = no restriction.
    targetBoard  : fsRead(f.targetBoard)   || '',
    targetSubject: fsRead(f.targetSubject) || '',
    // ── Recording fields (added 2026) ──
    recordingUrl     : fsRead(f.recordingUrl)     || '',
    recordingPassword: fsRead(f.recordingPassword) || '',
    recordingSource  : fsRead(f.recordingSource)  || '',
    recordingAddedAt : fsRead(f.recordingAddedAt) || 0
  };
}

export async function saveClass(authToken, classDoc) {
  const id = `lc-${Date.now()}`;
  const fields = {};
  Object.entries(classDoc).forEach(([k, v]) => { fields[k] = fsVal(v); });
  const res = await fetch(`${FS_BASE}/liveClasses/${id}?key=${FIREBASE_CONFIG.apiKey}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Save failed'); }
  return id;
}

export async function fetchClasses(authToken) {
  const documents = [];
  let pageToken = '';
  do {
    const res = await fetch(`${FS_BASE}/liveClasses?key=${FIREBASE_CONFIG.apiKey}&pageSize=200${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`,
      { headers: { Authorization: `Bearer ${authToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Could not load classes. Please retry.');
    documents.push(...(data.documents || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return documents.map(docToClass).sort((a, b) => (b.scheduledTs || 0) - (a.scheduledTs || 0));
}

export async function updateClass(authToken, classId, fields) {
  const fsFields = {};
  Object.entries(fields).forEach(([k, v]) => { fsFields[k] = fsVal(v); });
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(`${FS_BASE}/liveClasses/${classId}?${mask}&key=${FIREBASE_CONFIG.apiKey}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fsFields })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Update failed'); }
}

export async function deleteClass(authToken, classId) {
  const res = await fetch(`${FS_BASE}/liveClasses/${classId}?key=${FIREBASE_CONFIG.apiKey}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` }
  });
  if (!res.ok && res.status !== 404) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || 'Delete failed');
  }
}

// ════════════════════════════════════════════════════
// ── TIME HELPERS ──
// ════════════════════════════════════════════════════

/** Convert an IST date (YYYY-MM-DD) + time (HH:MM) into a UTC ms timestamp. */
export function toScheduledTs(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [hr, mn]   = time.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, hr, mn) - IST_OFFSET * 60000;
}

/**
 * Returns one of: 'upcoming' | 'joining_soon' | 'live' | 'ended'.
 *   • joining_soon — 30 to 5 min before start
 *   • live         — 5 min before start through the scheduled end
 *   • ended        — after the scheduled end
 */
export function classTimeStatus(scheduledTs, durationMins) {
  const now = Date.now();
  const end = scheduledTs + (durationMins || 60) * 60000;
  if (now >= end)                     return 'ended';
  if (now >= scheduledTs - 5 * 60000) return 'live';
  if (now >= scheduledTs - 30 * 60000) return 'joining_soon';
  return 'upcoming';
}

/**
 * The core policy: can a student tap Join right now? YES from 5 min before
 * start until the class end time, and ONLY if the class is not cancelled
 * and has a zoom link saved.
 */
export function canJoinZoom(classDoc) {
  if (!classDoc || classDoc.status === 'cancelled') return false;
  if (!classDoc.zoomJoinUrl) return false;
  const now = Date.now();
  const end = classDoc.scheduledTs + (classDoc.durationMins || 60) * 60000;
  return now >= classDoc.scheduledTs - 5 * 60000 && now < end;
}

export function fmtClassTime(scheduledTs) {
  const d = new Date(scheduledTs);
  return d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', timeZone:'Asia/Kolkata' })
    + ' · '
    + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'Asia/Kolkata' }).toUpperCase()
    + ' IST';
}

/** Human readable "Starts in 12 min" / "Live now" / "Ended" for lists. */
export function relativeJoinLabel(scheduledTs, durationMins) {
  const status = classTimeStatus(scheduledTs, durationMins);
  if (status === 'ended')        return 'Ended';
  if (status === 'live')         return '🔴 Live now';
  const minsUntil = Math.round((scheduledTs - Date.now()) / 60000);
  if (minsUntil <= 1)            return 'Starting soon';
  if (minsUntil < 60)            return `Starts in ${minsUntil} min`;
  const hoursUntil = Math.round(minsUntil / 60);
  if (hoursUntil < 24)           return `Starts in ${hoursUntil} hr`;
  const daysUntil = Math.round(hoursUntil / 24);
  return `In ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
}

export const STATUS_BADGE = {
  scheduled   : '<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:.2rem .6rem;border-radius:6px;font-size:.72rem;font-weight:700;">SCHEDULED</span>',
  upcoming    : '<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:.2rem .6rem;border-radius:6px;font-size:.72rem;font-weight:700;">SCHEDULED</span>',
  live        : '<span style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;padding:.2rem .6rem;border-radius:6px;font-size:.72rem;font-weight:700;">🔴 LIVE NOW</span>',
  ended       : '<span style="background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb;padding:.2rem .6rem;border-radius:6px;font-size:.72rem;font-weight:700;">ENDED</span>',
  cancelled   : '<span style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:.2rem .6rem;border-radius:6px;font-size:.72rem;font-weight:700;">CANCELLED</span>',
  joining_soon: '<span style="background:#fefce8;color:#a16207;border:1px solid #fde68a;padding:.2rem .6rem;border-radius:6px;font-size:.72rem;font-weight:700;">⏳ STARTING SOON</span>'
};

// ════════════════════════════════════════════════════
// ── CLIENT-SIDE JOIN HELPER ──
// Call this from an onclick to open the meeting in a new tab. On Android/
// iOS the OS will route the https link into the installed Zoom app; on
// desktop Chrome/Edge will prompt to open Zoom. No iframe, no SDK embed.
// ════════════════════════════════════════════════════
export function openZoomJoin(zoomJoinUrl) {
  const url = buildZoomJoinUrl(zoomJoinUrl);
  if (!url) { alert('This class does not have a Zoom link yet. Please contact your teacher.'); return; }
  // target=_blank with noopener so the dashboard is not held open by Zoom
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) {
    // Pop-up blocked — fall back to same-tab navigation
    window.location.href = url;
  }
}

// Expose as window.__ntcJoinZoom so inline onclick handlers in the dashboards
// can call it without needing to re-import the module.
if (typeof window !== 'undefined') {
  window.__ntcJoinZoom = openZoomJoin;
}

// ════════════════════════════════════════════════════
// ── RECORDINGS ──
// ════════════════════════════════════════════════════

/**
 * Detects what kind of link the teacher/admin pasted, so the dashboard
 * can show a friendly source badge. Recognises:
 *   • Zoom cloud recordings (zoom.us/rec/share/…  or  …/rec/play/…)
 *   • YouTube (youtu.be / youtube.com / youtube-nocookie.com)
 *   • Google Drive (drive.google.com / docs.google.com)
 *   • Anything else → 'other'
 */
export function detectRecordingSource(url) {
  if (!url) return '';
  const u = String(url).trim().toLowerCase();
  if (/(^|\.)zoom\.us\/rec\//i.test(u))                   return 'zoom_cloud';
  if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(u)) return 'youtube';
  if (/(^|\.)(drive|docs)\.google\.com/i.test(u))         return 'drive';
  return 'other';
}

/**
 * Lightweight URL validator for the "paste recording link" forms. Accepts
 * any https URL — we don't restrict to a single host because teachers
 * may legitimately upload to many places.
 */
export function isLikelyRecordingUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(String(url).trim().match(/^https?:\/\//i) ? url : `https://${url}`);
    return /^https?:$/.test(u.protocol) && !!u.hostname && u.hostname.includes('.');
  } catch { return false; }
}

/**
 * Convenience updater used by teacher-dashboard / admin-panel "Add recording"
 * actions. Marks the class as ended too so it disappears from the
 * upcoming list and shows up under recordings.
 */
export async function attachRecording(authToken, classId, { recordingUrl, recordingPassword, recordingSource }) {
  return updateClass(authToken, classId, {
    recordingUrl     : recordingUrl || '',
    recordingPassword: recordingPassword || '',
    recordingSource  : recordingSource || detectRecordingSource(recordingUrl),
    recordingAddedAt : Date.now(),
    status           : 'ended'
  });
}

/** Pretty-print the source for badges. */
export const RECORDING_SOURCE_LABEL = {
  zoom_cloud: 'Zoom Cloud',
  youtube   : 'YouTube',
  drive     : 'Google Drive',
  other     : 'Recording'
};

/** A badge HTML chip (mirrors STATUS_BADGE styling). */
export function recordingSourceBadge(source) {
  const label = RECORDING_SOURCE_LABEL[source] || 'Recording';
  const colorMap = {
    zoom_cloud: ['#eef2ff', '#4338ca', '#c7d2fe'],
    youtube   : ['#fef2f2', '#dc2626', '#fecaca'],
    drive     : ['#f0fdf4', '#15803d', '#bbf7d0'],
    other     : ['#f9fafb', '#374151', '#e5e7eb']
  };
  const [bg, fg, br] = colorMap[source] || colorMap.other;
  return `<span style="background:${bg};color:${fg};border:1px solid ${br};padding:.2rem .6rem;border-radius:6px;font-size:.7rem;font-weight:700;">📼 ${label}</span>`;
}
