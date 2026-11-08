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
  get classList() { const node = this; return { toggle(name, on) { const names = new Set((node.className || '').split(/\s+/).filter(Boolean)); (on === undefined ? !names.has(name) : on) ? names.add(name) : names.delete(name); node.className = [...names].join(' '); } }; }
  focus() { this.focused = true; }
  contains(node) { return !!node && find(this, child => child === node).length > 0; }
  getBoundingClientRect() { return {left:280,top:550,bottom:594}; }
  get offsetWidth() { return 220; }
  get offsetHeight() { return 180; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
  querySelectorAll(tags) { return find(this, n => tags.split(',').map(t => t.trim()).includes(n.tag)); }
}
async function fixture() {
  const nodes = {}, documentEvents = {};
  for (const match of html.matchAll(/<[^>]*id="([^"]+)"[^>]*>/g)) {
    const node = nodes[match[1]] = new Element();
    for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) node.attrs[attr[1]] = attr[2];
  }
  let updates = [], backups = {}, fail = false;
  const context = vm.createContext({
    crypto, AbortSignal, setInterval() {}, window: {innerHeight:640},
    document: { documentElement:{clientWidth:390}, getElementById: id => { assert.ok(nodes[id], id); return nodes[id]; }, createElement: tag => new Element(tag), createTextNode: text => ({ text }), addEventListener(type, handler) { (documentEvents[type] ||= []).push(handler); } },
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
        const key = data.date + ':' + data.shift, current = backups[key] || { status: 'none' };
        const by = { id: context.currentUser.id, name: context.currentUser.name };
        const next = {
          request: { status: 'needed', requestedBy: by, notes: data.notes || '', backup: null },
          offer: { ...current, status: 'assigned', backup: by },
          assign: { ...current, status: 'assigned', backup: { id: data.volunteerId, name: data.volunteerId } },
          reopen: { ...current, status: 'needed', backup: null },
          cancel: { status: 'none' }, release: { status: 'none' }
        }[data.action];
        backups[key] = { ...next, version: data.version + 1 };
        return Response.json({ state: backups[key] });
      }
      return Response.json({ saved: true });
    }
  });
  vm.runInContext(phoneScript, context);
  vm.runInContext(recurringScript, context);
  vm.runInContext(peopleScript, context);
  await vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { nodes, context, documentEvents, setFail(value) { fail = value; }, get updates() { return updates; } };
}
const buttons = (node, text) => find(node, n => n.tag === 'button' && (n.text === text || n.title === text || String(n.attrs['aria-label'] || '').startsWith(text)));

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
test('backup flow keeps primaries on the card and moves between needed, assigned and needed again', async () => {
  const { nodes, context } = await fixture();
  const plan = context.WEEKLY_PLAN[(context.templeToday().getDay() + 6) % 7];
  const shiftFor = () => nodes.days.children[1].children[1];
  const signIn = user => { context.currentUser = user; context.render(); return shiftFor(); };
  const unavailable = shift => find(shift, n => /\bgone\b/.test(n.className || '')).length;
  let shift = signIn({ id: plan.am[0], name: plan.am[0], roles: ['volunteer'] });
  const noteForm = find(shift, n => n.tag === 'form' && n.id.startsWith('update-'))[0];
  find(noteForm, n => n.tag === 'textarea')[0].value = 'Keep my draft';
  assert.equal(unavailable(shift), 0);
  buttons(shift, 'Need backup')[0].events.click();
  const form = find(shift, n => n.tag === 'form' && n.id.startsWith('backup-'))[0];
  assert.equal(find(form, n => n.type === 'text').length, 0);
  await form.events.submit({ preventDefault() {} });
  assert.ok(find(shift, n => n.text === '⚠ BACKUP NEEDED').length);
  assert.ok(find(shift, n => n.text === 'Needed').length);
  assert.equal(unavailable(shift), plan.am.length);
  assert.equal(buttons(shift, 'Offer to cover').length, 0);
  assert.equal(buttons(shift, 'Cancel need for backup').length, 1);
  assert.equal(find(shift, n => n.tag === 'select').length, 0);
  assert.equal(find(noteForm, n => n.tag === 'textarea')[0].value, 'Keep my draft');
  shift = signIn({ id: 'helper', name: 'Helper Mtj', roles: ['volunteer'] });
  assert.equal(buttons(shift, 'Cancel need for backup').length, 0);
  assert.equal(buttons(shift, 'Offer to cover').length, 1);
  await buttons(shift, 'Offer to cover')[0].events.click();
  assert.ok(find(shift, n => n.text === '✓ BACKUP CONFIRMED').length);
  assert.ok(find(shift, n => n.text === 'Helper Mtj').length);
  assert.equal(unavailable(shift), plan.am.length);
  assert.equal(buttons(shift, 'Need backup').length, 1);
  assert.equal(buttons(shift, 'Release backup').length, 0);
  await buttons(shift, 'Need backup')[0].events.click();
  assert.ok(find(shift, n => n.text === 'Needed').length);
  assert.equal(find(shift, n => n.text === 'Helper Mtj').length, 0);
  shift = signIn({ id: 'coord', name: 'Coord Mtj', roles: ['coordinator'] });
  assert.equal(buttons(shift, 'Cancel need for backup').length, 1);
  const select = find(shift, n => n.tag === 'select')[0];
  const options = find(select, n => n.tag === 'option');
  assert.ok(options.length > 1 && !options.some(o => plan.am.includes(o.text)));
  await buttons(shift, 'Assign')[0].events.click();
  assert.ok(find(shift, n => n.text === 'Choose a volunteer.').length);
  select.value = options[1].value;
  await buttons(shift, 'Assign')[0].events.click();
  assert.ok(find(shift, n => n.text === '✓ BACKUP CONFIRMED').length);
  assert.equal(buttons(shift, 'Need backup').length, 1);
  assert.equal(buttons(shift, 'Release backup').length, 1);
  shift = signIn({ id: plan.am[0], name: plan.am[0], roles: ['volunteer'] });
  assert.equal(buttons(shift, 'Need backup').length, 0);
  await buttons(shift, 'Release backup')[0].events.click();
  assert.equal(unavailable(shift), 0);
  assert.equal(find(shift, n => n.text === '✓ BACKUP CONFIRMED').length, 0);
  assert.equal(buttons(shift, 'Need backup').length, 1);
  buttons(shift, 'Need backup')[0].events.click();
  await find(shift, n => n.tag === 'form' && n.id.startsWith('backup-'))[0].events.submit({ preventDefault() {} });
  await buttons(shift, 'Cancel need for backup')[0].events.click();
  assert.equal(unavailable(shift), 0);
  assert.equal(buttons(shift, 'Need backup').length, 1);
  shift = signIn(null);
  assert.equal(buttons(shift, 'Need backup').length + buttons(shift, 'Offer to cover').length, 0);
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


test('history shows a backup only when one was assigned, with the primaries marked unavailable', async () => {
  const {nodes,context}=await fixture();
  const day=context.iso(context.addDays(context.templeToday(),-1));
  const people=[{id:'a',name:'Asha Mtj'},{id:'b',name:'Bela Mtj'}];
  const requestedBy={id:'a',name:'Asha Mtj'};
  context.api=async()=>({assignments:{[day]:{am:people,pm:people}},updates:[],backups:{
    [day+':am']:{status:'assigned',requestedBy,notes:'Travelling',backup:{id:'h',name:'Hema Mtj'},version:3},
    [day+':pm']:{status:'needed',requestedBy,notes:'Never filled',backup:null,version:2}}});
  nodes['history-date'].value=day;
  nodes['view-history'].events.click(); await context.loadHistory();
  const boxes=find(nodes['history-days'],n=>n.className==='shift');
  const covered=boxes.filter(b=>find(b,n=>n.text==='Backup: Hema Mtj covered this shift.').length);
  assert.equal(covered.length,1);
  assert.equal(find(covered[0],n=>n.className==='gone').length,2);
  assert.equal(find(nodes['history-days'],n=>n.className==='gone').length,2);
  assert.equal(find(nodes['history-days'],n=>n.text==='Never filled').length,0);
  assert.equal(find(nodes['history-days'],n=>/requested backup|previously/.test(n.text||'')).length,0);
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

test('existing volunteer cards show contact actions only while signed in and clear them before a failed refresh', async () => {
  const {nodes,context,setFail}=await fixture();
  context.volunteerDirectory=[{id:'person',name:'Sample Mtj',phone:'+12145550123',email:'sample@example.com',roles:['volunteer'],assignments:[],availabilityNotes:'',active:true}];
  context.renderVolunteers();
  let links=find(nodes['volunteer-list'],n=>n.tag==='a');
  assert.deepEqual(links.map(n=>n.href),['tel:+12145550123','sms:+12145550123','https://wa.me/12145550123','mailto:sample@example.com']);
  assert.equal(links[0].text,'Call'); assert.equal(links[1].text,'SMS');
  assert.match(links[0].innerHTML,/<svg/); assert.match(links[1].innerHTML,/<svg/);
  assert.equal(find(nodes['volunteer-list'],n=>n.className==='note volunteer-phone')[0].text,'+12145550123');
  assert.equal(links[0].attrs['aria-label'],'Call Sample Mtj');
  assert.equal(links[1].attrs['aria-label'],'Send SMS to Sample Mtj');
  assert.equal(buttons(nodes['volunteer-list'],'Edit volunteer').length,0);
  // Sign-out succeeds, but the subsequent roster refresh fails.
  const originalApi=context.api;
  context.api=async (path,data)=>{ if(path==='auth/logout') { setFail(true); return {}; } return originalApi(path,data); };
  await nodes['sign-out'].events.click();
  assert.equal(context.currentUser,null);
  assert.equal(find(nodes['volunteer-list'],n=>n.tag==='a').length,0);
  assert.equal(find(nodes['volunteer-list'],n=>n.className==='note volunteer-phone').length,0);
});

test('contact actions cover current schedules, backups, recurring assignments and notes, excluding every past date', async () => {
  const {nodes,context}=await fixture();
  const today=context.iso(context.templeToday()), yesterday=context.iso(context.addDays(context.templeToday(),-1));
  const person={id:'contact',name:'Contact Mtj',phone:'+12145550123',email:'contact@example.com',roles:['volunteer','backup'],assignments:[{weekday:0,shift:'am'}],availabilityNotes:'',active:true};
  context.volunteerDirectory=[person];
  const links=node=>find(node,n=>n.tag==='a');
  context.applyVolunteerSchedule(); context.renderRecurring();
  assert.equal(links(nodes['backup-list']).length,4);
  assert.equal(links(nodes['recurring-body']).length,4);
  assert.equal(links(context.renderScheduledShift(today,'am',[person.name],today)).length,4);
  assert.equal(links(context.renderScheduledShift(yesterday,'am',[person.name],today)).length,0);
  const entry={who:person.name,volunteerId:person.id,date:today,time:new Date().toISOString()};
  assert.equal(links(context.renderUpdate(entry)).length,4);
  assert.equal(links(context.renderUpdate({...entry,date:yesterday})).length,0);
  assert.equal(links(context.renderUpdate(entry,true)).length,0);
  context.sharedBackups[today+':am']={status:'assigned',requestedBy:{id:person.id,name:person.name},backup:{id:'other',name:'Another Mtj'}};
  context.volunteerDirectory.push({...person,id:'other',name:'Another Mtj'});
  assert.equal(links(context.renderScheduledShift(today,'am',[person.name],today)).length,8);
  // Ambiguous names must not accidentally expose another person's contact information.
  context.volunteerDirectory.push({...person,id:'duplicate'});
  assert.equal(links(context.volunteerIdentity(person.name)).length,0);
  assert.equal(links(context.volunteerIdentity(person.name,person.id)).length,4);
  context.currentUser=null; context.updateAccount();
  assert.equal(links(nodes['backup-list']).length,0);
  assert.equal(links(nodes['recurring-body']).length,0);
  assert.equal(links(nodes.days).length,0);
  assert.equal(links(context.renderUpdate(entry)).length,0);
});

test('combined contact menu stays beside the name and supports dismissal, focus and viewport edges', async () => {
  const {nodes,context,documentEvents}=await fixture();
  const person={id:'menu-person',name:'Sample Mtj',phone:'+1 (214) 555-0123',email:'sample@example.com',roles:['volunteer'],assignments:[],availabilityNotes:'',active:true};
  context.volunteerDirectory=[person]; context.renderVolunteers();
  const row=find(nodes['volunteer-list'],n=>n.className==='volunteer-name-row')[0];
  const button=find(row,n=>n.className==='volunteer-contact contact-toggle')[0];
  const menu=find(row,n=>n.className==='contact-menu')[0];
  const links=find(menu,n=>n.tag==='a');
  assert.equal(row.children[0].tag,'h3');
  assert.equal(find(row,n=>n.tag==='button').length,1);
  assert.equal(menu.hidden,true); assert.equal(button.attrs['aria-controls'],menu.id);
  assert.deepEqual(links.map(n=>n.href),['tel:+1 (214) 555-0123','sms:+1 (214) 555-0123','https://wa.me/12145550123']);
  assert.equal(links[2].target,'_blank'); assert.equal(links[2].rel,'noopener noreferrer');
  const click={preventDefault(){},stopPropagation(){}};
  button.events.click(click);
  assert.equal(menu.hidden,false); assert.equal(button.attrs['aria-expanded'],'true');
  assert.equal(menu.style.left,'162px'); assert.equal(menu.style.top,'365px');
  // Focus moving into the menu keeps the choices available to the keyboard.
  row.children[1].events.focusout({relatedTarget:links[0]}); assert.equal(menu.hidden,false);
  for(const handler of documentEvents.keydown) handler({key:'Escape',preventDefault(){}});
  assert.equal(menu.hidden,true); assert.equal(button.focused,true);
  button.events.click(click); button.events.click(click); assert.equal(menu.hidden,true);
  button.events.click(click); links[2].events.click(); assert.equal(menu.hidden,true);
  button.events.click(click);
  for(const handler of documentEvents.click) handler({target:new Element('div')});
  assert.equal(menu.hidden,true);
  button.events.click(click);
  for(const handler of documentEvents.scroll) handler();
  assert.equal(menu.hidden,true);
  button.events.click(click); context.currentUser=null; context.updateAccount();
  assert.equal(menu.hidden,true); assert.equal(context.openVolunteerContact,null);
  assert.equal(find(nodes['volunteer-list'],n=>n.tag==='a').length,0);
});

test('only one contact menu opens and email-only volunteers keep their email link', async () => {
  const {context}=await fixture();
  const a=new Element('span'), b=new Element('span');
  context.appendVolunteerContacts(a,{name:'First',phone:'+12145550123'});
  context.appendVolunteerContacts(b,{name:'Second',phone:'+12145550124'});
  const first=find(a,n=>n.tag==='button')[0], second=find(b,n=>n.tag==='button')[0];
  const click={preventDefault(){},stopPropagation(){}};
  first.events.click(click); second.events.click(click);
  assert.equal(first.attrs['aria-expanded'],'false'); assert.equal(second.attrs['aria-expanded'],'true');
  const emailOnly=new Element('span');
  context.appendVolunteerContacts(emailOnly,{name:'Email Only',email:'only@example.com'});
  assert.equal(find(emailOnly,n=>n.tag==='button').length,0);
  assert.equal(find(emailOnly,n=>n.tag==='a')[0].href,'mailto:only@example.com');
});

test('Google sign-in uses configured client and nonce and submits credentials to existing authentication', async () => {
  const {nodes,context}=await fixture();
  let settings, rendered, submitted;
  context.window={google:{accounts:{id:{initialize(value){settings=value;},renderButton(node,options){rendered={node,options};}}}}};
  context.google=context.window.google;
  context.api=async (path,data)=>{
    if(path==='auth/config') return {googleClientId:'test-client',nonce:'test-nonce',firebase:{}};
    if(path==='auth/google') { submitted=data; return {user:{id:'approved'}}; }
    throw new Error('Unexpected API '+path);
  };
  let user; context.signedIn=async value=>{user=value;};
  await context.openSignIn();
  assert.equal(nodes['google-sign-in'].hidden,false);
  assert.equal(nodes['signin-lookup'].hidden,false);
  assert.equal(settings.client_id,'test-client'); assert.equal(settings.nonce,'test-nonce');
  assert.equal(rendered.node,nodes['google-sign-in']);
  await settings.callback({credential:'google-token'});
  assert.equal(submitted.credential,'google-token'); assert.equal(user.id,'approved');
  context.api=async ()=>{throw new Error('Please ask an administrator to add your email to the volunteer list.');};
  user=null; await settings.callback({credential:'unapproved-token'});
  assert.equal(user,null); assert.match(nodes['auth-status'].textContent || nodes['auth-status'].text,/administrator/);
});
