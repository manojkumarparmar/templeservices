import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const peopleScript = await readFile(new URL('../volunteers.js', import.meta.url), 'utf8');
const phoneScript = await readFile(new URL('../phone-auth.js', import.meta.url), 'utf8');
const recurringScript = await readFile(new URL('../recurring.js', import.meta.url), 'utf8');
function find(node, predicate) { return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => find(child, predicate))]; }
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.value = ''; this.style = {}; this.checked = false; this.hidden = false; }
  set textContent(value) { this.text = value; this.children = []; }
  appendChild(node) { this.children.push(node); return node; }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  addEventListener(key, handler) { this.events[key] = handler; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
  querySelectorAll(tags) { return find(this, n => tags.split(',').map(t => t.trim()).includes(n.tag)); }
}
async function fixture() {
  const nodes = {};
  for (const match of html.matchAll(/<[^>]*id="([^"]+)"[^>]*>/g)) {
    const node = nodes[match[1]] = new Element();
    for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) node.attrs[attr[1]] = attr[2];
  }
  let updates = [], backups = {}, fail = false;
  const context = vm.createContext({
    crypto, AbortSignal, setInterval() {},
    document: { getElementById: id => { assert.ok(nodes[id], id); return nodes[id]; }, createElement: tag => new Element(tag), createTextNode: text => ({ text }), addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    async fetch(path, options) {
      if (fail) throw new Error('Connection failed');
      if (path === '/api/auth/me') return Response.json({user:{id:'tester',name:'Test User',roles:['volunteer'],isSuperAdmin:false}});
      if (path === '/api/volunteers') {
        const roster = new Map();
        context.WEEKLY_PLAN.forEach((plan, weekday) => ['am','pm'].forEach(shift => plan[shift].forEach(name => {
          if (!roster.has(name)) roster.set(name,{id:name,name,roles:['volunteer'],active:true,assignments:[],availabilityNotes:'',version:1});
          roster.get(name).assignments.push({weekday,shift});
        })));
        return Response.json({volunteers:[...roster.values()]});
      }
      if (!options.body) return Response.json({ assignments: {}, updates, backups });
      const data = JSON.parse(options.body);
      if (path === '/api/updates') {
        const existing=updates.findIndex(u=>u.id===data.id);
        const saved={...data,volunteerId:context.currentUser.id,version:(data.version || 0)+1,time:new Date().toISOString()};
        if(existing>=0) updates[existing]=saved; else updates.unshift(saved);
      }
      if (path === '/api/updates/delete') updates=updates.filter(u=>u.id!==data.id);
      if (path === '/api/backups') {
        const key = data.date + ':' + data.shift;
        backups[key] = data.action === 'request' ? { person: data.name, notes: data.notes, version: data.version + 1 } : { ...backups[key], cover: data.name, version: data.version + 1 };
        return Response.json({ state: backups[key] });
      }
      return Response.json({ saved: true });
    }
  });
  vm.runInContext(phoneScript, context);
  vm.runInContext(recurringScript, context);
  vm.runInContext(peopleScript, context);
  await vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { nodes, context, setFail(value) { fail = value; }, get updates() { return updates; } };
}
const buttons = (node, text) => find(node, n => n.tag === 'button' && n.text === text);

test('shift actions respect sign-in, dates, assignment and coordinator permissions', async () => {
  const {nodes,context}=await fixture();
  context.currentUser=null; context.render();
  assert.equal(buttons(nodes.days,'Add Notes').length,0);
  assert.equal(buttons(nodes.days,'Need backup').length,0);
  context.currentUser={id:'test',name:'Unassigned',roles:['volunteer']}; context.render();
  assert.equal(buttons(nodes.days,'Add Notes').length,4);
  assert.equal(buttons(nodes.days,'Need backup').length,0);
  const plan=context.WEEKLY_PLAN[(context.templeToday().getDay()+6)%7];
  context.currentUser.name=plan.am[0]; context.render();
  assert.equal(buttons(nodes.days.children[1].children[1],'Need backup').length,1);
  assert.equal(buttons(nodes.days.children[0],'Need backup').length,0);
  context.currentUser.roles=['coordinator']; context.render();
  assert.equal(buttons(nodes.days,'Need backup').length,14);
  assert.equal(buttons(nodes.days.children[2],'Add Notes').length,0);
});

