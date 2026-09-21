const form = document.getElementById('search-form');
const input = document.getElementById('roll-input');
const hint = document.getElementById('form-hint');
const resultsEl = document.getElementById('results');
const emptyState = document.getElementById('empty-state');
const cardTpl = document.getElementById('tpl-session-card');

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginRoll = document.getElementById('login-roll');
const loginHint = document.getElementById('login-hint');
const accountBadge = document.getElementById('account-badge');
const switchAccountBtn = document.getElementById('switch-account');

const roomCache = new Map(); // room_key -> room data (avoid refetching)
let lookupInProgress = false;

const ADMIN_EMAIL = 'abhishek.2428cseai17@kiet.edu';
const adminLink = document.getElementById('admin-link');

function isKietEmail(email) {
  return /^[^\s@]+@kiet\.edu$/i.test(email.trim());
}

async function doLogin(email, rollNo) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, rollNo }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Login failed.');
  }
  return res.json();
}

function showApp(email, rollNo) {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  accountBadge.textContent = email;
  adminLink.hidden = email.toLowerCase() !== ADMIN_EMAIL;
  if (rollNo) {
    input.value = rollNo;
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim().toLowerCase();
  const rollNo = loginRoll.value.trim();
  if (!isKietEmail(email)) {
    loginHint.textContent = 'Please use your official @kiet.edu email address.';
    loginHint.className = 'form-hint error';
    return;
  }
  if (!rollNo) {
    loginHint.textContent = 'Please enter your roll number.';
    loginHint.className = 'form-hint error';
    return;
  }
  loginHint.textContent = 'Signing you in…';
  loginHint.className = 'form-hint loading';
  try {
    await doLogin(email, rollNo);
    localStorage.setItem('kiet_email', email);
    localStorage.setItem('kiet_roll', rollNo);
    loginHint.textContent = '';
    showApp(email, rollNo);
    lookupSeat(rollNo);
  } catch (err) {
    loginHint.textContent = err.message || 'Could not sign in — please try again.';
    loginHint.className = 'form-hint error';
  }
});

switchAccountBtn.addEventListener('click', () => {
  localStorage.removeItem('kiet_email');
  localStorage.removeItem('kiet_roll');
  appScreen.hidden = true;
  loginScreen.hidden = false;
  loginEmail.value = '';
  loginRoll.value = '';
  resultsEl.hidden = true;
  emptyState.removeAttribute('data-hidden');
});

// On load: skip straight to the app if already signed in on this device.
(function initAuth() {
  const savedEmail = localStorage.getItem('kiet_email');
  const savedRoll = localStorage.getItem('kiet_roll');
  if (savedEmail && isKietEmail(savedEmail)) {
    showApp(savedEmail, savedRoll);
    if (savedRoll) lookupSeat(savedRoll);
  }
})();

function setHint(text, cls) {
  hint.textContent = text || '';
  hint.className = 'form-hint' + (cls ? ' ' + cls : '');
}

