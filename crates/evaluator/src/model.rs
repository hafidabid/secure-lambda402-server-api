//! Model parsing and validation matching `packages/schemas/src/model.ts`
//! exactly (docs/03 B8 "Scoring").

use serde::Deserialize;

use crate::error::EvalError;
use crate::io::SchemaContract;

const MAX_ABS_WEIGHT: f64 = 1e6;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelJson {
    pub features: Vec<String>,
    pub weights: Vec<f64>,
    pub bias: f64,
}

pub fn parse_and_validate(raw: &[u8], schema: &SchemaContract) -> Result<ModelJson, EvalError> {
    let model: ModelJson =
        serde_json::from_slice(raw).map_err(|_| EvalError::BadInput("model is not valid JSON".into()))?;

    let schema_names: Vec<&str> = schema.features.iter().map(|f| f.name.as_str()).collect();

    if model.weights.len() != model.features.len() {
        return Err(EvalError::ModelUnusable("weights count must equal features count".into()));
    }

    let same_order = model.features.len() == schema_names.len()
        && model.features.iter().zip(schema_names.iter()).all(|(a, b)| a == b);
    if !same_order {
        return Err(EvalError::ModelUnusable("features must equal schema order".into()));
    }

    if !model.bias.is_finite() {
        return Err(EvalError::ModelUnusable("bias must be finite".into()));
    }
    if !model.weights.iter().all(|w| w.is_finite()) {
        return Err(EvalError::ModelUnusable("all weights must be finite".into()));
    }
    if model.weights.iter().any(|w| w.abs() > MAX_ABS_WEIGHT) {
        return Err(EvalError::ModelUnusable(format!("weight magnitude exceeds {MAX_ABS_WEIGHT}")));
    }
    let all_zero = model.weights.iter().all(|w| *w == 0.0) && model.bias == 0.0;
    if all_zero {
        return Err(EvalError::ModelUnusable("degenerate model: all weights and bias are zero".into()));
    }

    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::Feature;

    fn schema() -> SchemaContract {
        SchemaContract {
            task: "binary_classification".into(),
            features: vec![
                Feature { name: "age".into(), r#type: "int".into() },
                Feature { name: "glucose".into(), r#type: "float".into() },
            ],
            label: "y".into(),
        }
    }

    #[test]
    fn va_05_accepts_a_well_formed_model() {
        let raw = br#"{"features":["age","glucose"],"weights":[0.5,-0.2],"bias":0.1}"#;
        assert!(parse_and_validate(raw, &schema()).is_ok());
    }

    #[test]
    fn ev_09_model_failing_schema_is_model_unusable() {
        let raw = br#"{"features":["a","b"],"weights":[1,2],"bias":0}"#;
        let err = parse_and_validate(raw, &schema()).unwrap_err();
        assert_eq!(err.code(), "MODEL_UNUSABLE");
    }

    #[test]
    fn va_15_weights_count_differing_from_features_is_rejected() {
        let raw = br#"{"features":["age","glucose"],"weights":[0.5],"bias":0.1}"#;
        assert!(parse_and_validate(raw, &schema()).is_err());
    }

    #[test]
    fn va_16_features_in_a_different_order_is_rejected() {
        let raw = br#"{"features":["glucose","age"],"weights":[0.5,-0.2],"bias":0.1}"#;
        assert!(parse_and_validate(raw, &schema()).is_err());
    }

    #[test]
    fn va_17_all_zero_weights_and_bias_is_rejected_as_degenerate() {
        let raw = br#"{"features":["age","glucose"],"weights":[0,0],"bias":0}"#;
        assert!(parse_and_validate(raw, &schema()).is_err());
    }

    #[test]
    fn va_18_weight_larger_than_1e6_is_rejected() {
        let raw = br#"{"features":["age","glucose"],"weights":[1e7,0.1],"bias":0}"#;
        assert!(parse_and_validate(raw, &schema()).is_err());
    }

    #[test]
    fn va_27_weight_of_exactly_1e6_is_accepted() {
        let raw = br#"{"features":["age","glucose"],"weights":[1e6,0.1],"bias":0}"#;
        assert!(parse_and_validate(raw, &schema()).is_ok());
    }

    #[test]
    fn va_19_missing_bias_field_is_rejected() {
        let raw = br#"{"features":["age","glucose"],"weights":[0.5,-0.2]}"#;
        assert!(parse_and_validate(raw, &schema()).is_err());
    }

    #[test]
    fn va_19_extra_unknown_field_is_rejected() {
        let raw = br#"{"features":["age","glucose"],"weights":[0.5,-0.2],"bias":0.1,"extra":1}"#;
        assert!(parse_and_validate(raw, &schema()).is_err());
    }

    #[test]
    fn ev_10_malformed_json_is_bad_input() {
        let raw = b"{not json";
        let err = parse_and_validate(raw, &schema()).unwrap_err();
        assert_eq!(err.code(), "BAD_INPUT");
    }
}
