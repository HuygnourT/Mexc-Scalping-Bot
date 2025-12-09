const CryptoJS = require('crypto-js');

function createSignature(queryString, secret) {
  return CryptoJS.HmacSHA256(queryString, secret).toString(CryptoJS.enc.Hex);
}

module.exports = {
  createSignature
};
