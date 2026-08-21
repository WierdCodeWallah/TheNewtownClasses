/**
 * ════════════════════════════════════════════════════
 *  NCERT SYLLABUS INDEX  (Class 7-12 · Science & Maths)
 *  ──────────────────────────────────────────────────
 *  Single source of truth for the chapter list shown on the public
 *  /ncert/ pages AND in the teacher dashboard's authoring tab.
 *
 *  ── TO EDIT THE SYLLABUS, EDIT ONLY THIS FILE. ──
 *  Add / rename / reorder chapters here and both the public site and the
 *  teacher portal pick the change up on next load. Nothing else to touch.
 *
 *  Chapter lists follow the CURRENT rationalised NCERT syllabus
 *  (2023-24 onwards). If NCERT revises a book, update the array below.
 *
 *  Firestore documents keyed off this file:
 *    ncertSolutions/{class}_{subjectKey}_{NN}   full solution for one chapter
 *    ncertIndex/{class}_{subjectKey}            { published:[1,3,5] } — one
 *                                               tiny doc so the chapter list
 *                                               page needs a single read and
 *                                               no composite index.
 * ════════════════════════════════════════════════════
 */
(function () {

  // ── Class 7-10: Science + Maths ────────────────────────────────
  const SCIENCE_7 = [
    'Nutrition in Plants',
    'Nutrition in Animals',
    'Heat',
    'Acids, Bases and Salts',
    'Physical and Chemical Changes',
    'Respiration in Organisms',
    'Transportation in Animals and Plants',
    'Reproduction in Plants',
    'Motion and Time',
    'Electric Current and its Effects',
    'Light',
    'Forests: Our Lifeline',
    'Wastewater Story'
  ];
  const MATHS_7 = [
    'Integers',
    'Fractions and Decimals',
    'Data Handling',
    'Simple Equations',
    'Lines and Angles',
    'The Triangle and its Properties',
    'Comparing Quantities',
    'Rational Numbers',
    'Perimeter and Area',
    'Algebraic Expressions',
    'Exponents and Powers',
    'Symmetry',
    'Visualising Solid Shapes'
  ];

  const SCIENCE_8 = [
    'Crop Production and Management',
    'Microorganisms: Friend and Foe',
    'Coal and Petroleum',
    'Combustion and Flame',
    'Conservation of Plants and Animals',
    'Reproduction in Animals',
    'Reaching the Age of Adolescence',
    'Force and Pressure',
    'Friction',
    'Sound',
    'Chemical Effects of Electric Current',
    'Some Natural Phenomena',
    'Light'
  ];
  const MATHS_8 = [
    'Rational Numbers',
    'Linear Equations in One Variable',
    'Understanding Quadrilaterals',
    'Data Handling',
    'Squares and Square Roots',
    'Cubes and Cube Roots',
    'Comparing Quantities',
    'Algebraic Expressions and Identities',
    'Mensuration',
    'Exponents and Powers',
    'Direct and Inverse Proportions',
    'Factorisation',
    'Introduction to Graphs'
  ];

  const SCIENCE_9 = [
    'Matter in Our Surroundings',
    'Is Matter Around Us Pure',
    'Atoms and Molecules',
    'Structure of the Atom',
    'The Fundamental Unit of Life',
    'Tissues',
    'Motion',
    'Force and Laws of Motion',
    'Gravitation',
    'Work and Energy',
    'Sound',
    'Improvement in Food Resources'
  ];
  const MATHS_9 = [
    'Number Systems',
    'Polynomials',
    'Coordinate Geometry',
    'Linear Equations in Two Variables',
    "Introduction to Euclid's Geometry",
    'Lines and Angles',
    'Triangles',
    'Quadrilaterals',
    'Circles',
    "Heron's Formula",
    'Surface Areas and Volumes',
    'Statistics'
  ];

  const SCIENCE_10 = [
    'Chemical Reactions and Equations',
    'Acids, Bases and Salts',
    'Metals and Non-metals',
    'Carbon and its Compounds',
    'Life Processes',
    'Control and Coordination',
    'How do Organisms Reproduce?',
    'Heredity',
    'Light — Reflection and Refraction',
    'The Human Eye and the Colourful World',
    'Electricity',
    'Magnetic Effects of Electric Current',
    'Our Environment'
  ];
  const MATHS_10 = [
    'Real Numbers',
    'Polynomials',
    'Pair of Linear Equations in Two Variables',
    'Quadratic Equations',
    'Arithmetic Progressions',
    'Triangles',
    'Coordinate Geometry',
    'Introduction to Trigonometry',
    'Some Applications of Trigonometry',
    'Circles',
    'Areas Related to Circles',
    'Surface Areas and Volumes',
    'Statistics',
    'Probability'
  ];

  // ── Class 11-12: Physics / Chemistry / Biology / Maths ─────────
  const PHYSICS_11 = [
    'Units and Measurements',
    'Motion in a Straight Line',
    'Motion in a Plane',
    'Laws of Motion',
    'Work, Energy and Power',
    'System of Particles and Rotational Motion',
    'Gravitation',
    'Mechanical Properties of Solids',
    'Mechanical Properties of Fluids',
    'Thermal Properties of Matter',
    'Thermodynamics',
    'Kinetic Theory',
    'Oscillations',
    'Waves'
  ];
  const CHEMISTRY_11 = [
    'Some Basic Concepts of Chemistry',
    'Structure of Atom',
    'Classification of Elements and Periodicity in Properties',
    'Chemical Bonding and Molecular Structure',
    'Thermodynamics',
    'Equilibrium',
    'Redox Reactions',
    'Organic Chemistry — Some Basic Principles and Techniques',
    'Hydrocarbons'
  ];
  const BIOLOGY_11 = [
    'The Living World',
    'Biological Classification',
    'Plant Kingdom',
    'Animal Kingdom',
    'Morphology of Flowering Plants',
    'Anatomy of Flowering Plants',
    'Structural Organisation in Animals',
    'Cell: The Unit of Life',
    'Biomolecules',
    'Cell Cycle and Cell Division',
    'Photosynthesis in Higher Plants',
    'Respiration in Plants',
    'Plant Growth and Development',
    'Breathing and Exchange of Gases',
    'Body Fluids and Circulation',
    'Excretory Products and their Elimination',
    'Locomotion and Movement',
    'Neural Control and Coordination',
    'Chemical Coordination and Integration'
  ];
  const MATHS_11 = [
    'Sets',
    'Relations and Functions',
    'Trigonometric Functions',
    'Complex Numbers and Quadratic Equations',
    'Linear Inequalities',
    'Permutations and Combinations',
    'Binomial Theorem',
    'Sequences and Series',
    'Straight Lines',
    'Conic Sections',
    'Introduction to Three Dimensional Geometry',
    'Limits and Derivatives',
    'Statistics',
    'Probability'
  ];

  const PHYSICS_12 = [
    'Electric Charges and Fields',
    'Electrostatic Potential and Capacitance',
    'Current Electricity',
    'Moving Charges and Magnetism',
    'Magnetism and Matter',
    'Electromagnetic Induction',
    'Alternating Current',
    'Electromagnetic Waves',
    'Ray Optics and Optical Instruments',
    'Wave Optics',
    'Dual Nature of Radiation and Matter',
    'Atoms',
    'Nuclei',
    'Semiconductor Electronics: Materials, Devices and Simple Circuits'
  ];
  const CHEMISTRY_12 = [
    'Solutions',
    'Electrochemistry',
    'Chemical Kinetics',
    'The d- and f-Block Elements',
    'Coordination Compounds',
    'Haloalkanes and Haloarenes',
    'Alcohols, Phenols and Ethers',
    'Aldehydes, Ketones and Carboxylic Acids',
    'Amines',
    'Biomolecules'
  ];
  const BIOLOGY_12 = [
    'Sexual Reproduction in Flowering Plants',
    'Human Reproduction',
    'Reproductive Health',
    'Principles of Inheritance and Variation',
    'Molecular Basis of Inheritance',
    'Evolution',
    'Human Health and Disease',
    'Microbes in Human Welfare',
    'Biotechnology: Principles and Processes',
    'Biotechnology and its Applications',
    'Organisms and Populations',
    'Ecosystem',
    'Biodiversity and Conservation'
  ];
  const MATHS_12 = [
    'Relations and Functions',
    'Inverse Trigonometric Functions',
    'Matrices',
    'Determinants',
    'Continuity and Differentiability',
    'Application of Derivatives',
    'Integrals',
    'Application of Integrals',
    'Differential Equations',
    'Vector Algebra',
    'Three Dimensional Geometry',
    'Linear Programming',
    'Probability'
  ];

  // ── Assembled syllabus ─────────────────────────────────────────
  const SYLLABUS = {
    '7':  [ sub('science', 'Science', '🔬', SCIENCE_7),  sub('maths', 'Mathematics', '📐', MATHS_7)  ],
    '8':  [ sub('science', 'Science', '🔬', SCIENCE_8),  sub('maths', 'Mathematics', '📐', MATHS_8)  ],
    '9':  [ sub('science', 'Science', '🔬', SCIENCE_9),  sub('maths', 'Mathematics', '📐', MATHS_9)  ],
    '10': [ sub('science', 'Science', '🔬', SCIENCE_10), sub('maths', 'Mathematics', '📐', MATHS_10) ],
    '11': [
      sub('physics',   'Physics',     '⚛️', PHYSICS_11),
      sub('chemistry', 'Chemistry',   '🧪', CHEMISTRY_11),
      sub('biology',   'Biology',     '🧬', BIOLOGY_11),
      sub('maths',     'Mathematics', '📐', MATHS_11)
    ],
    '12': [
      sub('physics',   'Physics',     '⚛️', PHYSICS_12),
      sub('chemistry', 'Chemistry',   '🧪', CHEMISTRY_12),
      sub('biology',   'Biology',     '🧬', BIOLOGY_12),
      sub('maths',     'Mathematics', '📐', MATHS_12)
    ]
  };

  function sub(key, label, icon, chapters) {
    return {
      key, label, icon,
      chapters: chapters.map((title, i) => ({ num: i + 1, title }))
    };
  }

  // ── Lookup helpers (used by both the public page and the portal) ──
  const CLASSES = ['7', '8', '9', '10', '11', '12'];

  function getClasses() { return CLASSES.slice(); }

  function getSubjects(cls) {
    return (SYLLABUS[String(cls)] || []).slice();
  }

  function getSubject(cls, subjectKey) {
    return getSubjects(cls).find(s => s.key === String(subjectKey)) || null;
  }

  function getChapters(cls, subjectKey) {
    const s = getSubject(cls, subjectKey);
    return s ? s.chapters.slice() : [];
  }

  function getChapter(cls, subjectKey, num) {
    return getChapters(cls, subjectKey).find(c => c.num === parseInt(num, 10)) || null;
  }

  // Firestore doc id for one chapter's solutions, e.g. "10_science_09".
  function docId(cls, subjectKey, num) {
    return `${cls}_${subjectKey}_${String(parseInt(num, 10)).padStart(2, '0')}`;
  }
  // Firestore doc id for the per-subject published index, e.g. "10_science".
  function indexId(cls, subjectKey) {
    return `${cls}_${subjectKey}`;
  }

  // Total chapters across the whole syllabus (used for the landing stat).
  function totalChapters() {
    return CLASSES.reduce((sum, c) =>
      sum + getSubjects(c).reduce((s, sj) => s + sj.chapters.length, 0), 0);
  }

  window.NCERT = {
    SYLLABUS, CLASSES,
    getClasses, getSubjects, getSubject, getChapters, getChapter,
    docId, indexId, totalChapters
  };
})();
