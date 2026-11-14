//! Entry point for the pinned wasm32-wasip1 evaluator (docs/03 B8).
//! The private key `E_priv` is injected as an environment variable by the
//! OutLayer project secret mechanism; the job input is passed via
//! `--input <json>` (matching the CLI usage implied by docs/02's
//! experiment notes) or, if that flag is absent, read whole from stdin.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::io::Read;

const PRIVATE_KEY_ENV_VAR: &str = "EVALUATOR_PRIVATE_KEY";

fn read_input() -> Vec<u8> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == "--input") {
        if let Some(value) = args.get(pos + 1) {
            return value.clone().into_bytes();
        }
    }
    let mut buf = Vec::new();
    std::io::stdin()
        .read_to_end(&mut buf)
        .expect("failed to read job input from stdin");
    buf
}

fn load_private_key() -> [u8; 32] {
    let encoded = std::env::var(PRIVATE_KEY_ENV_VAR)
        .unwrap_or_else(|_| panic!("{PRIVATE_KEY_ENV_VAR} is not set"));
    let bytes = BASE64.decode(encoded.trim()).expect("EVALUATOR_PRIVATE_KEY is not valid base64");
    let mut key = [0u8; 32];
    if bytes.len() != 32 {
        panic!("EVALUATOR_PRIVATE_KEY must decode to exactly 32 bytes");
    }
    key.copy_from_slice(&bytes);
    key
}

fn main() {
    let e_priv = load_private_key();
    let input_json = read_input();
    let output = securelambda_evaluator::run(&input_json, &e_priv);
    println!("{output}");
}
