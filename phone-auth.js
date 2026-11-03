var phoneSdk = null, phoneAuth = null, phoneVerifier = null, phoneConfirmation = null, phoneRetryAt = 0;
async function preparePhoneAuth() {
  if (!phoneSdk) {
    var modules = await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')
    ]);
    var app = modules[0].initializeApp(loginConfig.firebase, 'temple-phone');
    phoneSdk = modules[1]; phoneAuth = phoneSdk.getAuth(app);
    await phoneSdk.setPersistence(phoneAuth, phoneSdk.inMemoryPersistence);
    phoneAuth.languageCode = 'en';
  }
  if (!phoneVerifier) phoneVerifier = new phoneSdk.RecaptchaVerifier(phoneAuth, 'phone-recaptcha', {size:'normal'});
  return phoneVerifier;
}
function resetPhoneChallenge() {
  if (phoneVerifier) { phoneVerifier.clear(); phoneVerifier = null; }
}
function phoneError(error) {
  var messages = {
    'auth/invalid-phone-number':'Enter a valid US mobile number with area code.',
    'auth/invalid-verification-code':'That code is incorrect. Please try again.',
    'auth/code-expired':'That code has expired or was already used. Request a new code and use only the latest text message. If this keeps happening, ask an administrator to confirm your phone number is saved on your active volunteer profile.',
    'auth/too-many-requests':'Too many attempts. Please wait before trying again.',
    'auth/quota-exceeded':'SMS sign-in is temporarily unavailable. Please use Google or email.',
    'auth/captcha-check-failed':'Please complete the verification challenge again.',
    'auth/operation-not-allowed':'Phone sign-in is not enabled yet. Please use Google or email.',
    'auth/unauthorized-domain':'Phone sign-in setup is incomplete. Please use Google or email.'
  };
  return messages[error.code] || error.message || 'Phone sign-in failed. Please try again.';
}
function initPhoneSignIn() {
  document.getElementById('phone-start').addEventListener('submit', async function (event) {
    event.preventDefault(); var button = event.target.querySelector('button'), status = document.getElementById('auth-status');
    if (button.disabled) return;
    var digits = document.getElementById('auth-phone').value.replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) { status.textContent = 'Enter a valid US mobile number with area code.'; return; }
    if (Date.now() < phoneRetryAt) { status.textContent = 'Please wait a minute before requesting another code.'; return; }
    button.disabled = true; status.textContent = 'Complete the verification challenge to receive your code.';
    try {
      var verifier = await preparePhoneAuth();
      phoneConfirmation = await phoneSdk.signInWithPhoneNumber(phoneAuth, '+1' + digits, verifier);
      phoneRetryAt = Date.now() + 60000;
      document.getElementById('phone-start').hidden = true;
      document.getElementById('phone-verify').hidden = false;
      document.getElementById('phone-code').value = '';
      document.getElementById('phone-code').focus();
      status.textContent = 'Code sent by text message. Enter the six-digit code.';
    } catch (error) { status.textContent = phoneError(error); }
    finally { button.disabled = false; resetPhoneChallenge(); }
  });
  document.getElementById('phone-verify').addEventListener('submit', async function (event) {
    event.preventDefault(); var button = event.target.querySelector('button'), status = document.getElementById('auth-status');
    if (button.disabled) return;
    if (!phoneConfirmation) { status.textContent = 'Please request a new code.'; return; }
    button.disabled = true; status.textContent = 'Verifying your code…';
    try {
      var result = await phoneConfirmation.confirm(document.getElementById('phone-code').value.trim());
      var token = await result.user.getIdToken();
      // A confirmed Firebase code cannot be reused if the profile lookup fails.
      phoneConfirmation = null;
      var session = await api('auth/phone', {idToken:token});
      phoneConfirmation = null;
      document.getElementById('phone-code').value = '';
      await signedIn(session.user);
    } catch (error) {
      status.textContent = phoneError(error);
      if (!phoneConfirmation || error.code === 'auth/code-expired') {
        phoneConfirmation = null;
        document.getElementById('phone-verify').hidden = true;
        document.getElementById('phone-start').hidden = false;
        document.getElementById('phone-code').value = '';
      }
    }
    finally { if (phoneAuth) await phoneSdk.signOut(phoneAuth); button.disabled = false; }
  });
  document.getElementById('change-phone').addEventListener('click', function () {
    phoneConfirmation = null; resetPhoneChallenge();
    document.getElementById('phone-verify').hidden = true;
    document.getElementById('phone-start').hidden = false;
    document.getElementById('phone-code').value = '';
    document.getElementById('auth-status').textContent = '';
  });
}
