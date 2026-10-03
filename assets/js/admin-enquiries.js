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
    filtered.slice(page * pageSize, (page + 1) * pageSize).forEach(row => {
      const card = document.createElement('article'); card.className = 'inquiry-item';
      const header = document.createElement('div'); header.className = 'inquiry-item-header';
      const heading = document.createElement('div');
      heading.append(text('h3', row.name || 'Unnamed student'));
      const date = dateOf(row.createdAt);
      const time = text('time', date ? `${dateFormat.format(date)} IST` : 'Submission date unavailable');
      if (date) time.dateTime = date.toISOString();
      heading.append(time);
      header.append(heading, text('span', row.status || 'New', `inquiry-status inquiry-status-${statuses.includes(row.status) ? row.status.toLowerCase() : 'new'}`));
      card.append(header);
      const details = document.createElement('dl'); details.className = 'inquiry-details';
      const detail = (label, value, link) => {
        const group = document.createElement('div'), description = text('dd', link ? '' : value || 'Not provided');
        if (link) { const anchor = text('a', value); anchor.href = link; description.append(anchor); }
        group.append(text('dt', label), description); details.append(group);
      };
      detail('Mobile', row.phone, /^[6-9]\d{9}$/.test(row.phone) ? `tel:+91${row.phone}` : null);
      detail(row.uid ? 'Google email' : 'Email (legacy submission)', row.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email || '') ? `mailto:${encodeURIComponent(row.email)}` : null);
      detail('Course', row.course); detail('Current class', row.currentClass);
      detail('Google account name', row.googleName); detail('Source', row.source);
      card.append(details);
      const query = document.createElement('div'); query.className = 'inquiry-query';
      query.append(text('strong', 'Message'), text('p', row.message || 'No additional message.')); card.append(query);
      const footer = document.createElement('div'); footer.className = 'inquiry-item-footer';
      const label = text('label', 'Follow-up status');
      const select = document.createElement('select'); select.setAttribute('aria-label', `Follow-up status for ${row.name || 'student'}`);
      statuses.forEach(status => { const option = text('option', status); option.value = status; select.append(option); });
      select.value = statuses.includes(row.status) ? row.status : 'New';
      select.onchange = async () => {
        select.disabled = true; $('inquiryError').textContent = '';
        try { await updateDoc(doc(db, 'enquiries', row.id), { status: select.value, updatedAt: serverTimestamp(), updatedBy: adminUid }); }
        catch (_) { select.value = row.status || 'New'; $('inquiryError').textContent = 'Could not update the inquiry. Please try again.'; }
        finally { select.disabled = false; }
      };
      label.append(select); footer.append(label);
      const meta = text('small', `Reference: ${row.id}${row.uid ? ` · Account ID: ${row.uid}` : ''}`);
      const updated = dateOf(row.updatedAt);
      if (updated) meta.append(text('span', `Last updated: ${dateFormat.format(updated)} IST${row.updatedBy ? ` · By: ${row.updatedBy}` : ''}`));
      footer.append(meta); card.append(footer); $('inquiryList').append(card);
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
