/* Real Firestore rules tests against a LOCAL emulator only.
   java -jar <firestore-emulator.jar> --host 127.0.0.1 --port 8187 \
     --project_id demo-enquiries --rules firestore.rules
   node qa/inquiry-rules.cjs
   Uses an isolated demo project and unsigned emulator-only auth tokens. */
const assert = require('node:assert/strict');
const project = 'demo-enquiries', host = 'http://127.0.0.1:8187';
const base = `projects/${project}/databases/(default)/documents`;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(uid, provider = 'google.com', verified = true) {
  const now = Math.floor(Date.now()/1000);
  return `${encode({alg:'none',typ:'JWT'})}.${encode({sub:uid,user_id:uid,iss:'https://securetoken.google.com/'+project,aud:project,iat:now,exp:now+3600,email:uid+'@example.test',email_verified:verified,firebase:{sign_in_provider:provider,identities:{}}})}.`;
}
const google = token('visitor'), admin = token('admin','password'), owner = token('owner','password');
const field = value => typeof value === 'boolean' ? {booleanValue:value} : {stringValue:value};
const fields = data => Object.fromEntries(Object.entries(data).map(([key,value])=>[key,field(value)]));
let checks = 0;
async function request(url, method, body, auth, expected) {
  const response = await fetch(host+url,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined});
  const result = await response.text();
  assert.equal(response.status,expected,`${method} ${url}: ${result}`); checks++;
  return result ? JSON.parse(result) : null;
}
const sample = {uid:'visitor',googleName:'Parent',name:'Student',phone:'9876543210',email:'visitor@example.test',course:'NEET Preparation',currentClass:'Class 11',message:'Please arrange a demo',status:'New',source:'Website'};
function create(id, data = sample, serverTime = true) {
  return {update:{name:base+'/enquiries/'+id,fields:fields({...data,...(!serverTime?{createdAt:'2026-01-01T00:00:00Z'}:{})})},...(serverTime?{updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}:{})};
}
async function commit(write, auth, expected) {return request(`/v1/projects/${project}/databases/(default)/documents:commit`,'POST',{writes:[write]},auth,expected);}
(async()=>{
  // Clear only this demo project's emulator data.
  await request(`/emulator/v1/projects/${project}/databases/(default)/documents`,'DELETE',null,null,200);
  await request('/v1/'+base+'/admins/admin','PATCH',{fields:fields({isAdmin:true})},'owner',200);
  await request('/v1/'+base+'/admins/owner','PATCH',{fields:fields({isOwner:true})},'owner',200);
  await commit(create('anonymous'),null,403);
  await commit(create('password'),token('visitor','password'),403);
  await commit(create('unverified'),token('visitor','google.com',false),403);
  await commit(create('spoof-uid',{...sample,uid:'someone-else'}),google,403);
  await commit(create('spoof-email',{...sample,email:'someone@example.test'}),google,403);
  await commit(create('client-date',sample,false),google,403);
  await commit(create('bad-phone',{...sample,phone:'1234'}),google,403);
  await commit(create('bad-course',{...sample,course:'Injected course'}),google,403);
  await commit(create('bad-class',{...sample,currentClass:'Unknown'}),google,403);
  await commit(create('bad-status',{...sample,status:'Closed'}),google,403);
  await commit(create('extra-field',{...sample,isAdmin:true}),google,403);
  await commit(create('long-message',{...sample,message:'x'.repeat(2001)}),google,403);
  await commit(create('valid'),google,200);
  const saved=await request('/v1/'+base+'/enquiries/valid','GET',null,admin,200);
  assert(saved.fields.createdAt.timestampValue,'submission uses a real server timestamp');
  await request('/v1/'+base+'/enquiries/valid','GET',null,null,403);
  await request('/v1/'+base+'/enquiries/valid','GET',null,google,403);
  await request('/v1/'+base+'/enquiries','GET',null,token('teacher','password'),403);
  await request('/v1/'+base+'/enquiries','GET',null,admin,200);
  await request('/v1/'+base+'/enquiries','GET',null,owner,200);
  const update={update:{name:base+'/enquiries/valid',fields:fields({status:'Contacted',updatedBy:'admin'})},updateMask:{fieldPaths:['status','updatedBy']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]};
  await commit(update,google,403);
  await commit(update,admin,200);
  await request('/v1/'+base+'/enquiries/valid?updateMask.fieldPaths=name','PATCH',{fields:fields({name:'Tampered'})},admin,403);
  await request('/v1/'+base+'/enquiries/valid','DELETE',null,google,403);
  // Old inquiries remain readable and can be followed up without a migration.
  await request('/v1/'+base+'/enquiries/legacy','PATCH',{fields:fields({name:'Legacy student',status:'New',createdAt:'2025-01-01T00:00:00Z'})},'owner',200);
  await request('/v1/'+base+'/enquiries/legacy','GET',null,admin,200);
  await commit({...update,update:{...update.update,name:base+'/enquiries/legacy'}},admin,200);
  console.log(`${checks} local Firestore permission checks passed: Google-only verified creates, identity/schema/server-date enforcement, private reads, admin follow-up and legacy support.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
