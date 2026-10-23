const { createPublicKey, randomBytes, publicEncrypt, createCipheriv, constants, createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');

// Opt-in only for owner-triggered, public pinned-source review. No private key on the server.
function captureKey(pem) {
  if(typeof pem!=='string'||pem.length>2000||!/^-----BEGIN PUBLIC KEY-----/.test(pem)) throw new Error('Invalid capture public key');
  const key=createPublicKey(pem);
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048||key.asymmetricKeyDetails.modulusLength>4096) throw new Error('Capture requires RSA 2048-4096');
  return key;
}
function encryptCapture(value,pem) {
  const key=captureKey(pem),secret=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',secret,iv);
  const plain=Buffer.from(JSON.stringify(value));
  const compressed=gzipSync(plain);
  const data=Buffer.concat([cipher.update(compressed),cipher.final()]);
  return {version:1,algorithm:'RSA-OAEP-SHA256+AES-256-GCM',compression:'gzip',
    keyFingerprint:createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex'),
    wrappedKey:publicEncrypt({key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},secret).toString('base64'),
    iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64'),
    plaintextSha256:createHash('sha256').update(plain).digest('hex')};
}
module.exports={captureKey,encryptCapture};
