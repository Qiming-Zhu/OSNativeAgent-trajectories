'use strict';

// Keep existing trajectory deep links usable after adding the paper homepage.
if (new URLSearchParams(location.hash.slice(1)).has('scene')) {
  location.replace(new URL(`demo/${location.hash}`, location.href));
} else {
  const models = ['GPT-5.4', 'GPT-5.4-mini'];
  const systems = ['OS-native', 'MobileClaw', 'MobileWorld'];
  const tabs = [...document.querySelectorAll('[data-model]')];
  let results;
  let selected = models[0];
  const render = model => {
    selected = model;
    if (!results) return;
    const rows = systems.map(name => ({name, ...results.models[model][name]}));
    tabs.forEach(tab => {
      const active = tab.dataset.model === model;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    document.querySelector('#result-panel').setAttribute('aria-labelledby', tabs.find(tab => tab.dataset.model === model).id);
    document.querySelectorAll('.bar-row').forEach((row, i) => {
      row.querySelector('.bar').style.setProperty('--score', `${rows[i].success}%`);
      row.querySelector('.bar-value').textContent = `${rows[i].success.toFixed(1)}%`;
    });
    document.querySelector('.chart').setAttribute('aria-label', `${model} task success: ${rows.map(row => `${row.name} ${row.success}%`).join(', ')}`);
    const body = document.querySelector('#result-rows');
    body.replaceChildren(...rows.map(row => {
      const tr = document.createElement('tr');
      if (row.name === systems[0]) tr.className = 'native';
      [row.name, `${row.success.toFixed(1)}%`, row.calls_per_scenario.toFixed(2), row.reported_tokens_per_scenario, row.user_requests_per_scenario.toFixed(2)].forEach(value => {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      });
      return tr;
    }));
    document.querySelector('#success-gain').textContent = `+${(rows[0].success - rows[1].success).toFixed(1)} percentage points`;
    document.querySelector('#call-reduction').textContent = `${((1 - rows[0].calls_per_scenario / rows[1].calls_per_scenario) * 100).toFixed(1)}% fewer`;
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => render(tab.dataset.model));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus(); render(tabs[next].dataset.model);
    });
  });
  fetch('data/dynamicworld-results.json').then(response => {
    if (!response.ok) throw new Error(`Result data: HTTP ${response.status}`);
    return response.json();
  }).then(data => { results = data; render(selected); }).catch(() => {
    const error = document.querySelector('#result-error');
    error.hidden = false;
    error.textContent = 'The interactive result data could not load. The GPT-5.4 table above remains available; use the result-data link to inspect the source.';
    tabs.forEach(tab => { tab.disabled = true; });
  });
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const original = button.textContent;
    const value = document.getElementById(button.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(value); button.textContent = 'Copied'; }
    catch {
      const range = document.createRange(); range.selectNodeContents(document.getElementById(button.dataset.copy));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      button.textContent = 'Text selected';
    }
    setTimeout(() => { button.textContent = original; }, 2000);
  }));
}
