/**
 * content-access.js — Single source of truth for role-based content access.
 *
 * Used by admin-panel.html, teacher-dashboard.html, and student-dashboard.html.
 * Exposes a global `ContentAccess` object (no bundler needed).
 *
 *   ENROLLMENT TYPES (on student doc: `enrollmentType`)
 *     'normal'     — default; sees only regular content
 *     'foundation' — class 10 only; sees regular + foundation
 *     'jee'        — class 11/12 only; sees regular + jee
 *     'neet'       — class 11/12 only; sees regular + neet
 *
 *   CONTENT TYPES (on chapter doc: `contentType`; on test doc: `testType`)
 *     'regular'    — visible to all students of the target class
 *     'foundation' — visible to foundation students only
 *     'jee'        — visible to JEE students only
 *     'neet'       — visible to NEET students only
 *
 *   ACCESS RULE: a student's allowedContentTypes() = ['regular'] + their own type.
 *   The student's class still has to match the content's class — this module
 *   only governs the type dimension.
 */
(function (global) {
  'use strict';

  // ── Canonical enums ──
  var ENROLLMENT_TYPES = ['normal', 'foundation', 'jee', 'neet'];
  var CONTENT_TYPES    = ['regular', 'foundation', 'jee', 'neet'];

  // Human-readable labels for UI
  var ENROLLMENT_LABELS = {
    normal:     'Normal (Regular class)',
    foundation: 'Foundation',
    jee:        'JEE',
    neet:       'NEET'
  };
  var CONTENT_LABELS = {
    regular:    'Regular',
    foundation: 'Foundation',
    jee:        'JEE',
    neet:       'NEET'
  };

  // ── Class → valid enrollment types ──
  // Class 8/9/10 can be 'normal' or 'foundation' (10 most common use)
  // Class 11/12 can be 'normal', 'jee' or 'neet'
  function validEnrollmentTypesForClass(cls) {
    var c = String(cls || '').trim();
    if (c === '11' || c === '12') return ['normal', 'jee', 'neet'];
    // Default: treat 7–10 as foundation-eligible
    return ['normal', 'foundation'];
  }

  // Same rules apply to content type options when creating a test/chapter
  // for a given class.
  function validContentTypesForClass(cls) {
    var c = String(cls || '').trim();
    if (c === '11' || c === '12') return ['regular', 'jee', 'neet'];
    return ['regular', 'foundation'];
  }

  // ── Normalization (read-time defaults) ──
  function normalizeEnrollmentType(value) {
    var v = String(value == null ? '' : value).toLowerCase().trim();
    if (ENROLLMENT_TYPES.indexOf(v) !== -1) return v;
    // Backward-compat: legacy `stream` field values
    if (v === 'foundation') return 'foundation';
    if (v === 'jee')        return 'jee';
    if (v === 'neet')       return 'neet';
    return 'normal';
  }

  function normalizeContentType(value) {
    var v = String(value == null ? '' : value).toLowerCase().trim();
    if (CONTENT_TYPES.indexOf(v) !== -1) return v;
    return 'regular';
  }

  // ── Access rule ──
  // Returns the array of content types the student is allowed to see,
  // e.g. ['regular'] for a normal student, ['regular','jee'] for a JEE student.
  function allowedContentTypes(enrollmentType) {
    var t = normalizeEnrollmentType(enrollmentType);
    if (t === 'normal') return ['regular'];
    // Student-type enum value happens to match the corresponding content-type
    // enum value for foundation/jee/neet.
    return ['regular', t];
  }

  // Quick check: can this student see a given piece of content?
  // content: { contentType? , testType? , class? }
  // student: { enrollmentType, class }
  function canStudentSee(student, content) {
    if (!student || !content) return false;
    // Class must match (string compare; both come from Firestore as strings).
    if (content['class'] != null && student['class'] != null &&
        String(content['class']) !== String(student['class'])) {
      return false;
    }
    var ctype = normalizeContentType(
      content.contentType != null ? content.contentType : content.testType
    );
    return allowedContentTypes(student.enrollmentType).indexOf(ctype) !== -1;
  }

  // Filter an array of content items for a student.
  function filterContentForStudent(items, student) {
    if (!Array.isArray(items)) return [];
    return items.filter(function (it) { return canStudentSee(student, it); });
  }

  // Validate a class + enrollmentType combo (for form validation).
  // Returns null if OK, else an error message.
  function validateEnrollment(cls, enrollmentType) {
    var valid = validEnrollmentTypesForClass(cls);
    var t = normalizeEnrollmentType(enrollmentType);
    if (valid.indexOf(t) === -1) {
      return 'Enrollment type "' + t + '" is not available for class ' + cls + '.';
    }
    return null;
  }

  function validateContentType(cls, contentType) {
    var valid = validContentTypesForClass(cls);
    var t = normalizeContentType(contentType);
    if (valid.indexOf(t) === -1) {
      return 'Content type "' + t + '" is not available for class ' + cls + '.';
    }
    return null;
  }

  // Populate a <select> with role options for the given class.
  // Pass kind='enrollment' (for students) or kind='content' (for chapters/tests).
  function populateSelect(selectEl, cls, kind, currentValue) {
    if (!selectEl) return;
    var opts = (kind === 'content')
      ? validContentTypesForClass(cls)
      : validEnrollmentTypesForClass(cls);
    var labels = (kind === 'content') ? CONTENT_LABELS : ENROLLMENT_LABELS;
    var current = String(currentValue || '').toLowerCase();
    selectEl.innerHTML = opts.map(function (v) {
      var selected = (v === current) ? ' selected' : '';
      return '<option value="' + v + '"' + selected + '>' + labels[v] + '</option>';
    }).join('');
  }

  // Expose
  global.ContentAccess = {
    ENROLLMENT_TYPES: ENROLLMENT_TYPES,
    CONTENT_TYPES: CONTENT_TYPES,
    ENROLLMENT_LABELS: ENROLLMENT_LABELS,
    CONTENT_LABELS: CONTENT_LABELS,
    validEnrollmentTypesForClass: validEnrollmentTypesForClass,
    validContentTypesForClass: validContentTypesForClass,
    normalizeEnrollmentType: normalizeEnrollmentType,
    normalizeContentType: normalizeContentType,
    allowedContentTypes: allowedContentTypes,
    canStudentSee: canStudentSee,
    filterContentForStudent: filterContentForStudent,
    validateEnrollment: validateEnrollment,
    validateContentType: validateContentType,
    populateSelect: populateSelect
  };
})(typeof window !== 'undefined' ? window : this);
