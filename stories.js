'use strict';

// Homepage excerpts contain only selected observations. Full runs stay in the viewer.
(() => {
  const root = document.querySelector('#story-showcase');
  if (!root) return;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let stories = [], selected = 0, moment = 0;
  const set = (selector, text) => { root.querySelector(selector).textContent = text; };
  function renderMoment() {
    const story = stories[selected], item = story.moments[moment];
    root.dataset.scene = story.id;
    root.dataset.step = item.step;
    root.querySelectorAll('.story-moment').forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === moment));
    });
    set('.story-mode', item.mode === 'gui' ? 'GUI action' : 'Native interface');
    set('.story-step', `Recorded step ${item.step}`);
    set('.story-caption', item.caption);
    const stage = root.querySelector('.story-evidence'); stage.replaceChildren();
    stage.classList.toggle('has-record', Boolean(item.record));
    if (item.record) {
      const record = node('div', 'story-record');
      record.append(node('p', 'record-origin', item.record.subtitle), node('h4', '', item.record.title));
      const dl = node('dl');
      for (const [label, value] of item.record.rows) {
        const row = node('div'); row.append(node('dt', '', label), node('dd', '', value)); dl.append(row);
      }
      record.append(dl, node('p', 'record-reference', `Record: ${item.record.reference}`));
      const tool = node('p', 'record-tool'); tool.append(node('code', '', item.record.tool)); record.append(tool);
      stage.append(record);
      set('.story-capture', 'Original tool return · native calls can update app state without navigating the foreground.');
    } else if (item.image) {
      const previous = story.moments.slice(0, moment).findLast(item => item.image);
      if (previous?.image) {
        const figure = node('figure', 'story-earlier');
        const earlier = node('img'); earlier.src = previous.image; earlier.alt = `${story.title}: ${previous.label}. Earlier selected step ${previous.step}.`;
        earlier.width = 1080; earlier.height = 2400;
        const link = node('a', 'story-phone'); link.href = previous.href; link.append(earlier);
        figure.append(link, node('figcaption', '', `Earlier selected step ${previous.step}`)); stage.append(figure);
      }
      const figure = node('figure', 'story-current');
      const link = node('a', 'story-phone'); link.href = item.href;
      link.setAttribute('aria-label', `Inspect ${story.title}: ${item.label}`);
      const image = node('img'); image.src = item.image; image.alt = `${story.title}: ${item.label}. Phone screen captured from the saved actions.`;
      image.width = 1080; image.height = 2400;
      link.append(image); figure.append(link, node('figcaption', '', `Selected step ${item.step}`)); stage.append(figure);
      set('.story-capture', item.capture_kind?.includes('replay') ? 'Phone screen captured by replaying saved actions. Decisions and scores come from the original run.' : 'Phone screenshot from the original run.');
    } else {
      stage.append(node('p', 'story-unavailable', 'The selected phone capture could not be loaded. The full action record is available in the viewer.'));
      set('.story-capture', 'Original action records are available in the comparison.');
    }
    for (const link of root.querySelectorAll('.story-open')) link.href = item.href;
    root.querySelector('.story-all').href = `demo/#scene=${story.id}`;
    set('.story-all', `All ${story.count} tasks and outcomes ↗`);
    set('.story-progress', `${moment + 1} / ${story.moments.length} selected moments`);
    root.querySelector('.story-prev').disabled = moment === 0;
    root.querySelector('.story-next').disabled = moment === story.moments.length - 1;
  }
  function select(index) {
    selected = index; moment = stories[index].default;
    const story = stories[index];
    root.querySelectorAll('[role=tab]').forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1;
    });
    root.querySelector('[role=tabpanel]').setAttribute('aria-labelledby', `story-tab-${story.id}`);
    set('.story-apps', story.apps); set('.story-heading', story.heading);
    set('.story-request', story.request); set('.story-task', `Featured delegation · ${story.task}`);
    const moments = root.querySelector('.story-moments'); moments.replaceChildren();
    story.moments.forEach((item, i) => {
      const button = node('button', 'story-moment'); button.type = 'button';
      button.append(node('span', 'moment-number', String(i + 1).padStart(2, '0')), node('span', '', item.label));
      button.addEventListener('click', () => { moment = i; renderMoment(); });
      moments.append(button);
    });
    renderMoment();
  }
  root.querySelector('.story-prev').addEventListener('click', () => { if (moment > 0) { moment--; renderMoment(); } });
  root.querySelector('.story-next').addEventListener('click', () => { if (moment < stories[selected].moments.length - 1) { moment++; renderMoment(); } });
  fetch('data/stories.json').then(response => {
    if (!response.ok) throw new Error('Story data unavailable');
    return response.json();
  }).then(data => {
    stories = data.stories;
    const tabs = root.querySelector('.story-tabs'); tabs.replaceChildren();
    stories.forEach((story, index) => {
      const tab = node('button', 'story-tab', story.title); tab.type = 'button';
      tab.id = `story-tab-${story.id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'story-panel');
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? stories.length - 1 :
          (index + (event.key === 'ArrowRight' ? 1 : -1) + stories.length) % stories.length;
        select(next); tabs.children[next].focus();
      });
      tabs.append(tab);
    });
    select(0); root.dataset.ready = 'true';
    root.querySelector('.story-tabs').hidden = false;
    root.querySelector('.story-controls').hidden = false;
  }).catch(() => {
    root.querySelector('.story-controls').hidden = true;
    root.querySelector('.story-moments').hidden = true;
    root.querySelector('.story-tabs').hidden = true;
    root.querySelector('.story-fallback').hidden = false;
  });
})();
