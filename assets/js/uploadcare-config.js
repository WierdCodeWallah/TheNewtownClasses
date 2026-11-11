/* Public upload settings shared by the browser and Netlify functions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCUploadcare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const publicKey = '1c7d49b03c2e34052dc8';
  // Uploadcare's official cname-prefix algorithm: SHA256(publicKey), base36,
  // first ten characters. Recalculate this host if changing the project key.
  const cdnHost = '32zbpzustr.ucarecd.net';
  const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  function parse(value) {
    try {
      if (typeof value !== 'string' || /[\s"'<>\\]/.test(value)) return null;
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !['ucarecdn.com', cdnHost].includes(url.hostname)) return null;
      const id = url.pathname.split('/')[1];
      return idPattern.test(id) && url.pathname.startsWith('/' + id + '/') ? { url, id: id.toLowerCase() } : null;
    } catch (_) { return null; }
  }
  function fileUrl(id) {
    if (!idPattern.test(id || '')) throw new Error('Invalid uploaded file ID.');
    return 'https://' + cdnHost + '/' + id + '/';
  }
  function deliveryUrl(value) {
    const parsed = parse(value);
    if (!parsed) return value;
    parsed.url.hostname = cdnHost;
    return parsed.url.href;
  }
  return { publicKey, cdnHost, fileUrl, deliveryUrl, isFileUrl: value => !!parse(value), uuid: value => parse(value)?.id };
});
