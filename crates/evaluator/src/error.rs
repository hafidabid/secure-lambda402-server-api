//! Error codes returned to buyers (docs/03 B8): BAD_INPUT, UNWRAP_FAILED,
//! DECRYPT_FAILED, DATA_UNUSABLE, MODEL_UNUSABLE, INTERNAL. Never carries a
//! value or a row position (docs/05 EV-11 canary scan).

use std::fmt;

#[derive(Debug)]
pub enum EvalError {
    BadInput(String),
    UnwrapFailed(String),
    DecryptFailed(String),
    DataUnusable(String),
    ModelUnusable(String),
    Internal(String),
}

impl EvalError {
    pub fn code(&self) -> &'static str {
        match self {
            EvalError::BadInput(_) => "BAD_INPUT",
            EvalError::UnwrapFailed(_) => "UNWRAP_FAILED",
            EvalError::DecryptFailed(_) => "DECRYPT_FAILED",
            EvalError::DataUnusable(_) => "DATA_UNUSABLE",
            EvalError::ModelUnusable(_) => "MODEL_UNUSABLE",
            EvalError::Internal(_) => "INTERNAL",
        }
    }
}

impl fmt::Display for EvalError {
    // Internal-only; never written to stdout/stderr where a buyer could see it.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (code, msg) = match self {
            EvalError::BadInput(m) => ("BAD_INPUT", m),
            EvalError::UnwrapFailed(m) => ("UNWRAP_FAILED", m),
            EvalError::DecryptFailed(m) => ("DECRYPT_FAILED", m),
            EvalError::DataUnusable(m) => ("DATA_UNUSABLE", m),
            EvalError::ModelUnusable(m) => ("MODEL_UNUSABLE", m),
            EvalError::Internal(m) => ("INTERNAL", m),
        };
        write!(f, "{code}: {msg}")
    }
}

impl std::error::Error for EvalError {}
