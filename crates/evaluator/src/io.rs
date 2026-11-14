//! JSON contract matching `packages/schemas/src/evaluator-io.ts` exactly
//! (docs/03 B8 "Input"/"Output").

use serde::{Deserialize, Serialize};

use crate::envelope::Envelope;

#[derive(Debug, Deserialize, Clone)]
pub struct Feature {
    pub name: String,
    #[allow(dead_code)]
    pub r#type: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SchemaContract {
    pub task: String,
    pub features: Vec<Feature>,
    pub label: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Rules {
    pub min_rows: u32,
    pub min_class_count: u32,
    pub round: u32,
    pub metrics: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FileInput {
    pub ct_b64: String,
    pub wrapped_key: Envelope,
}

#[derive(Debug, Deserialize, Clone)]
pub struct EvaluatorInput {
    pub v: u8,
    pub run_id: String,
    pub listing_id: String,
    pub evaluator_version: String,
    pub schema: SchemaContract,
    pub rules: Rules,
    pub dataset: FileInput,
    pub model: FileInput,
}

#[derive(Debug, Serialize)]
pub struct Metrics {
    pub accuracy: f64,
    pub auc: Option<f64>,
    pub f1: f64,
}

#[derive(Debug, Serialize)]
pub struct SuccessOutput {
    pub v: u8,
    pub ok: bool,
    pub metrics: Metrics,
    pub n_bucket: &'static str,
    pub evaluator_version: String,
}

#[derive(Debug, Serialize)]
pub struct FailureOutput {
    pub v: u8,
    pub ok: bool,
    pub error: &'static str,
}

pub fn row_count_bucket(rows: usize) -> &'static str {
    if rows < 100 {
        "<100"
    } else if rows < 200 {
        "100-199"
    } else if rows < 500 {
        "200-499"
    } else if rows < 1000 {
        "500-999"
    } else {
        "1000+"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ev_03_row_count_bucket_edges() {
        assert_eq!(row_count_bucket(99), "<100");
        assert_eq!(row_count_bucket(100), "100-199");
        assert_eq!(row_count_bucket(199), "100-199");
        assert_eq!(row_count_bucket(200), "200-499");
        assert_eq!(row_count_bucket(499), "200-499");
        assert_eq!(row_count_bucket(500), "500-999");
        assert_eq!(row_count_bucket(999), "500-999");
        assert_eq!(row_count_bucket(1000), "1000+");
    }
}
