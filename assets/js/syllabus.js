/* Chapter lists for Custom module tests (Classes 7–12), shared by the portal
   and the Netlify functions (which use them to validate orders and prices).

   ── TO CHANGE A SYLLABUS, EDIT ONLY THIS FILE. ──
   CBSE: NCERT books for the current session. Classes 7–8 use the new books
         (Science: "Curiosity"; Maths: "Ganita Prakash" Parts 1 and 2, chapters
         in book order). Classes 9–12: rationalised NCERT books; Classes 7–10
         study Science as one subject.
   CISCE: ICSE (Classes 7–10) and ISC (Classes 11–12). CISCE prescribes no single
         book for Classes 7–8, so those lists follow the widely used Selina
         Concise books (Physics, Chemistry, Biology, Mathematics); a teacher
         should check them against the school's book list each session.
   Social studies (Classes 9–10): CBSE "Social Science" (rationalised NCERT
         History, Geography, Political Science, Economics — chapters prefixed
         with the book); ICSE "History & Civics" and "Geography" (CISCE
         syllabus, Selina chapter order). Classes 7–8 social studies are not
         listed yet: NCERT's new 2025 books are still changing.
   Computer: CBSE Computer Applications (165) for 9–10, Computer Science (083)
         for 11–12; ICSE Computer Applications for 9–10, ISC Computer Science
         for 11–12 — current session syllabus units.
   A chapter's title is its ID in orders, so rename with care: a renamed
   chapter only affects new orders. */
