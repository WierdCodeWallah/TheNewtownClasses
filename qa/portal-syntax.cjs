const fs = require('node:fs');
const vm = require('node:vm');
let count = 0;
for (const file of ['index.html', 'student-dashboard.html', 'teacher-dashboard.html', 'admin-panel.html', 'student-login.html', 'teacher-login.html', 'admin-login.html']) {
  const html = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!match[2].trim() || match[1].includes('application/ld+json')) continue;
    const options = {filename:file};
    if (match[1].includes('module')) new vm.SourceTextModule(match[2], options);
    else new vm.Script(match[2], options);
    count++;
  }
}
for (const file of ['assets/js/enquiry-ui.js','assets/js/portal-shell.js','assets/js/portal-workspaces.js','assets/js/portal-atmosphere.js']) {
  new vm.Script(fs.readFileSync(file,'utf8'), {filename:file}); count++;
}
for (const file of ['assets/js/enquiry-form.js', 'assets/js/admin-enquiries.js']) {
  new vm.SourceTextModule(fs.readFileSync(file,'utf8'), {filename:file}); count++;
}
console.log(`${count} portal scripts parsed successfully.`);
