const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync,privateDecrypt,createDecipheriv,createHash,constants}=require('node:crypto');
const {gunzipSync}=require('node:zlib');
const {captureKey,encryptCapture}=require('../audit-capture');
const {parseSourceRequest}=require('../pinned-sources');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=publicKey.export({type:'spki',format:'pem'});
test('capture keeps exact rejected drafts and reviews encrypted for the local key',()=>{
  const draft={title:'Retained private draft',accepted:false,review:{full:'Unclipped review'}};
  const result=encryptCapture(draft,pem);
  assert.doesNotMatch(JSON.stringify(result),/Retained private draft|Unclipped review/);
  const key=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(result.wrappedKey,'base64'));
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(result.iv,'base64'));decipher.setAuthTag(Buffer.from(result.tag,'base64'));
  const bytes=gunzipSync(Buffer.concat([decipher.update(Buffer.from(result.data,'base64')),decipher.final()]));
  assert.deepEqual(JSON.parse(bytes),draft);assert.equal(createHash('sha256').update(bytes).digest('hex'),result.plaintextSha256);
  const wrong=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  assert.throws(()=>privateDecrypt({key:wrong,oaepHash:'sha256'},Buffer.from(result.wrappedKey,'base64')));
});
test('capture rejects invalid, weak and private keys before source collection',()=>{
  const weak=generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({type:'spki',format:'pem'});
  for(const value of ['',weak,privateKey.export({type:'pkcs8',format:'pem'})])assert.throws(()=>captureKey(value));
  const config={owner:'example',controlRepository:'bot',repositories:['research']};
  const sources=['one.md','two.md'].map(x=>`https://github.com/example/research/blob/${'a'.repeat(40)}/${x}`);
  assert.equal(parseSourceRequest(JSON.stringify({sources,capturePublicKey:pem}),config,()=>true).capturePublicKey,pem);
  assert.throws(()=>parseSourceRequest(JSON.stringify({sources,capturePublicKey:'bad'}),config,()=>true));
});
