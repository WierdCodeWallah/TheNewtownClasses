// Local configuration branches; no real credentials, uploads or cloud writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const uc = require('../assets/js/uploadcare-config');
async function main() {
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  const cases = ['localhost', '127.0.0.1', '[::1]', 'thenewtownclasses.com', 'localhost.example.com'].map(hostname => [hostname, false]).concat(loopback.map(hostname => [hostname, true]));
  for (const [hostname, optedIn] of cases) {
    const store = optedIn ? { getItem: key => key === 'ntcAppCheckDebug' ? '1' : null } : { getItem: () => null };
    const context = vm.createContext({ location: { hostname }, localStorage: store, console: { info() {}, warn() {} } });
    let initialized = false;
    const sdk = new vm.SyntheticModule(['initializeAppCheck', 'ReCaptchaV3Provider'], function () {
      this.setExport('initializeAppCheck', () => { initialized = true; return {}; });
      this.setExport('ReCaptchaV3Provider', function () {});
    }, { context });
    await sdk.link(() => {}); await sdk.evaluate();
    const mod = new vm.SourceTextModule(fs.readFileSync('assets/js/firebase-config.js', 'utf8'), {
      context, importModuleDynamically: async () => sdk
    });
    await mod.link(() => {}); await mod.evaluate(); await mod.namespace.initAppCheck({});
    const local = loopback.includes(hostname);
    // Deployed hosts always use reCAPTCHA; loopback skips App Check unless opted in.
    assert.equal(initialized, !local || optedIn, `${hostname} optedIn=${optedIn}: App Check initialized`);
    assert.equal(context.FIREBASE_APPCHECK_DEBUG_TOKEN, local && optedIn ? true : undefined);
  }
  for (const [file, name] of [['student-dashboard.html', 'otsApi'], ['teacher-dashboard.html', 'otApi']]) {
    const source = fs.readFileSync(file, 'utf8');
    const start = source.match(new RegExp('^( *)async function ' + name + '\\(body\\) \\{', 'm'));
    const end = source.indexOf('\n' + start[1] + '}', start.index);
    const fn = source.slice(start.index, end + start[1].length + 2);
    const context = vm.createContext({ user: { getIdToken: async () => 'fixture' }, location: { hostname: 'localhost' } });
    vm.runInContext(fn, context);
    context.fetch = async () => ({ ok: false, status: 405, json: async () => { throw new Error('HTML'); } });
    await assert.rejects(context[name]({}), /Netlify Dev/);
    context.location.hostname = 'thenewtownclasses.com';
    context.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Not your test.' }) });
    await assert.rejects(context[name]({}), /Not your test/);
  }
  const expectedPrefix = BigInt('0x' + crypto.createHash('sha256').update(uc.publicKey).digest('hex')).toString(36).slice(0, 10);
  assert.equal(uc.cdnHost, expectedPrefix + '.ucarecd.net');
  const id = '11111111-1111-1111-1111-111111111111', old = 'https://ucarecdn.com/' + id + '/';
  assert.equal(uc.deliveryUrl(old), uc.fileUrl(id));
  assert.equal(uc.uuid(old), uc.uuid(uc.fileUrl(id)));
  assert.equal(uc.deliveryUrl(old + '-/inline/yes/name.pdf'), uc.fileUrl(id) + '-/inline/yes/name.pdf');
  for (const bad of ['https://evil.example/' + id + '/', 'https://ucarecdn.com.evil.example/' + id + '/', 'https://user:pass@ucarecdn.com/' + id + '/', 'http://ucarecdn.com/' + id + '/', 'https://ucarecdn.com/not-a-file/', 'https://other.ucarecd.net/' + id + '/']) assert.equal(uc.isFileUrl(bad), false);
  const downloadContext = vm.createContext({ window: {}, NTCUploadcare: uc, TextDecoder, Blob });
  downloadContext.window.NTCUploadcare = uc;
  vm.runInContext(fs.readFileSync('assets/js/offline-files.js', 'utf8'), downloadContext);
  downloadContext.fetch = async url => {
    assert.equal(url, uc.fileUrl(id));
    return { ok: false, status: 403 };
  };
  await assert.rejects(downloadContext.window.NTCOfflineFiles.downloadPdf(old, 'script.pdf'), /HTTP 403/);
  downloadContext.fetch = async () => ({ ok: true, blob: async () => new Blob(['<html>CDN error</html>']) });
  await assert.rejects(downloadContext.window.NTCOfflineFiles.downloadPdf(old, 'script.pdf'), /error page instead of a PDF/);
  console.log('Local App Check, backend error handling, and CDN validation checks passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
