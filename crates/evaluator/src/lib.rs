pub mod dataset;
pub mod envelope;
pub mod error;
pub mod io;
pub mod model;
pub mod scoring;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use sha2::{Digest, Sha256};

use envelope::{build_aad, decrypt_file, unwrap_key, Envelope};
use error::EvalError;
use io::{row_count_bucket, EvaluatorInput, FailureOutput, Metrics, SuccessOutput};

pub fn ct_sha256_hex(blob: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(blob);
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn open_file(ct_b64: &str, envelope: &Envelope, e_priv: &[u8; 32], listing_id: &str, role: &str, ev: &str) -> Result<Vec<u8>, EvalError> {
    let blob = BASE64
        .decode(ct_b64)
        .map_err(|e| EvalError::BadInput(format!("ciphertext is not valid base64: {e}")))?;
    let aad = build_aad(listing_id, role, ev, &ct_sha256_hex(&blob));
    let k_file = unwrap_key(envelope, e_priv, &aad)?;
    decrypt_file(&blob, &k_file)
}

/// Runs the full job: unwrap, decrypt, validate, score, round, apply
/// output rules (docs/03 B8). Never panics — every failure path returns a
/// typed `EvalError` that `run` converts into the documented failure body.
pub fn evaluate(input: &EvaluatorInput, e_priv: &[u8; 32]) -> Result<SuccessOutput, EvalError> {
    let dataset_plain = open_file(
        &input.dataset.ct_b64,
        &input.dataset.wrapped_key,
        e_priv,
        &input.listing_id,
        "dataset",
        &input.evaluator_version,
    )?;
    let model_plain = open_file(
        &input.model.ct_b64,
        &input.model.wrapped_key,
        e_priv,
        &input.listing_id,
        "model",
        &input.evaluator_version,
    )?;

    let rows = dataset::parse(&dataset_plain, &input.schema)?;
    dataset::validate_rules(&rows, input.rules.min_rows, input.rules.min_class_count)?;

    let model = model::parse_and_validate(&model_plain, &input.schema)?;

    let scored = scoring::score_rows(&rows, &model);
    let round = input.rules.round;
    let metrics = Metrics {
        accuracy: scoring::round_to(scoring::accuracy(&scored), round),
        auc: scoring::auc(&scored).map(|v| scoring::round_to(v, round)),
        f1: scoring::round_to(scoring::f1(&scored), round),
    };

    Ok(SuccessOutput {
        v: 1,
        ok: true,
        metrics,
        n_bucket: row_count_bucket(rows.len()),
        evaluator_version: input.evaluator_version.clone(),
    })
}

/// Parses the input JSON and runs `evaluate`, producing exactly one JSON
/// line either way — success or `{v,ok:false,error}` — never anything else
/// on stdout, and never a value or row position in the failure body
/// (docs/05 EV-11 canary scan).
pub fn run(input_json: &[u8], e_priv: &[u8; 32]) -> String {
    let result: Result<SuccessOutput, EvalError> = (|| {
        let input: EvaluatorInput =
            serde_json::from_slice(input_json).map_err(|_| EvalError::BadInput("malformed job input".into()))?;
        evaluate(&input, e_priv)
    })();

    match result {
        Ok(output) => serde_json::to_string(&output).unwrap_or_else(|_| fallback_internal_error()),
        Err(err) => serde_json::to_string(&FailureOutput { v: 1, ok: false, error: err.code() })
            .unwrap_or_else(|_| fallback_internal_error()),
    }
}

fn fallback_internal_error() -> String {
    r#"{"v":1,"ok":false,"error":"INTERNAL"}"#.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ev_10_malformed_json_input_is_bad_input_not_a_panic() {
        let out = run(b"{not json", &[0u8; 32]);
        assert_eq!(out, r#"{"v":1,"ok":false,"error":"BAD_INPUT"}"#);
    }

    #[test]
    fn ev_05_output_is_always_a_single_json_line() {
        let out = run(b"garbage", &[0u8; 32]);
        assert!(!out.contains('\n'));
        let _: serde_json::Value = serde_json::from_str(&out).expect("output must be valid JSON");
    }

    #[test]
    fn cr_09_wrong_e_priv_never_panics_and_reports_unwrap_failed() {
        let hash = "a".repeat(64);
        // Exact, correctly-sized envelope field lengths (32/12/48 bytes),
        // built programmatically rather than hand-typed base64 — a single
        // miscounted character here silently changes which error fires.
        let epk = BASE64.encode([1u8; 32]);
        let nonce = BASE64.encode([2u8; 12]);
        let ct = BASE64.encode([3u8; 48]);
        let input = serde_json::json!({
            "v": 1, "run_id": "r1", "listing_id": "l1", "evaluator_version": "1.0.0",
            "schema": {"task": "binary_classification", "features": [{"name":"x","type":"float"}], "label": "y"},
            "rules": {"min_rows": 1, "min_class_count": 1, "round": 2, "metrics": ["accuracy"]},
            "dataset": {"ct_b64": "AAAA", "wrapped_key": {"v":1,"epk":epk,"nonce":nonce,"ct":ct,"aad_ctx":{"listing":"l1","role":"dataset","ev":"1.0.0","ct_sha256":hash}}},
            "model": {"ct_b64": "AAAA", "wrapped_key": {"v":1,"epk":epk,"nonce":nonce,"ct":ct,"aad_ctx":{"listing":"l1","role":"model","ev":"1.0.0","ct_sha256":hash}}}
        });
        let out = run(input.to_string().as_bytes(), &[9u8; 32]);
        assert_eq!(out, r#"{"v":1,"ok":false,"error":"UNWRAP_FAILED"}"#);
    }
}