test('notes switch from Add to Edit for the author, prefill their entry, and allow deletion', async () => {
  const f=await fixture(), {nodes,context}=f;
  const shift=nodes.days.children[1].children[1];
  buttons(shift,'Add Notes')[0].events.click();
  const form=find(shift,n=>n.tag==='form' && n.id.startsWith('update-'))[0];
  find(form,n=>n.tag==='textarea')[0].value='Original';
  await form.events.submit({preventDefault(){}});
  assert.equal(buttons(shift,'Add Notes').length,0);
  assert.equal(buttons(shift,'Edit Notes').length,1);
  buttons(shift,'Edit Notes')[0].events.click();
  assert.equal(find(form,n=>n.tag==='textarea')[0].value,'Original');
  assert.equal(find(shift,n=>n.className==='entry').length,0);
  await context.syncShared();
  assert.equal(find(shift,n=>n.className==='entry').length,0);
  buttons(form,'Cancel')[0].events.click();
  assert.equal(find(shift,n=>n.className==='entry').length,1);
  buttons(shift,'Edit Notes')[0].events.click();
  assert.equal(buttons(form,'Delete Notes')[0].hidden,false);
  find(form,n=>n.tag==='textarea')[0].value='Edited';
  await form.events.submit({preventDefault(){}});
  assert.equal(f.updates.length,1); assert.equal(f.updates[0].text,'Edited');
  context.currentUser={id:'another',name:'Another Person',roles:['volunteer']};
  await context.syncShared(); assert.equal(buttons(shift,'Add Notes').length,1);
  context.currentUser={id:'tester',name:'Test User',roles:['volunteer']}; await context.syncShared();
  buttons(shift,'Edit Notes')[0].events.click();
  await buttons(form,'Delete Notes')[0].events.click();
  assert.equal(f.updates.length,0); assert.equal(buttons(shift,'Add Notes').length,1);
});

test('recurring schedule shows a compact Monday–Sunday view and one role-restricted editor', async () => {
  const {nodes,context} = await fixture();
  assert.equal(nodes['recurring-body'].children.length,7);
  assert.equal(nodes['recurring-body'].children[0].children[0].text,'Monday');
  assert.equal(nodes['recurring-body'].children[6].children[0].text,'Sunday');
  assert.equal(find(nodes['recurring-body'], n => n.tag === 'button').length,0);
  assert.equal(nodes['edit-recurring'].hidden,true);
  context.currentUser={id:'coordinator',roles:['coordinator']}; context.updateAccount();
  assert.equal(nodes['edit-recurring'].hidden,false);
  await nodes['edit-recurring'].events.click();
  assert.equal(nodes['recurring-actions'].hidden,false);
  assert.equal(nodes['edit-recurring'].hidden,true);
  assert.equal(find(nodes['recurring-body'], n => n.tag === 'details').length,14);
  const input=find(nodes['recurring-body'],n=>n.type==='checkbox')[0];
  const original=context.recurringDraft[0].assignments.length;
  input.checked=!input.checked; input.events.change();
  assert.notEqual(context.recurringDraft[0].assignments.length,original);
  nodes['cancel-recurring'].events.click();
  assert.equal(nodes['recurring-actions'].hidden,true);
  assert.equal(find(nodes['recurring-body'],n=>n.tag==='input').length,0);
  context.currentUser=null; context.updateAccount();
  assert.equal(nodes['edit-recurring'].hidden,true);
});

test('recurring editor preserves a failed save and returns to the view after a successful save', async () => {
  const f=await fixture(), {nodes,context}=f;
  context.currentUser={id:'coordinator',roles:['coordinator']}; context.updateAccount();
  await nodes['edit-recurring'].events.click();
  const input=find(nodes['recurring-body'],n=>n.type==='checkbox')[0]; input.checked=!input.checked; input.events.change();
  const draft=JSON.stringify(context.recurringDraft);
  f.setFail(true); await nodes['recurring-form'].events.submit({preventDefault(){}});
  assert.equal(JSON.stringify(context.recurringDraft),draft);
  assert.equal(nodes['save-recurring'].disabled,false);
  assert.equal(nodes['recurring-actions'].hidden,false);
  f.setFail(false); await nodes['recurring-form'].events.submit({preventDefault(){}});
  assert.equal(context.recurringDraft,null);
  assert.equal(nodes['recurring-actions'].hidden,true);
  assert.equal(nodes['recurring-status'].text,'Recurring schedule saved.');
});

