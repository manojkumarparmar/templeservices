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
  renderPlanned();
}
function initRecurring() {
  initPlanned();
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

var plannedList = [], plannedDraft = null, plannedBusy = false;
function parseIsoDate(value) { var p = value.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function plannedLabel(value) { return parseIsoDate(value).toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'}); }
function weeklyNames(dateValue, shift) {
  var weekday = (parseIsoDate(dateValue).getDay() + 6) % 7;
  return volunteerDirectory.filter(function (v) { return v.active && v.assignments.some(function (a) { return a.weekday === weekday && a.shift === shift; }); }).map(function (v) { return v.name; });
}
async function loadPlanned() {
  try { var data = await api('planned'); plannedList = data.planned; renderPlanned(); } catch (error) { /* keep the last list */ }
}
function renderPlanned() {
  var list = document.getElementById('planned-list'); if (!list) return;
  var allowed = canEditRecurring();
  if (!allowed) plannedDraft = null;
  list.textContent = '';
  document.getElementById('planned-empty').hidden = plannedList.length > 0;
  plannedList.forEach(function (entry) {
    var item = el('li'), left = el('div');
    left.appendChild(el('strong', null, plannedLabel(entry.date) + ' · ' + (entry.shift === 'am' ? 'Morning' : 'Evening')));
    var who = el('div');
    if (entry.people.length) entry.people.forEach(function (p) { who.appendChild(el('span', 'chip', p.name)); who.appendChild(document.createTextNode(' ')); });
    else who.appendChild(el('span', 'note', 'No one planned'));
    left.appendChild(who);
    var weekly = weeklyNames(entry.date, entry.shift);
    left.appendChild(el('div', 'note', 'Weekly: ' + (weekly.join(', ') || 'no one')));
    item.appendChild(left);
    if (allowed) {
      var actions = el('div', 'planned-actions');
      var edit = el('button', 'btn-small', 'Edit'); edit.type = 'button';
      edit.setAttribute('aria-label', 'Edit ' + plannedLabel(entry.date) + ' ' + entry.shift);
      edit.addEventListener('click', function () { openPlanned({shift: entry.shift, dates: [entry.date], ids: entry.people.map(function (p) { return p.id; })}); });
      var remove = el('button', 'btn-small', 'Remove'); remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove plan for ' + plannedLabel(entry.date) + ' ' + entry.shift);
      remove.addEventListener('click', function () { removePlanned(entry, remove); });
      actions.appendChild(edit); actions.appendChild(remove); item.appendChild(actions);
    }
    list.appendChild(item);
  });
  var button = document.getElementById('plan-dates'); button.hidden = !allowed || !!plannedDraft;
  var form = document.getElementById('planned-form'); form.hidden = !plannedDraft;
  if (!plannedDraft) return;
  document.getElementById('planned-shift').value = plannedDraft.shift;
  renderPlannedDraft();
}
function renderPlannedDraft() {
  var dates = document.getElementById('planned-dates'); dates.textContent = '';
  plannedDraft.dates.slice().sort().forEach(function (value) {
    var chip = el('button', 'btn-small', plannedLabel(value) + ' ×'); chip.type = 'button';
    chip.setAttribute('aria-label', 'Remove ' + plannedLabel(value));
    chip.addEventListener('click', function () { plannedDraft.dates = plannedDraft.dates.filter(function (d) { return d !== value; }); renderPlannedDraft(); });
    dates.appendChild(chip);
  });
  var box = document.getElementById('planned-people');
  if (box.children.length) return;
  volunteerDirectory.filter(function (v) { return v.active; }).forEach(function (v) {
    var label = el('label', 'check-label'), input = el('input'); input.type = 'checkbox'; input.value = v.id;
    input.checked = plannedDraft.ids.indexOf(v.id) >= 0;
    input.addEventListener('change', function () {
      plannedDraft.ids = plannedDraft.ids.filter(function (id) { return id !== v.id; });
      if (input.checked) plannedDraft.ids.push(v.id);
    });
    label.appendChild(input); label.appendChild(document.createTextNode(v.name)); box.appendChild(label);
  });
}
function openPlanned(draft) {
  if (!canEditRecurring()) return;
  plannedDraft = draft; document.getElementById('planned-people').textContent = '';
  document.getElementById('planned-status').textContent = '';
  renderPlanned(); document.getElementById('planned-shift').focus();
}
async function removePlanned(entry, button) {
  if (plannedBusy) return; plannedBusy = true; button.disabled = true;
  var status = document.getElementById('planned-status'); status.textContent = 'Removing…';
  try {
    await api('planned/remove', {date: entry.date, shift: entry.shift});
    await loadPlanned(); await syncShared(true); status.textContent = 'Plan removed. ' + plannedLabel(entry.date) + ' follows the weekly schedule.';
  } catch (error) { status.textContent = error.message; }
  finally { plannedBusy = false; button.disabled = false; }
}
function initPlanned() {
  var status = document.getElementById('planned-status'), dateInput = document.getElementById('planned-date');
  document.getElementById('plan-dates').addEventListener('click', function () { openPlanned({shift: 'am', dates: [], ids: []}); });
  document.getElementById('cancel-planned').addEventListener('click', function () {
    if (plannedBusy) return; plannedDraft = null; status.textContent = ''; renderPlanned(); document.getElementById('plan-dates').focus();
  });
  document.getElementById('planned-shift').addEventListener('change', function (event) { if (plannedDraft) plannedDraft.shift = event.target.value; });
  function addDates(count) {
    if (!plannedDraft) return;
    if (!dateInput.value) { status.textContent = 'Choose a date first.'; return; }
    var start = parseIsoDate(dateInput.value);
    for (var i = 0; i < count; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * i), value = iso(d);
      if (plannedDraft.dates.indexOf(value) < 0) plannedDraft.dates.push(value);
    }
    status.textContent = ''; renderPlannedDraft();
  }
  document.getElementById('planned-add-date').addEventListener('click', function () { addDates(1); });
  document.getElementById('planned-add-weeks').addEventListener('click', function () {
    var weeks = Math.max(2, Math.min(12, parseInt(document.getElementById('planned-weeks').value, 10) || 4)); addDates(weeks);
  });
  document.getElementById('planned-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (!plannedDraft || plannedBusy) return;
    if (!plannedDraft.dates.length) { status.textContent = 'Add at least one date.'; return; }
    plannedBusy = true; var save = document.getElementById('save-planned'); save.disabled = true; status.textContent = 'Saving planned dates…';
    try {
      var count = plannedDraft.dates.length;
      await api('planned/save', {shift: plannedDraft.shift, dates: plannedDraft.dates, volunteerIds: plannedDraft.ids});
      plannedDraft = null; await loadPlanned(); await syncShared(true); renderPlanned();
      status.textContent = count + (count === 1 ? ' date saved.' : ' dates saved.'); document.getElementById('plan-dates').focus();
    } catch (error) { status.textContent = error.message; }
    finally { plannedBusy = false; save.disabled = false; }
  });
  loadPlanned();
}
