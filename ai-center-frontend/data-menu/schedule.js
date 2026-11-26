(() => {
  'use strict';
  const week = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const zones = {UTC:0,'Asia/Dubai':240,'Asia/Shanghai':480};
  const frequencies = ['Every minute','Daily','Weekly'];
  const operations = {ingest:'Ingest',refresh:'Refresh',rebuild:'Rebuild index'};
  const pad = n => String(n).padStart(2,'0');
  const zoneLabel = zone => ({UTC:'UTC','Asia/Dubai':'Dubai (UTC+04:00)','Asia/Shanghai':'Shanghai (UTC+08:00)'}[zone]);

  function settings(plan = {}) {
    // Old demo schedules stored an ISO next run without an explicit wall-clock time.
    const prior = plan.nextAt && new Date(plan.nextAt);
    const validPrior = prior && Number.isFinite(+prior);
    return {type:plan.type || 'refresh', frequency:plan.frequency || 'Daily', zone:plan.zone || 'UTC',
      time:plan.time || (validPrior ? pad(prior.getUTCHours()) + ':' + pad(prior.getUTCMinutes()) : '09:00'),
      weekday:plan.weekday ?? (validPrior ? prior.getUTCDay() : 1)};
  }
  function next(plan,stamp) {
    const p = settings(plan);
    const origin = new Date(stamp);
    if (!frequencies.includes(p.frequency) || !Object.hasOwn(operations,p.type) ||
        !Object.hasOwn(zones,p.zone) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time) ||
        !Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6) throw new Error('Choose a valid recurrence, time and time zone.');
    if (p.frequency === 'Every minute') return new Date((Math.floor(+origin/60000)+1)*60000).toISOString();
    // Compute calendar dates in the chosen fixed-offset zone regardless of the browser's location.
    const offset = zones[p.zone]*60000;
    const local = new Date(+origin + offset);
    const [hour,minute] = p.time.split(':').map(Number);
    local.setUTCHours(hour,minute,0,0);
    if (p.frequency === 'Weekly') local.setUTCDate(local.getUTCDate() + (p.weekday - local.getUTCDay() + 7) % 7);
    if (+local - offset <= +origin) local.setUTCDate(local.getUTCDate() + (p.frequency === 'Weekly' ? 7 : 1));
    return new Date(+local - offset).toISOString();
  }
  function save(previous,input,stamp) {
    const options = {...settings(previous),...input};
    const candidate = next(options,stamp);
    return {...settings(options),enabled:Boolean(input.enabled),nextAt:input.enabled ? candidate : null};
  }
  function description(plan) {
    const p = settings(plan);
    if (p.frequency === 'Every minute') return p.frequency;
    return (p.frequency === 'Weekly' ? 'Every ' + week[p.weekday] : 'Daily') + ' at ' + p.time + ' · ' + zoneLabel(p.zone);
  }
  function display(stamp,zone) {
    if (!stamp) return '—';
    return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',
      hourCycle:'h23',timeZone:zone,timeZoneName:'short'}).format(new Date(stamp));
  }
  window.DataSchedule = {next,save,settings,description,display};

  function render(host,ctx) {
    const {store,dataset,esc} = ctx;
    const plan = dataset.schedule;
    const p = settings(plan);
    const active = Boolean(plan.enabled && !dataset.archived);
    const option = (value,label,current) => '<option value="' + esc(value) + '"' + (value === current ? ' selected' : '') + '>' + esc(label) + '</option>';
    const lastJob = store.snapshot().jobs.find(j => j.datasetId === dataset.id && j.trigger === 'Schedule');
    host.innerHTML = `<div class="dm-schedule-view">
      <section class="dm-panel"><header class="dm-head"><h2>Dataset schedule</h2>
        <span class="dm-badge" data-status="${active ? 'enabled' : 'manual'}">${active ? 'Enabled' : 'Off'}</span></header>
        <dl class="dm-kv"><dt>Recurrence</dt><dd>${active ? esc(description(plan)) : 'On demand'}</dd>
        <dt>Next run</dt><dd data-next-run>${active ? esc(display(plan.nextAt,p.zone)) : '—'}</dd>
        <dt>Last scheduled run</dt><dd data-last-job>${lastJob ? esc(lastJob.id + ' · ' + lastJob.status) : 'No scheduled run yet'}</dd></dl>
      </section>
      ${dataset.archived ? '<p class="dm-notice">Restore this dataset to enable a schedule.</p>' : `<section class="dm-panel"><h2>${active ? 'Edit schedule' : 'Set up a schedule'}</h2>
        <form><div class="dm-grid">
          <label class="dm-field">Operation<select name="type" aria-label="Operation">${Object.entries(operations).map(([k,v])=>option(k,v,p.type)).join('')}</select></label>
          <label class="dm-field">Frequency<select name="frequency" aria-label="Frequency">${frequencies.map(v=>option(v,v,p.frequency)).join('')}</select></label>
          <label class="dm-field" data-day>Day of week<select name="weekday" aria-label="Day of week">${week.map((v,i)=>option(i,v,p.weekday)).join('')}</select></label>
          <label class="dm-field" data-clock>Run at<input type="time" name="time" required value="${esc(p.time)}"></label>
          <label class="dm-field" data-clock>Time zone<select name="zone" aria-label="Time zone">${Object.keys(zones).map(z=>option(z,zoneLabel(z),p.zone)).join('')}</select></label>
        </div><output aria-live="polite" data-next></output>
        <div class="dm-actions"><button class="dm-btn dm-primary" type="submit">${active ? 'Save schedule' : 'Save &amp; enable schedule'}</button>
        ${active ? '<button type="button" class="dm-btn" data-pause>Pause schedule</button>' : ''}</div></form>
        <p class="dm-muted">This browser runs sample jobs while the workspace is open and catches up once on reopening.</p>
      </section>`}</div>`;
    host.querySelector('.dm-schedule-view').addEventListener('dm-scheduled',() => {
      const latest = store.snapshot();
      const scheduled = latest.datasets.find(d => d.id === dataset.id)?.schedule;
      const job = latest.jobs.find(j => j.datasetId === dataset.id && j.trigger === 'Schedule');
      if (scheduled?.enabled) host.querySelector('[data-next-run]').textContent = display(scheduled.nextAt,settings(scheduled).zone);
      if (job) host.querySelector('[data-last-job]').textContent = job.id + ' · ' + job.status;
      if (host.querySelector('form')) preview();
    });
    const form = host.querySelector('form');
    if (!form) return;
    const fields = form.elements;
    const values = () => ({type:fields.type.value,frequency:fields.frequency.value,weekday:Number(fields.weekday.value),time:fields.time.value || p.time,zone:fields.zone.value});
    function preview() {
      const options = values();
      host.querySelector('[data-day]').hidden = options.frequency !== 'Weekly';
      host.querySelectorAll('[data-clock]').forEach(el => {el.hidden = options.frequency === 'Every minute';});
      fields.time.required = options.frequency !== 'Every minute';
      const output = host.querySelector('[data-next]');
      try {output.textContent = 'Next run with these settings · ' + display(next(options,new Date()),options.zone);}
      catch (e) {output.textContent = e.message;}
    }
    function update(enabled) {
      try {
        store.setSchedule(dataset.id,{...(enabled ? values() : p),enabled});
        render(host,{...ctx,dataset:store.snapshot().datasets.find(item => item.id === dataset.id)});
        const message = document.createElement('p');
        message.className = 'dm-notice';
        message.setAttribute('role','status');
        message.textContent = enabled ? 'Schedule saved and enabled.' : 'Schedule paused.';
        host.prepend(message);
      } catch(e) {host.querySelector('[data-next]').textContent = e.message;}
    }
    form.oninput = preview;
    form.onsubmit = e => {e.preventDefault();update(true);};
    const pause = host.querySelector('[data-pause]');
    if (pause) pause.onclick = () => update(false);
    preview();
  }
  window.DataScheduleView = {render};
})();
