//! Guards the hand-testing files in `samples/glucose/`: they must parse with the
//! real evaluator code and satisfy typical listing rules.

use std::fs;
use std::path::PathBuf;

use securelambda_evaluator::dataset;
use securelambda_evaluator::io::SchemaContract;
use securelambda_evaluator::model;
use securelambda_evaluator::scoring;

fn sample(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../samples/glucose").join(name);
    fs::read(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

fn schema() -> SchemaContract {
    serde_json::from_slice(&sample("glucose-schema.json")).expect("schema json")
}

#[test]
fn csv_parses_against_schema() {
    let rows = dataset::parse(&sample("glucose.csv"), &schema()).expect("csv should parse");
    assert_eq!(rows.len(), 240);
    assert!(rows.iter().all(|r| r.features.len() == 2));
}

#[test]
fn csv_satisfies_suggested_rules() {
    let rows = dataset::parse(&sample("glucose.csv"), &schema()).unwrap();
    dataset::validate_rules(&rows, 100, 20).expect("rules should hold");
}

#[test]
fn model_is_valid_for_schema_and_scores_sensibly() {
    let schema = schema();
    let rows = dataset::parse(&sample("glucose.csv"), &schema).unwrap();
    let model = model::parse_and_validate(&sample("glucose-model.json"), &schema).expect("model valid");
    let scored = scoring::score_rows(&rows, &model);
    assert!(scoring::accuracy(&scored) > 0.7, "model should beat chance on its own sample data");
    assert!(scoring::auc(&scored).expect("both classes present") > 0.7);
}
