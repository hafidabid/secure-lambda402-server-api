//! Dataset CSV parsing matching the schema contract (docs/03 section 9:
//! "UTF-8 CSV with header row", numeric features plus one 0/1 label).

use std::collections::BTreeSet;

use crate::error::EvalError;
use crate::io::SchemaContract;

#[derive(Debug)]
pub struct Row {
    pub features: Vec<f64>, // in schema order
    pub label: u8,          // 0 or 1
}

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

pub fn parse(raw: &[u8], schema: &SchemaContract) -> Result<Vec<Row>, EvalError> {
    let bytes = if raw.starts_with(&UTF8_BOM) { &raw[3..] } else { raw };

    let mut reader = csv::ReaderBuilder::new().has_headers(true).from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|_| EvalError::DataUnusable("dataset is not valid CSV".into()))?
        .clone();

    let header_names: Vec<&str> = headers.iter().collect();
    let unique: BTreeSet<&str> = header_names.iter().copied().collect();
    if unique.len() != header_names.len() {
        return Err(EvalError::DataUnusable("dataset has a duplicate column name".into()));
    }

    let expected: BTreeSet<&str> = schema
        .features
        .iter()
        .map(|f| f.name.as_str())
        .chain(std::iter::once(schema.label.as_str()))
        .collect();
    let actual: BTreeSet<&str> = header_names.iter().copied().collect();
    if expected != actual {
        return Err(EvalError::DataUnusable("dataset columns do not match the schema".into()));
    }

    // Map each schema feature (in schema order) to its column index, matched by name (VA-02).
    let feature_idx: Vec<usize> = schema
        .features
        .iter()
        .map(|f| header_names.iter().position(|h| *h == f.name).unwrap())
        .collect();
    let label_idx = header_names.iter().position(|h| *h == schema.label).unwrap();

    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|_| EvalError::DataUnusable("dataset has a malformed row".into()))?;

        let mut features = Vec::with_capacity(feature_idx.len());
        for &idx in &feature_idx {
            let raw_value = record
                .get(idx)
                .ok_or_else(|| EvalError::DataUnusable("dataset row is missing a value".into()))?;
            let value: f64 = raw_value
                .trim()
                .parse()
                .map_err(|_| EvalError::DataUnusable("dataset has a non-numeric feature value".into()))?;
            if !value.is_finite() {
                return Err(EvalError::DataUnusable("dataset has a non-finite feature value".into()));
            }
            features.push(value);
        }

        let label_raw = record
            .get(label_idx)
            .ok_or_else(|| EvalError::DataUnusable("dataset row is missing a label".into()))?
            .trim();
        let label: u8 = match label_raw {
            "0" => 0,
            "1" => 1,
            _ => return Err(EvalError::DataUnusable("dataset label must be 0 or 1".into())),
        };

        rows.push(Row { features, label });
    }

    Ok(rows)
}

