import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Called only after the panel verifies the signed-in admin. Notifications are
// derived from the saved inquiry, so a separate notification write cannot fail.
export function startAdminEnquiries(db, adminUid) {
  const $ = id => document.getElementById(id);
  const statuses = ['New', 'Contacted', 'Closed'];
  const dateFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  let rows = [], page = 0, unsubscribe, knownIds = null, stopped = false;
  const pageSize = 20;
  const dateOf = value => {
    const date = value?.toDate ? value.toDate() : new Date(value || '');
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const text = (tag, value, className) => {
    const el = document.createElement(tag); el.textContent = value;
    if (className) el.className = className;
    return el;
  };
  function openInbox() { window.switchAdminTab('enquiries'); $('inquirySearch').focus(); }
  $('inquiryNoticeOpen').onclick = openInbox;
  function render() {
    const search = $('inquirySearch').value.trim().toLowerCase(), status = $('inquiryFilter').value;
    const filtered = rows.filter(row => (!status || row.status === status) &&
      [row.name, row.phone, row.email, row.course, row.currentClass, row.message, row.googleName, row.id].some(value => String(value || '').toLowerCase().includes(search)));
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    $('inquiryList').replaceChildren();
    $('inquiryCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'inquiry' : 'inquiries'}${search || status ? ' matching your filters' : ' received'}`;
    if (!filtered.length) $('inquiryList').append(text('p', rows.length ? 'No inquiries match your search.' : 'No inquiries yet. New website submissions will appear here automatically.', 'inquiry-empty'));
    // Compact rows: name, course · class, time and the follow-up status; tap a
    // row to see contact buttons, the message and the details.
    filtered.slice(page * pageSize, (page + 1) * pageSize).forEach(row => {
      const st = statuses.includes(row.status) ? row.status : 'New';
      const card = document.createElement('article'); card.className = 'inquiry-item' + (st === 'New' ? ' is-new' : '');
      const top = document.createElement('div'); top.className = 'inquiry-row';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'inquiry-open'; open.setAttribute('aria-expanded', 'false');
      const moreId = 'inq-' + row.id.replace(/[^A-Za-z0-9_-]/g, ''); open.setAttribute('aria-controls', moreId);
      const initials = String(row.name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
      const main = document.createElement('span'); main.className = 'inquiry-main';
      main.append(text('b', row.name || 'Unnamed student'), text('small', [row.course, row.currentClass].filter(Boolean).join(' · ') || 'No course chosen'));
      const date = dateOf(row.createdAt);
      const time = text('time', date ? `${dateFormat.format(date)} IST` : 'Submission date unavailable');
      if (date) time.dateTime = date.toISOString();
      main.append(time);
      open.append(text('span', initials, 'inquiry-av'), main, text('span', '', 'inquiry-chev'));
      const select = document.createElement('select'); select.className = 'inquiry-status-select is-' + st.toLowerCase();
      select.setAttribute('aria-label', `Follow-up status for ${row.name || 'student'}`);
      statuses.forEach(status => { const option = text('option', status); option.value = status; select.append(option); });
      select.value = st;
      select.onchange = async () => {
        select.disabled = true; $('inquiryError').textContent = '';
        try { await updateDoc(doc(db, 'enquiries', row.id), { status: select.value, updatedAt: serverTimestamp(), updatedBy: adminUid }); select.className = 'inquiry-status-select is-' + select.value.toLowerCase(); }
        catch (_) { select.value = row.status || 'New'; $('inquiryError').textContent = 'Could not update the inquiry. Please try again.'; }
        finally { select.disabled = false; }
      };
      top.append(open, select); card.append(top);

      const more = document.createElement('div'); more.className = 'inquiry-more'; more.id = moreId; more.hidden = true;
      const actions = document.createElement('div'); actions.className = 'inquiry-actions';
      const action = (label, href, cls) => { const a = text('a', label, 'inquiry-act ' + cls); a.href = href; if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } actions.append(a); };
      if (/^[6-9]\d{9}$/.test(row.phone || '')) { action('Call ' + row.phone.replace(/(\d{5})(\d{5})/, '$1 $2'), `tel:+91${row.phone}`, 'call'); action('WhatsApp', `https://wa.me/91${row.phone}`, 'wa'); }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email || '')) action('Email', `mailto:${encodeURIComponent(row.email)}`, 'mail');
      if (actions.children.length) more.append(actions);
      const query = document.createElement('div'); query.className = 'inquiry-query';
      query.append(text('strong', 'Message'), text('p', row.message || 'No additional message.')); more.append(query);
      const details = document.createElement('dl'); details.className = 'inquiry-details';
      const detail = (label, value) => { if (!value) return; const g = document.createElement('div'); g.append(text('dt', label), text('dd', value)); details.append(g); };
      detail('Mobile', row.phone); detail(row.uid ? 'Google email' : 'Email (legacy submission)', row.email);
      detail('Google account name', row.googleName); detail('Source', row.source);
      if (details.children.length) more.append(details);
      const meta = text('small', `Reference: ${row.id}${row.uid ? ` · Account ID: ${row.uid}` : ''}`, 'inquiry-meta');
      const updated = dateOf(row.updatedAt);
      if (updated) meta.append(text('span', ` · Last updated ${dateFormat.format(updated)} IST${row.updatedBy ? ` by ${row.updatedBy}` : ''}`));
      more.append(meta); card.append(more);
      open.onclick = () => { const show = more.hidden; more.hidden = !show; open.setAttribute('aria-expanded', String(show)); card.classList.toggle('is-open', show); };
      $('inquiryList').append(card);
    });
    $('inquiryPagination').hidden = filtered.length <= pageSize;
    $('inquiryPage').textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(filtered.length / pageSize))}`;
    $('inquiryPrev').disabled = page === 0; $('inquiryNext').disabled = (page + 1) * pageSize >= filtered.length;
  }
  $('inquirySearch').oninput = $('inquiryFilter').onchange = () => { page = 0; render(); };
  $('inquiryPrev').onclick = () => { page--; render(); $('inquirySearch').focus(); };
  $('inquiryNext').onclick = () => { page++; render(); $('inquirySearch').focus(); };
  function subscribe() {
    unsubscribe?.(); $('inquiryError').textContent = ''; $('inquiryConnection').textContent = 'Connecting…';
    // Legacy documents use ISO strings; new ones use server timestamps. Sort
    // together in the browser so older inquiries remain visible in date order.
    unsubscribe = onSnapshot(collection(db, 'enquiries'), { includeMetadataChanges: true }, snapshot => {
      if (stopped) return;
      rows = snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
      rows.sort((a, b) => (dateOf(b.createdAt)?.getTime() || 0) - (dateOf(a.createdAt)?.getTime() || 0) || a.id.localeCompare(b.id));
      const count = rows.filter(row => !row.status || row.status === 'New').length;
      $('inquiryBadge').textContent = String(count); $('inquiryBadge').hidden = !count;
      $('inquiryNotice').hidden = !count;
      $('inquiryNoticeText').textContent = `${count} new ${count === 1 ? 'inquiry needs' : 'inquiries need'} your attention`;
      $('inquiryConnection').textContent = snapshot.metadata.fromCache ? 'Waiting for connection · showing cached inquiries' : 'Live · dates in IST';
      if (!snapshot.metadata.fromCache) {
        const added = knownIds && rows.filter(row => !knownIds.has(row.id) && row.status === 'New');
        if (added?.length) $('inquiryAnnouncement').textContent = `${added.length} new website ${added.length === 1 ? 'inquiry' : 'inquiries'} received. Open Inquiries to review.`;
        else if (!knownIds && count) $('inquiryAnnouncement').textContent = `${count} new ${count === 1 ? 'inquiry' : 'inquiries'} waiting in your inbox.`;
        knownIds = new Set(rows.map(row => row.id));
      }
      render();
    }, () => {
      $('inquiryConnection').textContent = 'Inbox disconnected';
      $('inquiryError').textContent = 'Could not load inquiries. Check your connection and admin access, then retry.';
    });
  }
  $('inquiryRetry').onclick = subscribe;
  subscribe();
  return () => { stopped = true; unsubscribe?.(); rows = []; $('inquiryList').replaceChildren(); $('inquiryNotice').hidden = true; $('inquiryBadge').hidden = true; };
}
