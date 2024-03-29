const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const nonce = require('nonce')();
const crypto = require('crypto');
const qs = require('querystring');
const jwt = require('jsonwebtoken');
// const jose = require('jose');
const jose = require('node-jose');
const URLSafeBase64 = require('urlsafe-base64');
const colors = require('colors');

var security = {};

// Sorts a JSON object based on the key value in alphabetical order
function sortJSON(json) {
  if (_.isNil(json)) {
    return json;
  }

  var newJSON = {};
  var keys = Object.keys(json);
  keys.sort();

  for (key in keys) {
    newJSON[keys[key]] = json[keys[key]];
  }

  return newJSON;
};


/**
 * @param url Full API URL
 * @param params JSON object of params sent, key/value pair.
 * @param method
 * @param appId ClientId
 * @param keyCertContent Private Key Certificate content
 * @param keyCertPassphrase Private Key Certificate Passphrase
 * @returns {string}
 */
function generateSHA256withRSAHeader(url, params, method, strContentType, appId, keyCertContent, keyCertPassphrase) {
  var nonceValue = nonce();
  var timestamp = (new Date).getTime();

  // A) Construct the Authorisation Token
  var defaultApexHeaders = {
    "app_id": appId, // App ID assigned to your application
    "nonce": nonceValue, // secure random number
    "signature_method": "RS256",
    "timestamp": timestamp // Unix epoch time
  };

  // Remove params unless Content-Type is "application/x-www-form-urlencoded"
  if (method == "POST" && strContentType != "application/x-www-form-urlencoded") {
    params = {};
  }

  // B) Forming the Signature Base String

  // i) Normalize request parameters
  var baseParams = sortJSON(_.merge(defaultApexHeaders, params));

  var baseParamsStr = qs.stringify(baseParams);
  baseParamsStr = qs.unescape(baseParamsStr);

  // ii) construct request URL ---> url is passed in to this function

  // iii) concatenate request elements
  var baseString = method.toUpperCase() + "&" + url + "&" + baseParamsStr;

  console.log("Formulated Base String".green);
  console.log("Base String generated by your application that will be signed using your private key.".grey);
  console.log(baseString);

  // C) Signing Base String to get Digital Signature
  var signWith = {
    key: fs.readFileSync(keyCertContent, 'utf8')
  };

  if (!_.isUndefined(keyCertPassphrase) && !_.isEmpty(keyCertPassphrase)) _.set(signWith, "passphrase", keyCertPassphrase);

  // Load pem file containing the x509 cert & private key & sign the base string with it.
  var signature = crypto.createSign('RSA-SHA256')
    .update(baseString)
    .sign(signWith, 'base64');

  console.log("Digital Signature:".green);
  console.log("Signature produced by signing the above Base String with your private key.".grey);
  console.log(signature);


  // D) Assembling the Header
  var strApexHeader = "PKI_SIGN timestamp=\"" + timestamp +
    "\",nonce=\"" + nonceValue +
    "\",app_id=\"" + appId +
    "\",signature_method=\"RS256\"" +
    ",signature=\"" + signature +
    "\"";

  return strApexHeader;
};

/**
 * @param url API URL
 * @param params JSON object of params sent, key/value pair.
 * @param method
 * @param appId API ClientId
 * @param passphrase API Secret or certificate passphrase
 * @returns {string}
 */
security.generateAuthorizationHeader = function(url, params, method, strContentType, authType, appId, keyCertContent, passphrase) {

  if (authType == "L2") {
    return generateSHA256withRSAHeader(url, params, method, strContentType, appId, keyCertContent, passphrase);
  }
  else {
    return "";
  }

};

// Verify & Decode JWS or JWT
security.verifyJWS = function verifyJWS(jws, publicCert) {
  // verify token
  // ignore notbefore check because it gives errors sometimes if the call is too fast.
  try {
    var decoded = jwt.verify(jws, fs.readFileSync(publicCert, 'utf8'), {
      algorithms: ['RS256'],
      ignoreNotBefore: true
    });
    return decoded;
  } catch (error) {
    console.error("Error with verifying and decoding JWS: %s".red, error);
    throw ("Error with verifying and decoding JWS");
  }
}

// Decrypt JWE using private key
security.decryptJWE = function decryptJWE(header, encryptedKey, iv, cipherText, tag, privateKey) {
  console.log("Decrypting JWE".green + " (Format: " + "header".red + "." + "encryptedKey".cyan + "." + "iv".green + "." + "cipherText".magenta + "." + "tag".yellow + ")");
  console.log(header.red + "." + encryptedKey.cyan + "." + iv.green + "." + cipherText.magenta + "." + tag.yellow);
  return new Promise((resolve, reject) => {

    var keystore = jose.JWK.createKeyStore();

    console.log((new Buffer(header,'base64')).toString('ascii'));

    var data = {
      "type": "compact",
      "ciphertext": cipherText,
      "protected": header,
      "encrypted_key": encryptedKey,
      "tag": tag,
      "iv": iv,
      "header": JSON.parse(jose.util.base64url.decode(header).toString())
    };
    keystore.add(fs.readFileSync(privateKey, 'utf8'), "pem")
      .then(function(jweKey) {
        // {result} is a jose.JWK.Key
        jose.JWE.createDecrypt(jweKey)
          .decrypt(data)
          .then(function(result) {
            resolve(JSON.parse(result.payload.toString()));
          })
          .catch(function(error) {
            reject(error);
          });
      });

  })
  .catch (error => {
    console.error("Error with decrypting JWE: %s".red, error);
    throw "Error with decrypting JWE";
  })
}

module.exports = security;
