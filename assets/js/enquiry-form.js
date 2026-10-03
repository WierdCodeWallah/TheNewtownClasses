import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG, initAppCheck } from './firebase-config.js?v=4b98d617';

// A separate session keeps an inquiry from replacing a student or staff login.
const app = initializeApp(FIREBASE_CONFIG, 'public-enquiry');
await initAppCheck(app);
const auth = getAuth(app), db = getFirestore(app);
const $ = id => document.getElementById(id);
const form = $('enquiryForm'), fields = $('enquiryFields'), submit = $('enquirySubmit');
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
let verifiedUser = null, saving = false, authenticating = false, completed = false;
let pendingDoc = null;

function message(text, error = false) {
  $('cmsEnquiryMsg').textContent = text;
  $('cmsEnquiryMsg').classList.toggle('is-error', error);
}
function render() {
  const ready = !!verifiedUser;
  $('enquiryAuth').hidden = ready || completed;
  $('enquiryAccount').hidden = !ready || completed;
  fields.hidden = !ready || completed;
  fields.disabled = !ready || saving || completed;
  $('enquiryGoogle').disabled = saving || authenticating;
  $('enquirySwitch').disabled = saving || authenticating;
  $('enquiryEmail').textContent = verifiedUser?.email || '';
  $('enquirySuccess').hidden = !completed;
  submit.textContent = saving ? 'Sending your inquiry…' : 'Send my inquiry →';
  window.EnquiryUI.setState({ready, busy:saving || authenticating, complete:completed});
}
onAuthStateChanged(auth, async user => {
  verifiedUser = null;
  render();
  if (!user) return;
  try {
    const token = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid) return;
    if (token.claims.firebase?.sign_in_provider === 'google.com' && token.claims.email_verified && user.email) {
      verifiedUser = user;
      if (!$('enquiryName').value) $('enquiryName').value = user.displayName || '';
      message('');
    } else message('Please continue with Google to verify your email.', true);
  } catch (_) { message('Could not verify your sign-in. Please try again.', true); }
  render();
});
$('enquiryGoogle').disabled = false;
$('enquiryGoogle').addEventListener('click', async () => {
  authenticating = true; render(); message('Opening Google sign-in…');
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const errors = {
      'auth/popup-closed-by-user': 'Sign-in was cancelled. Continue with Google when you’re ready.',
      'auth/cancelled-popup-request': 'Sign-in was cancelled. Please try again.',
      'auth/popup-blocked': 'Please allow pop-ups for this site, then continue with Google again.',
      'auth/network-request-failed': 'Check your internet connection and try again.',
      'auth/unauthorized-domain': 'Google sign-in is not available on this website address yet. Please call or WhatsApp us.',
      'auth/operation-not-allowed': 'Google sign-in is not available yet. Please call or WhatsApp us.',
      'auth/account-exists-with-different-credential': 'This email uses another sign-in method. Please choose another Google account.'
    };
    message(errors[error.code] || 'Google sign-in failed. Please try again or contact us by phone.', true);
  } finally { authenticating = false; render(); }
});
$('enquirySwitch').addEventListener('click', async () => {
  try { await signOut(auth); pendingDoc = null; message(''); }
  catch (_) { message('Could not switch accounts. Please try again.', true); }
});
$('enquiryAgain').addEventListener('click', () => {
  completed = false; pendingDoc = null; message(''); render();
  window.EnquiryUI.go(0);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || completed) return;
  if (!verifiedUser || auth.currentUser?.uid !== verifiedUser.uid) {
    message('Please sign in with Google before sending your inquiry.', true); return;
  }
  const ui = window.EnquiryUI;
  if (ui.step < 2) { if (ui.validate(ui.step)) ui.go(ui.step + 1); return; }
  for (let step = 0; step < 3; step++) if (!ui.validate(step)) return;
  const data = new FormData(form);
  const name = String(data.get('student-name') || '').trim();
  let phone = String(data.get('mobile') || '').replace(/\D/g, '');
  if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
  if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
  if (name.length < 2) { message('Please enter the student’s full name.', true); $('enquiryName').focus(); return; }
  if (!/^[6-9]\d{9}$/.test(phone)) { message('Please enter a valid 10-digit Indian mobile number.', true); $('enquiryPhone').focus(); return; }
  if (!navigator.onLine) { message('You’re offline. Reconnect to send your inquiry. Your details are still here.', true); return; }
  // Reuse the document ID after an uncertain network failure, preventing duplicate records.
  pendingDoc ||= doc(collection(db, 'enquiries'));
  const user = verifiedUser;
  saving = true; render(); message('');
  try {
    await setDoc(pendingDoc, {
      uid: user.uid, googleName: (user.displayName || '').slice(0, 200),
      name, phone, email: user.email, course: data.get('course'),
      currentClass: data.get('current-class'), message: String(data.get('message') || '').trim(),
      status: 'New', source: 'Website', createdAt: serverTimestamp()
    });
    completed = true; form.reset();
    $('enquiryReference').textContent = pendingDoc.id;
    render(); $('enquirySuccess').focus();
  } catch (_) {
    message('We could not confirm your submission. Your details are saved on this page; please retry or call +91 9903461361.', true);
  } finally { saving = false; render(); }
});
render();