(function (root) {
  'use strict';
  const CBSE = {
    '7': {
      Science: ['The Ever-Evolving World of Science', 'Exploring Substances: Acidic, Basic and Neutral', 'Electricity: Circuits and their Components',
        'The World of Metals and Non-metals', 'Changes Around Us: Physical and Chemical', 'Adolescence: A Stage of Growth and Change', 'Heat Transfer in Nature',
        'Measurement of Time and Motion', 'Life Processes in Animals', 'Life Processes in Plants', 'Light: Shadows and Reflections', 'Earth, Moon and the Sun'],
      Mathematics: ['Large Numbers Around Us', 'Arithmetic Expressions', 'A Peek Beyond the Point', 'Expressions using Letter-Numbers', 'Parallel and Intersecting Lines',
        'Number Play', 'A Tale of Three Intersecting Lines', 'Working with Fractions', 'Geometric Twins', 'Operations with Integers', 'Finding Common Ground',
        'Another Peek Beyond the Point', 'Connecting the Dots', 'Constructions and Tilings', 'Finding the Unknown']
    },
    '8': {
      Science: ['Exploring the Investigative World of Science', 'The Invisible Living World: Beyond Our Naked Eye', 'Health: The Ultimate Treasure',
        'Electricity: Magnetic and Heating Effects', 'Exploring Forces', 'Pressure, Winds, Storms and Cyclones', 'Particulate Nature of Matter',
        'Nature of Matter: Elements, Compounds and Mixtures', 'The Amazing World of Solutes, Solvents and Solutions', 'Light: Mirrors and Lenses',
        'Keeping Time with the Skies', 'How Nature Works in Harmony', 'Our Home: Earth, a Unique Life Sustaining Planet'],
      Mathematics: ['A Square and A Cube', 'Power Play', 'A Story of Numbers', 'Quadrilaterals', 'Number Play', 'We Distribute, Yet Things Multiply',
        'Proportional Reasoning-1', 'Fractions in Disguise', 'The Baudhayana-Pythagoras Theorem', 'Proportional Reasoning-2', 'Exploring Some Geometric Themes',
        'Tales by Dots and Lines', 'Algebra Play', 'Area']
    },
    '9': {
      Science: ['Matter in Our Surroundings', 'Is Matter Around Us Pure?', 'Atoms and Molecules', 'Structure of the Atom', 'The Fundamental Unit of Life', 'Tissues',
        'Motion', 'Force and Laws of Motion', 'Gravitation', 'Work and Energy', 'Sound', 'Improvement in Food Resources'],
      Mathematics: ['Number Systems', 'Polynomials', 'Coordinate Geometry', 'Linear Equations in Two Variables', "Introduction to Euclid's Geometry", 'Lines and Angles',
        'Triangles', 'Quadrilaterals', 'Circles', "Heron's Formula", 'Surface Areas and Volumes', 'Statistics'],
      'Social Science': ['History · The French Revolution', 'History · Socialism in Europe and the Russian Revolution', 'History · Nazism and the Rise of Hitler',
        'History · Forest Society and Colonialism', 'History · Pastoralists in the Modern World', 'Geography · India: Size and Location',
        'Geography · Physical Features of India', 'Geography · Drainage', 'Geography · Climate', 'Geography · Natural Vegetation and Wildlife',
        'Geography · Population', 'Political Science · What is Democracy? Why Democracy?', 'Political Science · Constitutional Design',
        'Political Science · Electoral Politics', 'Political Science · Working of Institutions', 'Political Science · Democratic Rights',
        'Economics · The Story of Village Palampur', 'Economics · People as Resource', 'Economics · Poverty as a Challenge',
        'Economics · Food Security in India'],
      Computer: ['Basics of Information Technology', 'Computer Hardware and Software', 'Cyber Safety', 'Word Processing', 'Presentation Tools', 'Spreadsheets',
        'Scratch Programming', 'Python Basics']
    },
    '10': {
      Science: ['Chemical Reactions and Equations', 'Acids, Bases and Salts', 'Metals and Non-metals', 'Carbon and its Compounds', 'Life Processes', 'Control and Coordination',
        'How do Organisms Reproduce?', 'Heredity', 'Light — Reflection and Refraction', 'The Human Eye and the Colourful World', 'Electricity',
        'Magnetic Effects of Electric Current', 'Our Environment'],
      Mathematics: ['Real Numbers', 'Polynomials', 'Pair of Linear Equations in Two Variables', 'Quadratic Equations', 'Arithmetic Progressions', 'Triangles',
        'Coordinate Geometry', 'Introduction to Trigonometry', 'Some Applications of Trigonometry', 'Circles', 'Areas Related to Circles',
        'Surface Areas and Volumes', 'Statistics', 'Probability'],
      'Social Science': ['History · The Rise of Nationalism in Europe', 'History · Nationalism in India', 'History · The Making of a Global World',
        'History · The Age of Industrialisation', 'History · Print Culture and the Modern World', 'Geography · Resources and Development',
        'Geography · Forest and Wildlife Resources', 'Geography · Water Resources', 'Geography · Agriculture', 'Geography · Minerals and Energy Resources',
        'Geography · Manufacturing Industries', 'Geography · Lifelines of National Economy', 'Political Science · Power-sharing',
        'Political Science · Federalism', 'Political Science · Gender, Religion and Caste', 'Political Science · Political Parties',
        'Political Science · Outcomes of Democracy', 'Economics · Development', 'Economics · Sectors of the Indian Economy', 'Economics · Money and Credit',
        'Economics · Globalisation and the Indian Economy'],
      Computer: ['Networking and the Internet', 'Internet Services: Email, Chat and E-commerce', 'Introduction to HTML', 'HTML Text Formatting and Lists',
        'HTML Images and Links', 'HTML Tables', 'Audio and Video in HTML', 'Cyber Ethics']
    },
    '11': {
      Physics: ['Units and Measurements', 'Motion in a Straight Line', 'Motion in a Plane', 'Laws of Motion', 'Work, Energy and Power', 'System of Particles and Rotational Motion',
        'Gravitation', 'Mechanical Properties of Solids', 'Mechanical Properties of Fluids', 'Thermal Properties of Matter', 'Thermodynamics', 'Kinetic Theory', 'Oscillations', 'Waves'],
      Chemistry: ['Some Basic Concepts of Chemistry', 'Structure of Atom', 'Classification of Elements and Periodicity in Properties', 'Chemical Bonding and Molecular Structure',
        'Thermodynamics', 'Equilibrium', 'Redox Reactions', 'Organic Chemistry — Some Basic Principles and Techniques', 'Hydrocarbons'],
      Biology: ['The Living World', 'Biological Classification', 'Plant Kingdom', 'Animal Kingdom', 'Morphology of Flowering Plants', 'Anatomy of Flowering Plants',
        'Structural Organisation in Animals', 'Cell: The Unit of Life', 'Biomolecules', 'Cell Cycle and Cell Division', 'Photosynthesis in Higher Plants', 'Respiration in Plants',
        'Plant Growth and Development', 'Breathing and Exchange of Gases', 'Body Fluids and Circulation', 'Excretory Products and their Elimination', 'Locomotion and Movement',
        'Neural Control and Coordination', 'Chemical Coordination and Integration'],
      Mathematics: ['Sets', 'Relations and Functions', 'Trigonometric Functions', 'Complex Numbers and Quadratic Equations', 'Linear Inequalities', 'Permutations and Combinations',
        'Binomial Theorem', 'Sequences and Series', 'Straight Lines', 'Conic Sections', 'Introduction to Three Dimensional Geometry', 'Limits and Derivatives', 'Statistics', 'Probability'],
      Computer: ['Computer Systems and Organisation', 'Boolean Logic', 'Number Systems and Encoding Schemes', 'Introduction to Problem Solving',
        'Getting Started with Python', 'Flow of Control', 'Strings', 'Lists', 'Tuples and Dictionaries', 'Python Modules', 'Society, Law and Ethics']
    },
    '12': {
      Physics: ['Electric Charges and Fields', 'Electrostatic Potential and Capacitance', 'Current Electricity', 'Moving Charges and Magnetism', 'Magnetism and Matter',
        'Electromagnetic Induction', 'Alternating Current', 'Electromagnetic Waves', 'Ray Optics and Optical Instruments', 'Wave Optics', 'Dual Nature of Radiation and Matter',
        'Atoms', 'Nuclei', 'Semiconductor Electronics'],
      Chemistry: ['Solutions', 'Electrochemistry', 'Chemical Kinetics', 'The d- and f-Block Elements', 'Coordination Compounds', 'Haloalkanes and Haloarenes',
        'Alcohols, Phenols and Ethers', 'Aldehydes, Ketones and Carboxylic Acids', 'Amines', 'Biomolecules'],
      Biology: ['Sexual Reproduction in Flowering Plants', 'Human Reproduction', 'Reproductive Health', 'Principles of Inheritance and Variation', 'Molecular Basis of Inheritance',
        'Evolution', 'Human Health and Disease', 'Microbes in Human Welfare', 'Biotechnology: Principles and Processes', 'Biotechnology and its Applications',
        'Organisms and Populations', 'Ecosystem', 'Biodiversity and Conservation'],
      Mathematics: ['Relations and Functions', 'Inverse Trigonometric Functions', 'Matrices', 'Determinants', 'Continuity and Differentiability', 'Application of Derivatives',
        'Integrals', 'Application of Integrals', 'Differential Equations', 'Vector Algebra', 'Three Dimensional Geometry', 'Linear Programming', 'Probability'],
      Computer: ['Python Revision Tour', 'Functions', 'Exception Handling', 'File Handling: Text, Binary and CSV Files', 'Data Structures: Stack',
        'Computer Networks', 'Database Concepts', 'Structured Query Language (SQL)', 'Interface Python with MySQL']
    }
  };
  const CISCE = {
    '7': {
      Physics: ['Physical Quantities and Measurement', 'Motion', 'Energy', 'Light Energy', 'Heat', 'Sound', 'Electricity and Magnetism'],
      Chemistry: ['Matter and its Composition', 'Physical and Chemical Changes', 'Elements, Compounds and Mixtures', 'Atoms, Molecules and Radicals',
        'Language of Chemistry', 'Metals and Non-metals', 'Air and Atmosphere'],
      Biology: ['Plant and Animal Tissues', 'Classification of Plants', 'Classification of Animals', 'Photosynthesis and Respiration', 'Excretion in Humans',
        'Nervous System', 'Health and Hygiene', 'Allergy'],
      Mathematics: ['Integers', 'Rational Numbers', 'Fractions', 'Decimal Fractions', 'Exponents', 'Ratio and Proportion', 'Unitary Method', 'Percent and Percentage',
        'Profit, Loss and Discount', 'Simple Interest', 'Fundamental Concepts of Algebra', 'Simple Linear Equations', 'Set Concepts', 'Lines and Angles', 'Triangles',
        'Pythagoras Theorem', 'Symmetry', 'Recognition of Solids', 'Congruency of Triangles', 'Mensuration', 'Data Handling', 'Probability']
    },
    '8': {
      Physics: ['Matter', 'Physical Quantities and Measurement', 'Force and Pressure', 'Energy', 'Light Energy', 'Heat Transfer', 'Sound', 'Electricity'],
      Chemistry: ['Matter', 'Physical and Chemical Changes', 'Elements, Compounds and Mixtures', 'Atomic Structure', 'Language of Chemistry', 'Chemical Reactions',
        'Hydrogen', 'Water', 'Carbon and its Compounds'],
      Biology: ['Transportation in Plants', 'Reproduction in Plants', 'Reproduction in Humans', 'Ecosystems', 'Endocrine System and Adolescence',
        'The Circulatory System', 'Nervous System', 'Diseases and First Aid', 'Food Production'],
      Mathematics: ['Rational Numbers', 'Exponents', 'Squares and Square Roots', 'Cubes and Cube Roots', 'Playing with Numbers', 'Sets', 'Percent and Percentage',
        'Profit, Loss and Discount', 'Simple and Compound Interest', 'Direct and Inverse Variations', 'Algebraic Expressions', 'Algebraic Identities', 'Factorisation',
        'Linear Equations in One Variable', 'Linear Inequations', 'Understanding Shapes', 'Special Types of Quadrilaterals', 'Constructions',
        'Area of Trapezium and Polygon', 'Three-Dimensional Solids', 'Surface Area, Volume and Capacity', 'Data Handling', 'Probability']
    },
    '9': {
      Physics: ['Measurements and Experimentation', 'Motion in One Dimension', 'Laws of Motion', 'Pressure in Fluids and Atmospheric Pressure',
        "Upthrust in Fluids, Archimedes' Principle and Floatation", 'Heat and Energy', 'Reflection of Light', 'Propagation of Sound Waves', 'Current Electricity', 'Magnetism'],
      Chemistry: ['The Language of Chemistry', 'Chemical Changes and Reactions', 'Water', 'Atomic Structure and Chemical Bonding', 'The Periodic Table',
        'Study of the First Element — Hydrogen', 'Study of Gas Laws', 'Atmospheric Pollution'],
      Biology: ['Cell: The Unit of Life', 'Tissues: Plant and Animal Tissues', 'The Flower', 'Pollination and Fertilization', 'Seeds: Structure and Germination',
        'Respiration in Plants', 'Five Kingdom Classification', 'Economic Importance of Bacteria and Fungi', 'Nutrition and the Digestive System', 'Skeleton: Movement and Locomotion',
        'Skin: The Jack of All Trades', 'The Respiratory System', 'Hygiene: A Key to Healthy Life', 'Diseases: Cause and Control', 'Aids to Health', 'Health Organisations',
        'Waste Generation and Management'],
      Mathematics: ['Rational and Irrational Numbers', 'Compound Interest', 'Expansions', 'Factorisation', 'Simultaneous Linear Equations', 'Indices', 'Logarithms',
        'Triangles and Congruency', 'Isosceles Triangles', 'Inequalities', 'Mid-point and its Converse', "Pythagoras' Theorem", 'Rectilinear Figures', 'Construction of Polygons',
        'Area and Perimeter of Plane Figures', 'Circle', 'Statistics', 'Mensuration of Solids', 'Trigonometric Ratios', 'Trigonometric Ratios of Standard Angles',
        'Solution of Right Triangles', 'Co-ordinate Geometry and Graphical Solution'],
      'History & Civics': ['Civics · Our Constitution', 'Civics · Salient Features of the Constitution I', 'Civics · Salient Features of the Constitution II',
        'Civics · Elections', 'Civics · Local Self-Government: Rural', 'Civics · Local Self-Government: Urban', 'History · The Harappan Civilisation',
        'History · The Vedic Period', 'History · Jainism and Buddhism', 'History · The Mauryan Empire', 'History · The Sangam Age',
        'History · The Age of the Guptas', 'History · Medieval India: The Cholas', 'History · Medieval India: The Delhi Sultanate',
        'History · Medieval India: The Mughal Empire', 'History · Medieval India: Composite Culture', 'History · The Modern Age in Europe: Renaissance',
        'History · The Modern Age in Europe: Reformation', 'History · The Modern Age in Europe: Industrial Revolution'],
      Geography: ['Our World', 'Geographic Grid: Latitudes and Longitudes', 'Rotation and Revolution', 'Earth\'s Structure', 'Landforms of the Earth', 'Rocks',
        'Volcanoes', 'Earthquakes', 'Weathering', 'Denudation', 'Hydrosphere', 'Composition and Structure of the Atmosphere', 'Insolation',
        'Atmospheric Pressure and Winds', 'Humidity and Precipitation', 'Pollution', 'Natural Regions of the World'],
      Computer: ['Introduction to Object-Oriented Programming Concepts', 'Elementary Concept of Objects and Classes', 'Values and Data Types', 'Operators in Java',
        'Input in Java', 'Mathematical Library Methods', 'Conditional Constructs in Java', 'Iterative Constructs in Java', 'Nested Loops',
        'Computing and Ethics']
    },
    '10': {
      Physics: ['Force', 'Work, Energy and Power', 'Machines', 'Refraction of Light at Plane Surfaces', 'Refraction through a Lens', 'Spectrum', 'Sound', 'Current Electricity',
        'Household Circuits', 'Electro-magnetism', 'Calorimetry', 'Radioactivity'],
      Chemistry: ['Periodic Table, Periodic Properties and Variations', 'Chemical Bonding', 'Acids, Bases and Salts', 'Analytical Chemistry', 'Mole Concept and Stoichiometry',
        'Electrolysis', 'Metallurgy', 'Study of Compounds — Hydrogen Chloride', 'Study of Compounds — Ammonia', 'Study of Compounds — Nitric Acid',
        'Study of Compounds — Sulphuric Acid', 'Organic Chemistry'],
      Biology: ['Cell Cycle, Cell Division and Structure of Chromosomes', 'Genetics', 'Absorption by Roots', 'Transpiration', 'Photosynthesis', 'Chemical Coordination in Plants',
        'The Circulatory System', 'The Excretory System', 'The Nervous System', 'Sense Organs', 'The Endocrine System', 'The Reproductive System', 'Population', 'Pollution'],
      Mathematics: ['Goods and Services Tax (GST)', 'Banking (Recurring Deposit Accounts)', 'Linear Inequations', 'Quadratic Equations', 'Problems on Quadratic Equations',
        'Ratio and Proportion', 'Remainder and Factor Theorems', 'Matrices', 'Arithmetic Progression', 'Geometric Progression', 'Reflection', 'Section and Mid-point Formula',
        'Equation of a Line', 'Similarity', 'Loci', 'Circles', 'Tangents and Intersecting Chords', 'Constructions', 'Cylinder, Cone and Sphere', 'Trigonometrical Identities',
        'Heights and Distances', 'Graphical Representation', 'Measures of Central Tendency', 'Probability'],
      'History & Civics': ['Civics · The Union Parliament', 'Civics · The Union Executive: President and Vice-President',
        'Civics · The Union Executive: Prime Minister and Council of Ministers', 'Civics · The Judiciary: Supreme Court',
        'Civics · The Judiciary: High Courts and Subordinate Courts', 'History · The First War of Independence, 1857', 'History · Growth of Nationalism',
        'History · The Early Nationalists', 'History · The Assertive Nationalists', 'History · Mahatma Gandhi and the National Movement',
        'History · The Muslim League', 'History · Forward Bloc and the INA', 'History · Independence and Partition of India',
        'History · The First World War', 'History · Rise of Dictatorships', 'History · The Second World War', 'History · The United Nations',
        'History · Major Agencies of the United Nations', 'History · The Non-Aligned Movement'],
      Geography: ['Interpretation of Topographical Maps', 'Map of India', 'Location, Extent and Physical Features of India', 'Climate', 'Soil Resources',
        'Natural Vegetation', 'Water Resources', 'Mineral Resources', 'Conventional Sources of Energy', 'Non-Conventional Sources of Energy', 'Agriculture',
        'Agro-based Industries', 'Mineral-based Industries', 'Transport', 'Waste Management'],
      Computer: ['Revision of Class IX', 'Class as the Basis of all Computation', 'User-defined Methods', 'Constructors', 'Library Classes and Wrapper Classes',
        'Encapsulation', 'Arrays', 'String Handling']
    },
    '11': {
      Physics: ['Units and Measurements', 'Motion in a Straight Line', 'Motion in a Plane', 'Laws of Motion', 'Work, Energy and Power', 'System of Particles and Rotational Motion',
        'Gravitation', 'Mechanical Properties of Solids', 'Mechanical Properties of Fluids', 'Thermal Properties of Matter', 'Thermodynamics', 'Kinetic Theory of Gases',
        'Oscillations', 'Waves'],
      Chemistry: ['Some Basic Concepts of Chemistry', 'Structure of Atom', 'Classification of Elements and Periodicity in Properties', 'Chemical Bonding and Molecular Structure',
        'Chemical Thermodynamics', 'Equilibrium', 'Redox Reactions', 'Organic Chemistry — Basic Principles and Techniques', 'Hydrocarbons'],
      Biology: ['The Living World', 'Biological Classification', 'Plant Kingdom', 'Animal Kingdom', 'Morphology of Flowering Plants', 'Anatomy of Flowering Plants',
        'Structural Organisation in Animals', 'Cell: The Unit of Life', 'Biomolecules', 'Cell Cycle and Cell Division', 'Photosynthesis in Higher Plants', 'Respiration in Plants',
        'Plant Growth and Development', 'Breathing and Exchange of Gases', 'Body Fluids and Circulation', 'Excretory Products and their Elimination', 'Locomotion and Movement',
        'Neural Control and Coordination', 'Chemical Coordination and Integration'],
      Mathematics: ['Sets', 'Relations and Functions', 'Trigonometric Functions', 'Complex Numbers and Quadratic Equations', 'Linear Inequalities', 'Permutations and Combinations',
        'Binomial Theorem', 'Sequences and Series', 'Straight Lines', 'Circles', 'Conic Sections', 'Introduction to Three-dimensional Geometry', 'Limits and Derivatives',
        'Statistics', 'Probability', 'Correlation Analysis'],
      Computer: ['Numbers and Number Systems', 'Encodings', 'Propositional Logic', 'Computer Hardware and Logic Gates', 'Objects and Classes',
        'Primitive Values, Wrapper Classes, Types and Casting', 'Variables and Expressions', 'Statements and Scope', 'Methods', 'Arrays and Strings',
        'Basic Input/Output', 'Recursion', 'Implementation of Algorithms', 'Packages', 'Trends in Computing and Ethical Issues']
    },
    '12': {
      Physics: ['Electric Charges and Fields', 'Electrostatic Potential and Capacitance', 'Current Electricity', 'Moving Charges and Magnetism', 'Magnetism and Matter',
        'Electromagnetic Induction', 'Alternating Current', 'Electromagnetic Waves', 'Ray Optics and Optical Instruments', 'Wave Optics', 'Dual Nature of Radiation and Matter',
        'Atoms', 'Nuclei', 'Semiconductor Electronics'],
      Chemistry: ['Solutions', 'Electrochemistry', 'Chemical Kinetics', 'The d- and f-Block Elements', 'Coordination Compounds', 'Haloalkanes and Haloarenes',
        'Alcohols, Phenols and Ethers', 'Aldehydes, Ketones and Carboxylic Acids', 'Amines', 'Biomolecules'],
      Biology: ['Sexual Reproduction in Flowering Plants', 'Human Reproduction', 'Reproductive Health', 'Principles of Inheritance and Variation', 'Molecular Basis of Inheritance',
        'Evolution', 'Human Health and Disease', 'Microbes in Human Welfare', 'Biotechnology: Principles and Processes', 'Biotechnology and its Applications',
        'Organisms and Populations', 'Ecosystem', 'Biodiversity and Conservation'],
      Mathematics: ['Relations and Functions', 'Inverse Trigonometric Functions', 'Matrices', 'Determinants', 'Continuity and Differentiability', 'Applications of Derivatives',
        'Integrals', 'Differential Equations', 'Probability', 'Vectors', 'Three-dimensional Geometry', 'Applications of Integrals',
        'Application of Calculus in Commerce and Economics', 'Linear Regression', 'Linear Programming'],
      Computer: ['Boolean Algebra', 'Logic Gates and Circuits: Adders, Encoders, Decoders, Multiplexers', 'Objects and Classes', 'Arrays', 'Strings', 'Recursion',
        'Inheritance, Interfaces and Polymorphism', 'Data Structures: Stack and Queue', 'Linked Lists and Binary Trees', 'Complexity and Big O Notation']
    }
  };
  const CLASSES = ['7', '8', '9', '10', '11', '12'];
  // Board codes used in orders: 'CBSE' or 'CISCE' (shown as ICSE for 7–10, ISC for 11–12).
  const boardLabel = (board, cls) => board === 'CISCE' ? (Number(cls) >= 11 ? 'ISC' : 'ICSE') : 'CBSE';
  const boardFor = profileBoard => /^(ICSE|ISC|CISCE)$/i.test(String(profileBoard || '')) ? 'CISCE' : 'CBSE';
  function subjects(board, cls) {
    const book = (board === 'CISCE' ? CISCE : CBSE)[String(cls)];
    return book ? Object.keys(book).map(subject => ({ subject, chapters: book[subject].slice() })) : [];
  }
  function chapters(board, cls, subject) {
    const book = (board === 'CISCE' ? CISCE : CBSE)[String(cls)];
    return book && book[subject] ? book[subject].slice() : [];
  }
  const api = { CLASSES, subjects, chapters, boardLabel, boardFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NTCSyllabus = api;
})(typeof window === 'undefined' ? null : window);
