var currentUser = null, volunteerDirectory = [], loginConfig = null;
var ROLE_OPTIONS = ['super-admin', 'admin', 'headpujari', 'coordinator', 'volunteer', 'backup', 'other'];
var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function managesVolunteers() { return !!currentUser && (currentUser.isSuperAdmin || currentUser.roles.indexOf('admin') >= 0); }
function requireSignIn() {
  if (currentUser) return true;
  openSignIn(); return false;
}
async function openSignIn() {
  var dialog = document.getElementById('auth-dialog');
  if (!dialog.open) dialog.showModal();
  document.getElementById('signin-lookup').hidden = false;
  document.getElementById('signin-methods').hidden = true;
  document.getElementById('signin-help').hidden = true;
  var status = document.getElementById('auth-status'); status.textContent = 'Loading sign-in options…';
  try {
    loginConfig = await api('auth/config');
    document.getElementById('phone-sign-in').hidden = !loginConfig.firebase;
    document.getElementById('phone-start').hidden = false;
    document.getElementById('phone-verify').hidden = true;
    phoneConfirmation = null; resetPhoneChallenge();
    document.getElementById('email-start').hidden = !loginConfig.emailEnabled;
    document.getElementById('email-verify').hidden = true;
    var googleBox = document.getElementById('google-sign-in');
    googleBox.textContent = ''; googleBox.hidden = !loginConfig.googleClientId;
    if (loginConfig.googleClientId) {
      try {
        if (!window.google || !window.google.accounts) {
          await new Promise(function (resolve, reject) {
            var script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
            script.onload = resolve; script.onerror = function () { reject(new Error('Google sign-in could not load. Please retry or use your registered phone.')); };
            document.head.appendChild(script);
          });
        }
        google.accounts.id.initialize({ client_id: loginConfig.googleClientId, nonce: loginConfig.nonce, callback: async function (response) {
          status.textContent = 'Signing in�';
          try { var result = await api('auth/google', { credential: response.credential }); await signedIn(result.user); }
          catch (error) { status.textContent = error.message; }
        } });
        google.accounts.id.renderButton(googleBox, { theme: 'outline', size: 'large', text: 'continue_with' });
      } catch (error) { googleBox.hidden = true; status.textContent = error.message; return; }
    }
    document.getElementById('email-start').hidden = true;
    status.textContent = loginConfig.firebase || loginConfig.googleClientId ? '' : 'Sign-in is unavailable. Please contact your coordinator.';
  } catch (error) { status.textContent = error.message; }
}
function updateAccount() {
  updateHistoryAccess();
  document.getElementById('account-label').textContent = currentUser ? 'Signed in as ' + currentUser.name : '';
  document.getElementById('sign-in').hidden = !!currentUser;
  document.getElementById('sign-out').hidden = !currentUser;
  document.getElementById('add-volunteer').hidden = !managesVolunteers();
  if (!managesVolunteers()) closeNewVolunteer();
  renderRecurring();
  renderVolunteers();
  renderPermanentBackups(); render();
}
function closeNewVolunteer() {
  var box = document.getElementById('new-volunteer'); box.textContent = ''; box.hidden = true;
  document.getElementById('add-volunteer').setAttribute('aria-expanded', 'false');
}
async function signedIn(user) {
  currentUser = user; updateAccount();
  document.getElementById('auth-dialog').close();
  document.getElementById('auth-code').value = '';
  await refreshVolunteers(); render(); await syncShared(true);
}
function applyVolunteerSchedule() {
  WEEKLY_PLAN = WEEKDAYS.map(function (day, weekday) {
    var plan = { day: day, am: [], pm: [] };
    volunteerDirectory.filter(function (v) { return v.active; }).forEach(function (v) {
      v.assignments.filter(function (a) { return a.weekday === weekday; }).forEach(function (a) { plan[a.shift].push(v.name); });
    });
    return plan;
  });
  renderPermanentBackups();
}
function renderPermanentBackups() {
  var backups = volunteerDirectory.filter(function (v) { return v.active && v.roles.indexOf('backup') >= 0; });
  var box = document.getElementById('backup-list'); box.textContent = '';
  if (!backups.length) box.appendChild(el('p', 'note', 'No permanent backups listed yet.'));
  backups.forEach(function (v) { var item = el('div', 'backup'); item.appendChild(volunteerIdentity(v.name, v.id)); box.appendChild(item); });
}
async function refreshVolunteers() {
  var data = await api('volunteers'); volunteerDirectory = data.volunteers;
  applyVolunteerSchedule(); renderVolunteers();
  sharedListeners.forEach(function (listener) { listener(); });
  if (!recurringDraft) renderRecurring();
}
function appendVolunteerContacts(parent, volunteer, dateIso) {
  if (!currentUser || !volunteer || (dateIso && dateIso < iso(templeToday()))) return;
  var contacts = el('div', 'volunteer-contacts');
  function contactLink(label, href, action, icon) {
    var link = el('a', 'volunteer-contact', label); link.href = href;
    link.setAttribute('aria-label', action + ' ' + volunteer.name);
    link.setAttribute('title', action + ' ' + volunteer.name);
    if (icon) {
      link.className += ' contact-icon';
      link.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + icon + '</svg>';
    }
    contacts.appendChild(link);
  }
  if (volunteer.phone) {
    contactLink(null, 'tel:' + volunteer.phone, 'Call', '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.79a2 2 0 0 1-.45 2.11L8.09 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.83.56 2.79.69A2 2 0 0 1 22 16.92z"/>');
    contactLink(null, 'sms:' + volunteer.phone, 'Send SMS to', '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M8 10h8M8 14h5"/>');
  }
  if (volunteer.email) contactLink(volunteer.email, 'mailto:' + volunteer.email, 'Email');
  if (contacts.children.length) parent.appendChild(contacts);
}
function volunteerIdentity(name, id, dateIso) {
  var node = el('span', 'volunteer-identity');
  node.appendChild(el('span', null, name));
  var matches = volunteerDirectory.filter(function (v) { return v.active && (id ? v.id === id : v.name === name); });
  if (matches.length === 1) appendVolunteerContacts(node, matches[0], dateIso);
  return node;
}
function renderVolunteers() {
  var list = document.getElementById('volunteer-list'); list.textContent = '';
  document.getElementById('volunteers-status').textContent = '';
  var search = document.getElementById('volunteer-search').value.trim().toLowerCase();
  var role = document.getElementById('volunteer-role').value;
  var day = document.getElementById('volunteer-day').value;
  var sort = document.getElementById('volunteer-sort').value;
  var visible = volunteerDirectory.filter(function (v) {
    return (!search || (v.name + ' ' + v.availabilityNotes).toLowerCase().indexOf(search) >= 0)
      && (!role || v.roles.indexOf(role) >= 0)
      && (day === '' || v.assignments.some(function (a) { return a.weekday === Number(day); }));
  }).sort(function (a, b) {
    if (sort === 'shifts' && a.assignments.length !== b.assignments.length) return b.assignments.length - a.assignments.length;
    return (sort === 'name-desc' ? -1 : 1) * a.name.localeCompare(b.name);
  });
  document.getElementById('volunteer-count').textContent = visible.length + ' of ' + volunteerDirectory.length + ' volunteers';
  if (!visible.length) list.appendChild(el('p', 'note', 'No volunteers match these filters. Try another name, role, or day.'));
  visible.forEach(function (volunteer) {
    var card = el('article', 'volunteer-card' + (volunteer.active ? '' : ' inactive-volunteer'));
    var identity = el('div', 'volunteer-section'); card.appendChild(identity);
    identity.appendChild(el('h3', null, volunteer.name));
    var roles = el('div', 'volunteer-roles');
    volunteer.roles.forEach(function (role) { roles.appendChild(el('span', 'chip note-kind', role)); });
    if (!volunteer.active) roles.appendChild(el('span', 'chip away', 'Inactive'));
    identity.appendChild(roles);
    var service = el('div', 'volunteer-section'); card.appendChild(service);
    if (volunteer.assignments.length) service.appendChild(el('div', 'label', 'Recurring service'));
    var assignments = el('ul', 'assignment-list');
    volunteer.assignments.forEach(function (assignment) { assignments.appendChild(el('li', null, WEEKDAYS[assignment.weekday] + ' · ' + (assignment.shift === 'am' ? 'Morning' : 'Evening'))); });
    if (volunteer.assignments.length) service.appendChild(assignments);
    var availability = el('div', 'volunteer-section'); card.appendChild(availability);
    if (volunteer.availabilityNotes) {
      availability.appendChild(el('div', 'label', 'Availability'));
      availability.appendChild(el('p', 'note', volunteer.availabilityNotes));
    }
    if (currentUser) {
      if (volunteer.phone) identity.appendChild(el('p', 'note volunteer-phone', volunteer.phone));
      appendVolunteerContacts(identity, volunteer);
    }
    var canEdit = managesVolunteers() && (!volunteer.isSuperAdmin || currentUser.isSuperAdmin);
    if (volunteer.isSuperAdmin) card.appendChild(el('p', 'volunteer-protected', 'Protected super-admin · role cannot be removed.'));
    if (canEdit) {
      var button = el('button', 'btn-small', 'Edit volunteer'); button.type = 'button'; button.setAttribute('aria-expanded', 'false'); identity.appendChild(button);
      var editor = el('div', 'volunteer-editor'); editor.hidden = true; card.appendChild(editor);
      button.addEventListener('click', function () {
        editor.hidden = !editor.hidden; button.setAttribute('aria-expanded', String(!editor.hidden));
        if (!editor.hidden) { editor.textContent = ''; editor.appendChild(volunteerForm(volunteer, function () { editor.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); })); editor.querySelector('input').focus(); }
      });
    }
    list.appendChild(card);
  });
}
function volunteerForm(volunteer, close) {
  var original = volunteer || { name: '', email: '', availabilityNotes: '', roles: ['volunteer'], assignments: [], active: true };
  var form = el('form', 'form');
  form.appendChild(el('h3', null, volunteer ? 'Edit ' + original.name : 'Add a volunteer'));
  form.appendChild(el('p', 'note', 'Enter the display name, including Mtj or Pr where appropriate. Add an email or US mobile number for sign-in. Administrators need at least one enabled sign-in method.'));
  function inputField(title, type, value, max) {
    var label = el('label', 'field', title); var input = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type; else input.rows = 3;
    input.value = value; input.maxLength = max; label.appendChild(input); form.appendChild(label); return input;
  }
  var name = inputField('Name', 'text', original.name, 60); name.required = true;
  var email = inputField('Sign-in email (visible to signed-in volunteers)', 'email', original.email || '', 254);
  var phone = inputField('US mobile number (visible to signed-in volunteers)', 'tel', original.phone || '', 30);
  var availability = inputField('Availability notes (visible to everyone)', 'textarea', original.availabilityNotes, 1000);
  var roles = el('fieldset'); roles.appendChild(el('legend', null, 'Roles')); var roleBox = el('div', 'role-choices'); roles.appendChild(roleBox); form.appendChild(roles);
  var roleInputs = {};
  ROLE_OPTIONS.forEach(function (role) {
    if (role === 'super-admin' && !original.isSuperAdmin) return;
    var label = el('label', 'check-label'); var check = el('input'); check.type = 'checkbox'; check.checked = original.roles.indexOf(role) >= 0;
    check.disabled = role === 'super-admin' || (role === 'admin' && original.id === currentUser.id && !currentUser.isSuperAdmin);
    roleInputs[role] = check; label.appendChild(check); label.appendChild(document.createTextNode(role)); roleBox.appendChild(label);
  });
  var schedule = el('fieldset'); schedule.appendChild(el('legend', null, 'Recurring assignments')); form.appendChild(schedule);
  var assignmentInputs = [];
  WEEKDAYS.forEach(function (day, weekday) {
    var row = el('div', 'assignment-row'); row.appendChild(el('span', null, day));
    ['am', 'pm'].forEach(function (shift) {
      var label = el('label', 'check-label'); var check = el('input'); check.type = 'checkbox'; check.checked = original.assignments.some(function (a) { return a.weekday === weekday && a.shift === shift; });
      check.setAttribute('aria-label', day + ' ' + (shift === 'am' ? 'morning' : 'evening'));
      assignmentInputs.push({ weekday: weekday, shift: shift, input: check }); label.appendChild(check); label.appendChild(document.createTextNode(shift === 'am' ? 'Morning' : 'Evening')); row.appendChild(label);
    }); schedule.appendChild(row);
  });
  var activeLabel = el('label', 'check-label'); var active = el('input'); active.type = 'checkbox'; active.checked = original.active;
  active.disabled = !!original.isSuperAdmin || original.id === currentUser.id; activeLabel.appendChild(active); activeLabel.appendChild(document.createTextNode('Active volunteer')); form.appendChild(activeLabel);
  if (original.id === currentUser.id) form.appendChild(el('p', 'note', currentUser.isSuperAdmin ? 'Your super-admin role is protected.' : 'You cannot drop your own admin privilege or deactivate your account.'));
  var row = el('div', 'editor-actions'); var save = el('button', 'btn-primary', 'Save volunteer'); save.type = 'submit'; save.style.paddingInline = '16px'; row.appendChild(save);
  var cancel = el('button', 'btn-outline', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', close); row.appendChild(cancel);
  var remove;
  if (original.id && !original.isSuperAdmin && original.id !== currentUser.id && original.active) {
    remove = el('button', 'btn-outline', 'Remove volunteer'); remove.type = 'button'; row.appendChild(remove);
  }
  form.appendChild(row); var status = el('div', 'note'); status.setAttribute('role', 'status'); form.appendChild(status);
  async function persist(path, data) {
    save.disabled = true; cancel.disabled = true; if (remove) remove.disabled = true; status.textContent = 'Saving…';
    try {
      await api(path, data);
      currentUser = (await api('auth/me')).user; updateAccount();
      if (!original.id) ['volunteer-search', 'volunteer-role', 'volunteer-day'].forEach(function (id) { document.getElementById(id).value = ''; });
      await refreshVolunteers(); closeNewVolunteer(); render(); await syncShared(true);
      document.getElementById('volunteers-status').textContent = data.name ? data.name + (original.id ? ' updated.' : ' added to the volunteer list.') : 'Volunteer record saved.';
      document.getElementById('add-volunteer').focus();
    } catch (error) { status.textContent = error.message; save.disabled = false; cancel.disabled = false; if (remove) remove.disabled = false; }
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault(); if (save.disabled) return;
    var data = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim(), availabilityNotes: availability.value.trim(), active: active.checked, roles: Object.keys(roleInputs).filter(function (role) { return roleInputs[role].checked; }), assignments: assignmentInputs.filter(function (a) { return a.input.checked; }).map(function (a) { return { weekday: a.weekday, shift: a.shift }; }) };
    if (original.id) { data.id = original.id; data.version = original.version; }
    return persist('volunteers/save', data);
  });
  if (remove) remove.addEventListener('click', function () { persist('volunteers/remove', { id: original.id, version: original.version }); });
  return form;
}
async function initPeople() {
  initRecurring();
  initPhoneSignIn();
  document.getElementById('signin-change').addEventListener('click', function () {
    document.getElementById('signin-methods').hidden = true;
    document.getElementById('signin-lookup').hidden = false;
    document.getElementById('signin-help').hidden = true;
    document.getElementById('auth-status').textContent = '';
    phoneConfirmation = null; resetPhoneChallenge();
  });
  document.getElementById('signin-lookup').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = event.target.querySelector('button'); if (button.disabled) return;
    var identifier = document.getElementById('signin-identifier').value.trim();
    if (!/^(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}$/.test(identifier)) { document.getElementById('auth-status').textContent = 'Enter a valid US mobile number with area code.'; return; }
    var status = document.getElementById('auth-status');
    button.disabled = true; status.textContent = 'Checking your sign-in details…';
    document.getElementById('signin-help').hidden = true;
    document.getElementById('signin-methods').hidden = true;
    try {
      var match = await api('auth/lookup', {identifier:identifier});
      if (!match.found) {
        status.textContent = (match.kind === 'phone' ? 'Phone number' : 'Email') + ' not found in an active volunteer profile. Ask an administrator to add or correct it before trying again.';
        document.getElementById('signin-help').hidden = false;
        return;
      }
      if (!loginConfig) loginConfig = await api('auth/config');
      document.getElementById('signin-lookup').hidden = true;
      document.getElementById('signin-methods').hidden = false;
      document.getElementById('email-start').hidden = true;
      document.getElementById('email-verify').hidden = true;
      document.getElementById('phone-sign-in').hidden = match.kind !== 'phone' || !loginConfig.firebase;
      document.getElementById('phone-start').hidden = false;
      document.getElementById('phone-verify').hidden = true;
      document.getElementById('auth-email').value = identifier;
      document.getElementById('auth-phone').value = identifier;
      status.textContent = match.kind === 'phone' ? (loginConfig.firebase ? 'Phone found. Send a text code to continue.' : 'Phone sign-in is unavailable. Please contact your coordinator.') : (loginConfig.googleClientId || loginConfig.emailEnabled ? 'Email found. Choose a sign-in method below.' : 'Email sign-in is unavailable. Try your registered phone or contact your coordinator.');
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  ['volunteer-search', 'volunteer-role', 'volunteer-day', 'volunteer-sort'].forEach(function (id) {
    document.getElementById(id).addEventListener(id === 'volunteer-search' ? 'input' : 'change', renderVolunteers);
  });
  document.getElementById('sign-in').addEventListener('click', openSignIn);
  document.getElementById('auth-close').addEventListener('click', function () { document.getElementById('auth-dialog').close(); });
  document.getElementById('sign-out').addEventListener('click', async function () {
    try { await api('auth/logout', {}); currentUser = null; updateAccount(); await refreshVolunteers(); render(); }
    catch (error) { document.getElementById('account-label').textContent = error.message; }
  });
  document.getElementById('add-volunteer').addEventListener('click', function () {
    if (!managesVolunteers()) return;
    var box = document.getElementById('new-volunteer');
    if (!box.hidden) { closeNewVolunteer(); return; }
    box.textContent = ''; box.hidden = false;
    document.getElementById('add-volunteer').setAttribute('aria-expanded', 'true');
    box.appendChild(volunteerForm(null, function () { closeNewVolunteer(); document.getElementById('add-volunteer').focus(); }));
    box.querySelector('input').focus();
  });
  document.getElementById('change-email').addEventListener('click', function () { document.getElementById('email-verify').hidden = true; document.getElementById('email-start').hidden = false; });
  document.getElementById('email-start').addEventListener('submit', async function (event) {
    event.preventDefault(); var button = event.target.querySelector('button'); if (button.disabled) return; button.disabled = true;
    try { var result = await api('auth/email/start', { email: document.getElementById('auth-email').value.trim() }); document.getElementById('auth-status').textContent = result.message; document.getElementById('email-start').hidden = true; document.getElementById('email-verify').hidden = false; document.getElementById('auth-code').focus(); }
    catch (error) { document.getElementById('auth-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.getElementById('email-verify').addEventListener('submit', async function (event) {
    event.preventDefault(); var button = event.target.querySelector('button'); if (button.disabled) return; button.disabled = true;
    try { var result = await api('auth/email/verify', { email: document.getElementById('auth-email').value.trim(), code: document.getElementById('auth-code').value.trim() }); await signedIn(result.user); }
    catch (error) { document.getElementById('auth-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
  try { currentUser = (await api('auth/me')).user; updateAccount(); await refreshVolunteers(); }
  catch (error) { document.getElementById('volunteers-status').textContent = 'Could not load volunteers. Please refresh and try again.'; }
}
