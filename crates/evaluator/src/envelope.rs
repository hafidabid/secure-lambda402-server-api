//! Envelope decryption matching `packages/crypto` exactly (docs/03 B7).
//! The evaluator only ever unwraps and decrypts; it never wraps.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use hkdf::Hkdf;
use serde::Deserialize;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::error::EvalError;

const HKDF_INFO: &[u8] = b"securelambda/v1/wrap";
const AAD_DOMAIN: &str = "securelambda/v1";
const EPK_BYTES: usize = 32;
const WRAP_NONCE_BYTES: usize = 12;
const WRAPPED_KEY_CT_BYTES: usize = 48;
const FILE_NONCE_BYTES: usize = 12;
const GCM_TAG_BYTES: usize = 16;

#[derive(Debug, Deserialize, Clone)]
pub struct AadContext {
    pub listing: String,
    pub role: String,
    pub ev: String,
    pub ct_sha256: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Envelope {
    pub v: u8,
    pub epk: String,
    pub nonce: String,
    pub ct: String,
    pub aad_ctx: AadContext,
}

/// Rebuilds the AAD from values the caller independently knows to be true
/// (never from `envelope.aad_ctx`, which is attacker-controlled input) —
/// this is what makes replaying a wrapped key on another listing, role or
/// evaluator version fail. Mirrors `packages/crypto`'s `buildAad`.
pub fn build_aad(listing: &str, role: &str, ev: &str, ct_sha256: &str) -> Vec<u8> {
    format!("{}||{}||{}||{}||{}", AAD_DOMAIN, listing, role, ev, ct_sha256).into_bytes()
}

/// Unwraps K_file using the evaluator's private key and an independently
/// derived AAD. `e_priv` is the 32 raw bytes of the X25519 static secret.
pub fn unwrap_key(envelope: &Envelope, e_priv: &[u8; 32], expected_aad: &[u8]) -> Result<[u8; 32], EvalError> {
    if envelope.v != 1 {
        return Err(EvalError::BadInput(format!("unsupported envelope version: {}", envelope.v)));
    }

    let epk_bytes = BASE64
        .decode(&envelope.epk)
        .map_err(|e| EvalError::BadInput(format!("epk is not valid base64: {e}")))?;
    let nonce_bytes = BASE64
        .decode(&envelope.nonce)
        .map_err(|e| EvalError::BadInput(format!("nonce is not valid base64: {e}")))?;
    let ct_bytes = BASE64
        .decode(&envelope.ct)
        .map_err(|e| EvalError::BadInput(format!("ct is not valid base64: {e}")))?;

    if epk_bytes.len() != EPK_BYTES || nonce_bytes.len() != WRAP_NONCE_BYTES || ct_bytes.len() != WRAPPED_KEY_CT_BYTES {
        return Err(EvalError::BadInput("envelope field has an unexpected decoded length".into()));
    }

    let mut epk_arr = [0u8; EPK_BYTES];
    epk_arr.copy_from_slice(&epk_bytes);
    let epk = PublicKey::from(epk_arr);
    let secret = StaticSecret::from(*e_priv);
    let shared_secret = secret.diffie_hellman(&epk);

    if shared_secret.as_bytes().iter().all(|b| *b == 0) {
        // Low-order / invalid epk collapses the ECDH output to all zero bytes.
        return Err(EvalError::UnwrapFailed("low-order or invalid ephemeral public key".into()));
    }

    let hk = Hkdf::<Sha256>::new(Some(&[]), shared_secret.as_bytes());
    let mut wrapping_key = [0u8; 32];
    hk.expand(HKDF_INFO, &mut wrapping_key)
        .map_err(|e| EvalError::Internal(format!("HKDF expand failed: {e}")))?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&wrapping_key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, Payload { msg: &ct_bytes, aad: expected_aad })
        .map_err(|_| EvalError::UnwrapFailed("AES-GCM authentication failed while unwrapping K_file".into()))?;

    if plaintext.len() != 32 {
        return Err(EvalError::UnwrapFailed("unwrapped key has the wrong length".into()));
    }
    let mut k_file = [0u8; 32];
    k_file.copy_from_slice(&plaintext);
    Ok(k_file)
}

/// Decrypts a file blob (12-byte nonce || ciphertext || 16-byte GCM tag), no AAD.
pub fn decrypt_file(blob: &[u8], k_file: &[u8; 32]) -> Result<Vec<u8>, EvalError> {
    if blob.len() < FILE_NONCE_BYTES + GCM_TAG_BYTES {
        return Err(EvalError::DecryptFailed("ciphertext blob too short to contain nonce and tag".into()));
    }
    let nonce_bytes = &blob[..FILE_NONCE_BYTES];
    let ciphertext = &blob[FILE_NONCE_BYTES..];

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(k_file));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| EvalError::DecryptFailed("AES-GCM authentication failed while decrypting the file".into()))
}
