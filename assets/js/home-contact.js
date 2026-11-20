// "Open now / Closed" badge on the homepage contact card, from the centre's
// hours in India time: Tue–Fri 5–8 PM, Sat 11 AM–5 PM, Sun & Mon closed.
(function () {
  const el = document.getElementById('ctOpen');
  if (!el) return;
  const HOURS = { 2: [17, 20], 3: [17, 20], 4: [17, 20], 5: [17, 20], 6: [11, 17] };   // day → [open, close] hour
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const label = h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  function update() {
    let day, mins;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
      const get = t => (parts.find(p => p.type === t) || {}).value;
      day = DAY.indexOf(get('weekday')); mins = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
    } catch (_) { return; }
    if (day < 0 || isNaN(mins)) return;
    const today = HOURS[day];
    if (today && mins >= today[0] * 60 && mins < today[1] * 60) {
      el.textContent = 'Open now · till ' + label(today[1]); el.className = 'ct-open is-open';
    } else {
      let d = day, first = true;
      for (let i = 0; i < 7; i++, first = false) {
        const h = HOURS[d];
        if (h && (!first || mins < h[0] * 60)) {
          el.textContent = 'Closed · opens ' + (first ? 'today' : i === 1 ? 'tomorrow' : DAY[d]) + ' ' + label(h[0]);
          break;
        }
        d = (d + 1) % 7;
      }
      el.className = 'ct-open';
    }
    el.hidden = false;
  }
  update();
  setInterval(update, 60000);
})();
