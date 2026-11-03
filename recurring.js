var recurringDraft = null, recurringBusy = false;
function canEditRecurring() {
  return !!currentUser && (managesVolunteers() || currentUser.roles.indexOf('coordinator') >= 0);
}
function renderRecurring() {
  var allowed = canEditRecurring();
  if (!allowed) recurringDraft = null;
  var editing = !!recurringDraft;
  document.getElementById('edit-recurring').hidden = !allowed || editing;
  document.getElementById('edit-recurring').setAttribute('aria-expanded', String(editing));
  document.getElementById('recurring-actions').hidden = !editing;
  document.getElementById('recurring-help').hidden = !editing;
  var body = document.getElementById('recurring-body'); body.textContent = '';
  WEEKDAYS.forEach(function (day, weekday) {
    var row = el('tr'); row.appendChild(el('th', null, day));
    ['am','pm'].forEach(function (shift) {
      var cell = el('td');
      if (!editing) {
        var names = volunteerDirectory.filter(function (v) { return v.active && v.assignments.some(function (a) { return a.weekday === weekday && a.shift === shift; }); }).map(function (v) { return v.name; });
        if (!names.length) cell.textContent = 'Unassigned';
        names.forEach(function (name) { var person = el('div'); person.appendChild(volunteerIdentity(name)); cell.appendChild(person); });
        if (!names.length) cell.className = 'note';
      } else {
        var picker = el('details', 'recurring-picker');
        var summary = el('summary'); picker.appendChild(summary);
        function updateSummary() {
          summary.textContent = recurringDraft.filter(function (v) { return v.assignments.some(function (a) { return a.weekday === weekday && a.shift === shift; }); }).map(function (v) { return v.name; }).join(', ') || 'Select volunteers';
        }
        updateSummary();
        var choices = el('div', 'recurring-choices'); picker.appendChild(choices);
        recurringDraft.forEach(function (v) {
          var label = el('label', 'check-label'), input = el('input'); input.type = 'checkbox';
          input.checked = v.assignments.some(function (a) { return a.weekday === weekday && a.shift === shift; });
          input.setAttribute('aria-label', day + ' ' + (shift === 'am' ? 'morning: ' : 'evening: ') + v.name);
          input.addEventListener('change', function () {
            v.assignments = v.assignments.filter(function (a) { return !(a.weekday === weekday && a.shift === shift); });
            if (input.checked) v.assignments.push({weekday:weekday,shift:shift});
            updateSummary();
          });
          var choice = el('div', 'recurring-choice-row');
          label.appendChild(input); label.appendChild(document.createTextNode(v.name)); choice.appendChild(label);
          var person = volunteerDirectory.find(function (p) { return p.id === v.id; }); appendVolunteerContacts(choice, person); choices.appendChild(choice);
        });
        cell.appendChild(picker);
      }
      row.appendChild(cell);
    }); body.appendChild(row);
  });
}
function initRecurring() {
  document.getElementById('edit-recurring').addEventListener('click', async function () {
    if (!canEditRecurring() || recurringBusy) return;
    var status = document.getElementById('recurring-status'); status.textContent = 'Loading current assignments…';
    recurringBusy = true; document.getElementById('edit-recurring').disabled = true;
    try {
      await refreshVolunteers();
      recurringDraft = volunteerDirectory.filter(function (v) { return v.active; }).map(function (v) { return {id:v.id,name:v.name,version:v.version,assignments:v.assignments.map(function (a) { return {weekday:a.weekday,shift:a.shift}; })}; });
      renderRecurring(); status.textContent = '';
      document.getElementById('recurring-body').querySelector('summary').focus();
    } catch (error) { status.textContent = error.message; }
    finally { recurringBusy = false; document.getElementById('edit-recurring').disabled = false; }
  });
  document.getElementById('cancel-recurring').addEventListener('click', function () {
    if (recurringBusy) return;
    recurringDraft = null; renderRecurring(); document.getElementById('recurring-status').textContent = '';
    document.getElementById('edit-recurring').focus();
  });
  document.getElementById('recurring-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (!canEditRecurring() || !recurringDraft || recurringBusy) return;
    recurringBusy = true;
    var save = document.getElementById('save-recurring'), cancel = document.getElementById('cancel-recurring'), status = document.getElementById('recurring-status');
    save.disabled = true; cancel.disabled = true;
    document.getElementById('recurring-body').querySelectorAll('input').forEach(function (input) { input.disabled = true; });
    status.textContent = 'Saving recurring schedule…';
    try {
      await api('recurring/save', {volunteers:recurringDraft.map(function (v) { return {id:v.id,version:v.version,assignments:v.assignments}; })});
      recurringDraft = null;
      await refreshVolunteers(); render(); renderRecurring(); await syncShared(true);
      status.textContent = 'Recurring schedule saved.'; document.getElementById('edit-recurring').focus();
    } catch (error) { status.textContent = error.message; }
    finally {
      recurringBusy = false; save.disabled = false; cancel.disabled = false;
      document.getElementById('recurring-body').querySelectorAll('input').forEach(function (input) { input.disabled = false; });
    }
  });
}