/// Enforces min_rows and min_class_count (docs/03 B8/B9). Called after
/// parsing so the row count and class balance are both known.
pub fn validate_rules(rows: &[Row], min_rows: u32, min_class_count: u32) -> Result<(), EvalError> {
    if rows.len() < min_rows as usize {
        return Err(EvalError::DataUnusable("dataset has fewer than the minimum number of rows".into()));
    }
    let class0 = rows.iter().filter(|r| r.label == 0).count();
    let class1 = rows.iter().filter(|r| r.label == 1).count();
    if class0 < min_class_count as usize || class1 < min_class_count as usize {
        return Err(EvalError::DataUnusable("dataset does not have enough rows in one class".into()));
    }
    Ok(())
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
    fn va_01_accepts_columns_in_schema_order() {
        let csv = "age,glucose,y\n1,2.5,0\n2,3.5,1\n";
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].features, vec![1.0, 2.5]);
        assert_eq!(rows[0].label, 0);
    }

    #[test]
    fn va_02_accepts_columns_in_a_different_order_matched_by_name() {
        let csv = "y,glucose,age\n0,2.5,1\n1,3.5,2\n";
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        // Features are reordered back into schema order (age, glucose) regardless of header order.
        assert_eq!(rows[0].features, vec![1.0, 2.5]);
    }

    #[test]
    fn va_03_accepts_crlf_and_utf8_bom() {
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice(b"age,glucose,y\r\n1,2.5,0\r\n");
        let rows = parse(&bytes, &schema()).unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn va_04_accepts_scientific_notation() {
        let csv = "age,glucose,y\n1,1.2e2,0\n";
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        assert_eq!(rows[0].features[1], 120.0);
    }

    #[test]
    fn va_06_rejects_duplicate_column_name() {
        let csv = "age,age,glucose,y\n1,1,2.5,0\n";
        assert!(parse(csv.as_bytes(), &schema()).is_err());
    }

    #[test]
    fn va_07_rejects_missing_schema_column() {
        let csv = "age,y\n1,0\n";
        assert!(parse(csv.as_bytes(), &schema()).is_err());
    }

    #[test]
    fn va_08_rejects_extra_column() {
        let csv = "age,glucose,extra,y\n1,2.5,9,0\n";
        assert!(parse(csv.as_bytes(), &schema()).is_err());
    }

    #[test]
    fn va_09_rejects_non_numeric_feature_value() {
        let csv = "age,glucose,y\nNaNtext,2.5,0\n";
        assert!(parse(csv.as_bytes(), &schema()).is_err());
    }

    #[test]
    fn va_12_rejects_nan_and_inf_literals_as_non_finite() {
        for bad in ["NaN", "inf", "-inf", "infinity"] {
            let csv = format!("age,glucose,y\n{bad},2.5,0\n");
            assert!(parse(csv.as_bytes(), &schema()).is_err(), "{bad:?} should be rejected as non-finite");
        }
    }

    #[test]
    fn va_11_rejects_label_values_other_than_0_or_1() {
        for bad in ["2", "yes", ""] {
            let csv = format!("age,glucose,y\n1,2.5,{bad}\n");
            assert!(parse(csv.as_bytes(), &schema()).is_err(), "label {bad:?} should be rejected");
        }
    }

    #[test]
    fn va_13_rejects_header_only_file_via_min_rows() {
        let csv = "age,glucose,y\n";
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        assert!(validate_rules(&rows, 50, 1).is_err());
    }

    #[test]
    fn ev_06_dataset_failing_schema_is_data_unusable() {
        let csv = "a,b,c\n1,2,3\n";
        let err = parse(csv.as_bytes(), &schema()).unwrap_err();
        assert_eq!(err.code(), "DATA_UNUSABLE");
    }

    #[test]
    fn ev_07_rows_below_min_rows_is_data_unusable() {
        let csv = "age,glucose,y\n1,2.5,0\n2,3.5,1\n";
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        let err = validate_rules(&rows, 50, 1).unwrap_err();
        assert_eq!(err.code(), "DATA_UNUSABLE");
    }

    #[test]
    fn ev_08_class_below_min_class_count_is_data_unusable() {
        let csv = "age,glucose,y\n1,2.5,0\n2,3.5,0\n3,4.5,1\n";
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        let err = validate_rules(&rows, 1, 2).unwrap_err(); // only 1 row of class 1, need 2
        assert_eq!(err.code(), "DATA_UNUSABLE");
    }

    #[test]
    fn va_20_rows_exactly_equal_to_min_rows_is_accepted() {
        let mut csv = "age,glucose,y\n".to_string();
        for i in 0..50 {
            csv.push_str(&format!("{i},{i}.0,{}\n", i % 2));
        }
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        assert_eq!(rows.len(), 50);
        assert!(validate_rules(&rows, 50, 1).is_ok());
    }

    #[test]
    fn va_21_rows_one_below_min_rows_is_rejected() {
        let mut csv = "age,glucose,y\n".to_string();
        for i in 0..49 {
            csv.push_str(&format!("{i},{i}.0,{}\n", i % 2));
        }
        let rows = parse(csv.as_bytes(), &schema()).unwrap();
        assert!(validate_rules(&rows, 50, 1).is_err());
    }

    #[test]
    fn ev_11_error_messages_never_contain_a_value_or_row_position() {
        let canary = "CANARY_ROW_7f3c";
        let csv = format!("age,glucose,y\n{canary},2.5,0\n");
        let err = parse(csv.as_bytes(), &schema()).unwrap_err();
        assert!(!format!("{err}").contains(canary));
    }
}