test('volunteer management exposes add and edit forms only to administrators', async () => {
  const {nodes, context} = await fixture();
  context.currentUser = null; context.updateAccount();
  assert.equal(nodes['sign-in'].hidden, false);
  assert.equal(nodes['add-volunteer'].hidden, true);
  context.currentUser = {id:'admin',roles:['admin'],name:'Admin'};
  context.updateAccount(); context.renderVolunteers();
  assert.equal(nodes['sign-in'].hidden, true);
  assert.equal(nodes['add-volunteer'].hidden, false);
  nodes['add-volunteer'].events.click();
  assert.equal(nodes['new-volunteer'].hidden, false);
  assert.equal(nodes['add-volunteer'].attrs['aria-expanded'], 'true');
  assert.equal(nodes['new-volunteer'].querySelector('input').focused, true);
  buttons(nodes['new-volunteer'], 'Cancel')[0].events.click();
  assert.equal(nodes['new-volunteer'].hidden, true);
  const edit = buttons(nodes['volunteer-list'], 'Edit volunteer')[0];
  edit.events.click();
  assert.equal(edit.attrs['aria-expanded'], 'true');
  const editor = find(nodes['volunteer-list'], n => n.className === 'volunteer-editor' && !n.hidden)[0];
  assert.ok(editor.querySelector('input').value);
  buttons(editor, 'Cancel')[0].events.click();
  assert.equal(edit.attrs['aria-expanded'], 'false');
  nodes['add-volunteer'].events.click();
  context.currentUser = null; context.updateAccount();
  assert.equal(nodes['new-volunteer'].hidden, true);
});

test('directory combines search, role and service-day filters and supports sorting', async () => {
  const { nodes, context } = await fixture();
  context.volunteerDirectory = [
    {name:'Vaidehi Mtj',roles:['volunteer'],assignments:[],active:true,availabilityNotes:''},
    {name:'Ajinkya Pr',roles:['backup'],assignments:[{weekday:2,shift:'pm'}],active:true,availabilityNotes:'Evenings'},
    {name:'Swetha Mtj',roles:['volunteer'],assignments:[{weekday:0,shift:'pm'}],active:true,availabilityNotes:''}
  ];
  nodes['volunteer-sort'].value = 'name-desc';
  nodes['volunteer-sort'].events.change();
  assert.equal(find(nodes['volunteer-list'], n => n.tag === 'h3')[0].text, 'Vaidehi Mtj');
  nodes['volunteer-search'].value = 'evenings';
  nodes['volunteer-role'].value = 'backup';
  nodes['volunteer-day'].value = '2';
  nodes['volunteer-search'].events.input();
  assert.equal(nodes['volunteer-count'].text, '1 of 3 volunteers');
  assert.equal(find(nodes['volunteer-list'], n => n.tag === 'h3')[0].text, 'Ajinkya Pr');
  nodes['volunteer-day'].value = '0'; nodes['volunteer-day'].events.change();
  assert.equal(nodes['volunteer-count'].text, '0 of 3 volunteers');
});
test('shared load updates preserve drafts during refresh and render summaries after saving', async () => {
  const f = await fixture(), { nodes, context } = f;
  assert.equal(nodes.days.children.length, 8);
  assert.equal(buttons(nodes.days.children[0], 'Add Notes').length, 2);
  assert.equal(buttons(nodes.days.children[2], 'Add Notes').length, 0);
  const shift = nodes.days.children[1].children[1];
  buttons(shift, 'Add Notes')[0].events.click();
  const form = find(shift, n => n.tag === 'form' && n.id.startsWith('update-'))[0];
  const text = find(form, n => n.tag === 'textarea')[0]; text.value = 'Draft';
  const checks = find(form, n => n.type === 'checkbox'); checks[0].checked = true;
  await context.syncShared(); assert.equal(form.hidden, false); assert.equal(text.value, 'Draft');
  f.setFail(true); await form.events.submit({ preventDefault() {} });
  assert.equal(form.hidden, false); assert.equal(text.value, 'Draft'); assert.equal(checks[0].checked, true);
  f.setFail(false); await form.events.submit({ preventDefault() {} });
  assert.equal(form.hidden, true); assert.equal(f.updates.length, 1);
  assert.equal(find(shift, n => n.className === 'entry').length, 1);
  assert.equal(f.updates[0].shift, 'am'); assert.equal(f.updates[0].loads.kitchen.washed, true);
});
test('backup changes use shared state while preserving laundry drafts', async () => {
  const { nodes, context } = await fixture(); context.currentUser.roles=['coordinator']; context.render(); const shift = nodes.days.children[1].children[1];
  const noteForm = find(shift, n => n.tag === 'form' && n.id.startsWith('update-'))[0];
  find(noteForm, n => n.tag === 'textarea')[0].value = 'Keep my draft';
  let form = find(shift, n => n.tag === 'form' && n.id.startsWith('backup-'))[0];
  find(form, n => n.type === 'text')[0].value = 'Original';
  await form.events.submit({ preventDefault() {} });
  assert.equal(buttons(shift, 'Opt for backup').length, 1);
  form = find(shift, n => n.tag === 'form' && n.id.startsWith('backup-'))[0];
  find(form, n => n.type === 'text')[0].value = 'Replacement';
  await form.events.submit({ preventDefault() {} });
  assert.equal(buttons(shift, 'Need backup').length, 1);
  assert.ok(find(shift, n => n.text === 'Replacement').length);
  assert.equal(find(noteForm, n => n.tag === 'textarea')[0].value, 'Keep my draft');
  await context.syncShared();
  assert.ok(find(shift, n => n.text === 'Replacement').length);
});