function fmtDate(d) {
  const [dd, mm, yyyy] = d.split('-').map(Number);
  const dt = new Date(yyyy, mm - 1, dd);
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

async function fetchRoom(roomKey) {
  if (roomCache.has(roomKey)) return roomCache.get(roomKey);
  const res = await fetch(`/api/room/${encodeURIComponent(roomKey)}`);
  if (!res.ok) throw new Error('room fetch failed');
  const data = await res.json();
  roomCache.set(roomKey, data);
  return data;
}

function renderDescTable(tbody, roomDescription) {
  tbody.innerHTML = '';
  const dash = (v) => (v === null || v === undefined || v === '') ? '—' : v;
  (roomDescription || []).forEach((d) => {
    const tr = document.createElement('tr');
    const rollRange = (d.roll_start && d.roll_end) ? `${d.roll_start}&ndash;${d.roll_end}` : '—';
    tr.innerHTML = `
      <td>${dash(d.branch)}</td>
      <td>${dash(d.sem)}</td>
      <td>${dash(d.sec)}</td>
      <td class="mono">${rollRange}</td>
      <td>${dash(d.seat_count)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSeatTable(container, roomData, myRoll) {
  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'seat-grid';
  const tbody = document.createElement('tbody');

  roomData.grid.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell, ci) => {
      const td = document.createElement('td');
      td.className = 'seat-cell';
      if (!cell) {
        td.classList.add('seat-empty');
      } else {
        td.classList.add('seat-filled');
        if (cell.roll === myRoll) td.classList.add('seat-mine');
        const rollSpan = document.createElement('div');
        rollSpan.className = 'seat-roll';
        rollSpan.textContent = cell.roll;
        const secSpan = document.createElement('div');
        secSpan.className = 'seat-sec';
        secSpan.textContent = `${cell.branch || ''} ${cell.sec || ''}`.trim();
        td.appendChild(rollSpan);
        td.appendChild(secSpan);
      }
      tr.appendChild(td);
      // clear visible partition after every bench pair (not the last)
      if (ci % 2 === 1 && ci !== row.length - 1) {
        const gap = document.createElement('td');
        gap.className = 'seat-gap';
        gap.innerHTML = '<div class="seat-gap-bar"></div>';
        tr.appendChild(gap);
      }
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function buildSessionCard(session, status, myRoll) {
  const node = cardTpl.content.cloneNode(true);
  const card = node.querySelector('.session-card');
  if (status === 'next') card.classList.add('is-next');
  if (!session.seating_published) card.classList.add('not-published');

  const tag = node.querySelector('.tag-status');
  tag.classList.add(status);
  tag.textContent = status === 'next' ? 'NEXT EXAM' : status === 'upcoming' ? 'UPCOMING' : 'PAST';

  node.querySelector('.session-date').textContent = fmtDate(session.date);

  const subjectVal = node.querySelector('.exam-subject-value');
  if (session.exam_subject) {
    subjectVal.textContent = session.exam_subject;
  } else {
    node.querySelector('.exam-subject-line').hidden = true;
  }

  if (!session.seating_published) {
    // Unpublished exam: show the subject/date only, hide all room/seat
    // fields and the room-details expander entirely.
    node.querySelector('.session-main').hidden = true;
    node.querySelector('.room-details').hidden = true;
    return node;
  }

  node.querySelector('.room-value').textContent = session.room || '—';
  node.querySelector('.meta-shift').textContent = session.shift ? `${session.shift}${session.timing ? ' (' + session.timing + ')' : ''}` : '—';
  node.querySelector('.meta-building').textContent = session.building ? `${session.building} block${session.floor ? ', ' + session.floor : ''}` : '—';
  node.querySelector('.meta-branch').textContent = `${session.branch || '—'} · Sem ${session.sem || '—'} · Sec ${session.section || '—'}`;
  node.querySelector('.meta-seat').textContent = session.seat_row
    ? `Row ${session.seat_row}, Bench ${session.bench_no} (Seat ${session.bench_position})`
    : (session.bench_no ? `Seat ${session.bench_no}` : '—');

  if (session.proctor) {
    const proctorRow = node.querySelector('.meta-proctor-row');
    proctorRow.hidden = false;
    node.querySelector('.meta-proctor').textContent = session.proctor;
  }

  if (session.ssed_tip) {
    const tip = document.createElement('p');
    tip.className = 'ssed-tip';
    tip.textContent = '⚠ ' + session.ssed_tip;
    node.querySelector('.session-main').after(tip);
  }

  node.querySelector('.stat-total').textContent = session.room_total_students ?? '—';
  node.querySelector('.stat-same').textContent = session.same_branch_section_count ?? '—';

  renderDescTable(node.querySelector('.desc-tbody'), session.room_description);

  const details = node.querySelector('.room-details');
  if (!session.room_key) {
    details.hidden = true;
    return node;
  }
  const seatTableEl = node.querySelector('.seat-table');
  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (details.open && !loaded) {
      loaded = true;
      seatTableEl.innerHTML = '<p class="loading-msg">Loading seating table…</p>';
      try {
        const roomData = await fetchRoom(session.room_key);
        renderSeatTable(seatTableEl, roomData, myRoll);
      } catch (e) {
        seatTableEl.innerHTML = '<p class="loading-msg">Could not load the seating table.</p>';
      }
    }
  });

  return node;
}

function fmtDateShort(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('-').map(Number);
  const dt = new Date(yyyy, mm - 1, dd);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function renderDatesheetCards(cards) {
  if (!cards || cards.length === 0) return;

  const section = document.createElement('div');
  section.className = 'datesheet-section';
  section.innerHTML = `<h2 class="section-heading">Your full datesheet</h2><p class="section-sub">Based on your branch — shown whether or not seating is published yet.</p>`;

  const grid = document.createElement('div');
  grid.className = 'datesheet-grid';
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'date-card' + (!c.exam_subject ? ' no-exam' : '');
    card.innerHTML = `
      <span class="dc-date">${fmtDateShort(c.date)}</span>
      <span class="dc-subject">${c.exam_subject || 'No exam scheduled'}</span>
      <span class="dc-shift${c.shift ? '' : ' dash'}">${c.shift || '—'}</span>
    `;
    grid.appendChild(card);
  }
  section.appendChild(grid);
  resultsEl.appendChild(section);
}

function render(data) {
  resultsEl.innerHTML = '';

  const profile = document.createElement('div');
  profile.className = 'profile-strip';
  const subjectBit = data.next_session && data.next_session.exam_subject
    ? `<span class="profile-subject">${data.next_session.exam_subject}</span>`
    : '';
  profile.innerHTML = `
    <span class="profile-roll">${data.roll_no}</span>
    ${subjectBit}
    <span class="profile-tag">${data.branch || '—'} &middot; Sem ${data.sem || '—'} &middot; Sec ${data.section || '—'}</span>
  `;
  resultsEl.appendChild(profile);

  renderDatesheetCards(data.datesheet_cards);

  if (data.next_session) {
    const heading = document.createElement('div');
    heading.innerHTML = `<h2 class="section-heading">Your next exam</h2><p class="section-sub">Nearest upcoming session in the dataset, based on today's date.</p>`;
    resultsEl.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'session-list';
    list.appendChild(buildSessionCard(data.next_session, 'next', data.roll_no));
    resultsEl.appendChild(list);
  }

  if (data.upcoming_sessions && data.upcoming_sessions.length) {
    const heading = document.createElement('div');
    heading.innerHTML = `<h2 class="section-heading">Other upcoming sessions</h2>`;
    resultsEl.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'session-list';
    data.upcoming_sessions.forEach((s) => list.appendChild(buildSessionCard(s, 'upcoming', data.roll_no)));
    resultsEl.appendChild(list);
  }

  if (data.past_sessions && data.past_sessions.length) {
    const details = document.createElement('details');
    details.style.marginTop = '10px';
    const summary = document.createElement('summary');
    summary.textContent = `Past sessions (${data.past_sessions.length})`;
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = '600';
    summary.style.color = 'var(--ink-soft)';
    details.appendChild(summary);
    const list = document.createElement('div');
    list.className = 'session-list';
    list.style.marginTop = '14px';
    data.past_sessions.forEach((s) => list.appendChild(buildSessionCard(s, 'past', data.roll_no)));
    details.appendChild(list);
    resultsEl.appendChild(details);
  }

  if (!data.next_session && !(data.upcoming_sessions || []).length && !(data.past_sessions || []).length) {
    resultsEl.innerHTML += `<p>No sessions found for this roll number.</p>`;
  }

  resultsEl.hidden = false;
  emptyState.setAttribute('data-hidden', 'true');
}

async function lookupSeat(roll) {
  if (lookupInProgress) return;
  if (!roll) {
    setHint('Please enter a roll number.', 'error');
    return;
  }
  lookupInProgress = true;
  setHint('Looking up your seating…', 'loading');
  resultsEl.hidden = true;

  try {
    const res = await fetch(`/api/lookup/${encodeURIComponent(roll)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setHint(err.error || 'No record found for this roll number.', 'error');
      return;
    }
    const data = await res.json();
    setHint('');
    render(data);
  } catch (err) {
    setHint('Something went wrong reaching the server. Please try again.', 'error');
  } finally {
    lookupInProgress = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  lookupSeat(input.value.trim());
});
