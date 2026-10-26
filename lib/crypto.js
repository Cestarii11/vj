/* V&J — cifrado de la carta con Web Crypto.
 *
 * - Clave: PBKDF2-HMAC-SHA256 a partir del código de 6 dígitos + una sal aleatoria.
 * - Cifrado: AES-GCM de 256 bits. Si el código es incorrecto, el descifrado FALLA
 *   (OperationError) y no se obtiene ningún texto: no hay "carta a medias".
 * - El código NUNCA aparece en el código ni en los archivos. El archivo
 *   data/carta.enc.json solo contiene sal, vector inicial (iv) y texto cifrado.
 * - Este mismo archivo lo usan la app (descifrar) y tools/cifrar-carta.html (cifrar).
 *
 * Límite honesto: un código de 6 dígitos tiene solo 1.000.000 de combinaciones.
 * PBKDF2 con muchas iteraciones lo encarece, pero una persona con el archivo y una
 * tarjeta gráfica podría probarlas todas. Es una barrera de sorpresa, no una caja fuerte.
 */
(function (global) {
    'use strict';

    var ITERATIONS = 600000;                       // iteraciones de PBKDF2 (recomendación OWASP 2023 para SHA-256)
    var AAD_TEXT = 'vj-carta-v1';                  // dato autenticado: ata el texto cifrado a esta versión del formato
    var encoder = new TextEncoder();
    var decoder = new TextDecoder();

    function toB64(buffer) {
        var bytes = new Uint8Array(buffer), s = '';
        for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function fromB64(b64) {
        var s = atob(b64), bytes = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
        return bytes;
    }
    function subtle() {
        if (!global.crypto || !global.crypto.subtle) throw new Error('NO_SUBTLE'); // requiere HTTPS (GitHub Pages lo es)
        return global.crypto.subtle;
    }

    // Deriva la clave AES. La clave resultante NO es exportable (nadie puede leer sus bytes).
    async function deriveKey(pin, saltB64, iterations, usages) {
        var s = subtle();
        var base = await s.importKey('raw', encoder.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
        return s.deriveKey(
            { name: 'PBKDF2', salt: fromB64(saltB64), iterations: iterations, hash: 'SHA-256' },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            usages || ['decrypt']
        );
    }

    // Cifra un objeto (la carta) y devuelve el "sobre" que se guarda en data/carta.enc.json
    async function encrypt(pin, payload) {
        var s = subtle();
        var salt = global.crypto.getRandomValues(new Uint8Array(16));
        var iv = global.crypto.getRandomValues(new Uint8Array(12));
        var saltB64 = toB64(salt);
        var key = await deriveKey(pin, saltB64, ITERATIONS, ['encrypt']);
        var ct = await s.encrypt(
            { name: 'AES-GCM', iv: iv, additionalData: encoder.encode(AAD_TEXT) },
            key,
            encoder.encode(JSON.stringify(payload))
        );
        return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: saltB64, iv: toB64(iv), ct: toB64(ct) };
    }

    // Descifra con una clave ya derivada. Con clave equivocada lanza DOMException "OperationError".
    async function decryptWithKey(key, envelope) {
        var pt = await subtle().decrypt(
            { name: 'AES-GCM', iv: fromB64(envelope.iv), additionalData: encoder.encode(AAD_TEXT) },
            key,
            fromB64(envelope.ct)
        );
        return JSON.parse(decoder.decode(pt));
    }

    async function decrypt(pin, envelope) {
        var key = await deriveKey(pin, envelope.salt, envelope.iter, ['decrypt']);
        return decryptWithKey(key, envelope);
    }

    // Comprobación básica de que el archivo tiene la forma esperada
    function validate(env) {
        return !!env && env.v === 1 && env.kdf === 'PBKDF2-SHA256' &&
            typeof env.iter === 'number' && env.iter >= 100000 && env.iter <= 5000000 &&
            typeof env.salt === 'string' && typeof env.iv === 'string' && typeof env.ct === 'string';
    }

    global.VJCrypto = { ITERATIONS: ITERATIONS, deriveKey: deriveKey, encrypt: encrypt, decrypt: decrypt, decryptWithKey: decryptWithKey, validate: validate };
})(window);