test('three tabs work, public directory has no editing controls, and signed-out actions require sign-in', async () => {
  const { nodes, context } = await fixture();
  nodes['volunteers-tab'].events.click();
  assert.equal(nodes['volunteers-panel'].hidden, false);
  assert.equal(nodes['schedule-panel'].hidden, true);
  nodes['volunteers-tab'].events.keydown({key:'ArrowRight',preventDefault(){}});
  assert.equal(nodes['schedule-panel'].hidden, false);
  assert.equal(buttons(nodes['volunteer-list'], 'Edit volunteer').length, 0);
  context.currentUser = null;
  context.render();
  assert.equal(buttons(nodes.days,'Add Notes').length,0);
  assert.equal(buttons(nodes.days,'Need backup').length,0);
  const updateForm = find(nodes.days.children[1], n => n.tag === 'form' && n.id.startsWith('update-'))[0];
  assert.equal(updateForm.hidden, true);
});
test('admin editor locks self-demotion and super-admin editor locks the protected role', async () => {
  const { context } = await fixture();
  context.currentUser = {id:'self',name:'Admin',roles:['admin'],isSuperAdmin:false};
  const self = {id:'self',name:'Admin',email:'admin@example.com',roles:['admin','volunteer'],assignments:[],availabilityNotes:'',active:true,version:1};
  let editor = context.volunteerForm(self, () => {});
  let labels = find(editor, n => n.className === 'check-label');
  const labelText = n => (n.children || []).find(c => c.text)?.text;
  assert.equal(labels.find(n => labelText(n) === 'admin').children[0].disabled, true);
  assert.equal(buttons(editor,'Remove volunteer').length,0);
  context.currentUser = {id:'self',name:'Super',roles:['super-admin'],isSuperAdmin:true};
  editor = context.volunteerForm({...self,roles:['super-admin'],isSuperAdmin:true},()=>{});
  labels = find(editor, n => n.className === 'check-label');
  assert.equal(labels.find(n => labelText(n) === 'super-admin').children[0].disabled,true);
  assert.equal(buttons(editor,'Remove volunteer').length,0);
});


test('signed-in history is read only, supports week navigation, and clears on sign-out', async () => {
  const {nodes,context}=await fixture();
  assert.equal(nodes['view-history'].hidden,false);
  nodes['view-history'].events.click();
  await context.loadHistory();
  assert.equal(nodes['history-panel'].hidden,false);
  assert.equal(nodes['current-schedule'].hidden,true);
  assert.ok(nodes['history-days'].children.length>0);
  assert.equal(find(nodes['history-days'],n=>n.tag==='button'||n.tag==='form').length,0);
  assert.ok(find(nodes['history-days'],n=>n.text==='Original assignment not recorded.').length>0);
  const previous=nodes['history-date'].value;
  nodes['history-previous'].events.click(); await context.loadHistory();
  assert.ok(nodes['history-date'].value<previous);
  context.currentUser=null; context.updateAccount();
  assert.equal(nodes['view-history'].hidden,true);
  assert.equal(nodes['history-panel'].hidden,true);
  assert.equal(nodes['history-days'].children.length,0);
  assert.equal(nodes['current-schedule'].hidden,false);
});


test('verified phone with an unmatched profile resets the consumed code instead of retrying it', async () => {
  const {nodes,context} = await fixture();
  context.phoneConfirmation = {confirm: async () => ({user:{getIdToken:async ()=>'test-token'}})};
  context.api = async () => { throw new Error('Your phone was verified, but it is not linked to an active volunteer profile.'); };
  const target = new Element('form'); const button = new Element('button'); target.appendChild(button);
  nodes['phone-code'].value = '123456'; nodes['phone-start'].hidden = true;
  await nodes['phone-verify'].events.submit({preventDefault(){},target});
  assert.equal(context.phoneConfirmation,null);
  assert.equal(nodes['phone-verify'].hidden,true);
  assert.equal(nodes['phone-start'].hidden,false);
  assert.equal(nodes['phone-code'].value,'');
  assert.match(nodes['auth-status'].text,/not linked to an active volunteer profile/);
  assert.equal(button.disabled,false);
});
