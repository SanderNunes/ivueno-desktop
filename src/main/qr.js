/**
 * The pairing link as a QR code, drawn HERE on the computer (an SVG string): the link holds a secret that must never go through the server.
 * Needs the `qrcode` package; without it the app shows the link as text instead of failing.
 */
async function qrSvg(text) {
  let QRCode;
  try { QRCode = require('qrcode'); } catch { const e = new Error('The QR code component is not installed.'); e.code = 'qr_unavailable'; throw e; }
  return QRCode.toString(String(text), { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
}

module.exports = { qrSvg };
