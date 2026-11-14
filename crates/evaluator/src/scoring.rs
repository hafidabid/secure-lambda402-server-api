//! Logistic regression scoring matching docs/03 B8 "Scoring" exactly:
//! z = bias + sum(w*x), clamped to ±35, p = 1/(1+e^-z), threshold 0.5.
//! Accuracy, F1 (positive class 1), AUC (rank-based, ties averaged).

use crate::dataset::Row;
use crate::model::ModelJson;

const Z_CLAMP: f64 = 35.0;

pub struct ScoredRow {
    pub probability: f64,
    pub predicted: u8,
    pub label: u8,
}

pub fn score_rows(rows: &[Row], model: &ModelJson) -> Vec<ScoredRow> {
    rows.iter()
        .map(|row| {
            let raw_z: f64 = model.bias + row.features.iter().zip(model.weights.iter()).map(|(x, w)| x * w).sum::<f64>();
            let z = raw_z.clamp(-Z_CLAMP, Z_CLAMP);
            let probability = 1.0 / (1.0 + (-z).exp());
            let predicted = if probability >= 0.5 { 1 } else { 0 };
            ScoredRow { probability, predicted, label: row.label }
        })
        .collect()
}

pub fn accuracy(scored: &[ScoredRow]) -> f64 {
    let correct = scored.iter().filter(|r| r.predicted == r.label).count();
    correct as f64 / scored.len() as f64
}

pub fn f1(scored: &[ScoredRow]) -> f64 {
    let tp = scored.iter().filter(|r| r.predicted == 1 && r.label == 1).count() as f64;
    let fp = scored.iter().filter(|r| r.predicted == 1 && r.label == 0).count() as f64;
    let fn_ = scored.iter().filter(|r| r.predicted == 0 && r.label == 1).count() as f64;

    let precision = if tp + fp > 0.0 { tp / (tp + fp) } else { 0.0 };
    let recall = if tp + fn_ > 0.0 { tp / (tp + fn_) } else { 0.0 };
    if precision + recall > 0.0 {
        2.0 * precision * recall / (precision + recall)
    } else {
        0.0
    }
}

/// Rank-based AUC (Mann-Whitney U / Wilcoxon rank-sum), ties given the
/// average rank. Returns `None` if one class is absent (docs/03 B8) —
/// unreachable once `min_class_count` has been enforced, but handled
/// defensively since that invariant lives in a different module.
pub fn auc(scored: &[ScoredRow]) -> Option<f64> {
    let n_pos = scored.iter().filter(|r| r.label == 1).count();
    let n_neg = scored.iter().filter(|r| r.label == 0).count();
    if n_pos == 0 || n_neg == 0 {
        return None;
    }

    let mut indexed: Vec<(f64, u8)> = scored.iter().map(|r| (r.probability, r.label)).collect();
    indexed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    let mut ranks = vec![0.0; indexed.len()];
    let mut i = 0;
    while i < indexed.len() {
        let mut j = i;
        while j + 1 < indexed.len() && indexed[j + 1].0 == indexed[i].0 {
            j += 1;
        }
        // Ranks are 1-indexed; tied group gets the average of its range.
        let avg_rank = ((i + 1) + (j + 1)) as f64 / 2.0;
        for rank in ranks.iter_mut().take(j + 1).skip(i) {
            *rank = avg_rank;
        }
        i = j + 1;
    }

    let rank_sum_pos: f64 = indexed
        .iter()
        .zip(ranks.iter())
        .filter(|((_, label), _)| *label == 1)
        .map(|(_, rank)| *rank)
        .sum();

    let u = rank_sum_pos - (n_pos as f64 * (n_pos as f64 + 1.0)) / 2.0;
    Some(u / (n_pos as f64 * n_neg as f64))
}

pub fn round_to(value: f64, decimals: u32) -> f64 {
    let factor = 10f64.powi(decimals as i32);
    (value * factor).round() / factor
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dataset::Row;

    fn model(weights: Vec<f64>, bias: f64) -> ModelJson {
        ModelJson { features: weights.iter().enumerate().map(|(i, _)| format!("f{i}")).collect(), weights, bias }
    }

    #[test]
    fn ev_13_perfectly_separated_classes_score_auc_1_0() {
        let rows = vec![Row { features: vec![-10.0], label: 0 }, Row { features: vec![10.0], label: 1 }];
        let scored = score_rows(&rows, &model(vec![1.0], 0.0));
        assert_eq!(accuracy(&scored), 1.0);
        assert_eq!(f1(&scored), 1.0);
        assert!((auc(&scored).unwrap() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn ev_14_all_predictions_equal_scores_auc_0_50() {
        // Same feature value for both rows (z=0, p=0.5 for both) but different labels.
        let rows = vec![Row { features: vec![0.0], label: 0 }, Row { features: vec![0.0], label: 1 }];
        let scored = score_rows(&rows, &model(vec![1.0], 0.0));
        assert_eq!(accuracy(&scored), 0.5);
        assert!((auc(&scored).unwrap() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn ev_12_large_weights_clamp_z_without_nan_or_panic() {
        let rows = vec![Row { features: vec![1_000_000.0], label: 1 }];
        let scored = score_rows(&rows, &model(vec![1.0], 0.0));
        assert!(scored[0].probability.is_finite());
        assert_eq!(scored[0].probability, 1.0 / (1.0 + (-35f64).exp()));
    }

    #[test]
    fn ev_02_rounding_limits_metrics_to_the_configured_decimals() {
        let value = 0.123456789;
        assert_eq!(round_to(value, 2), 0.12);
        let s = format!("{}", round_to(value, 2));
        assert!(s.len() <= 4); // "0.12"
    }

    #[test]
    fn ev_04_scoring_the_same_input_twice_is_byte_identical() {
        let rows = vec![Row { features: vec![1.0, 2.0], label: 1 }, Row { features: vec![-1.0, 0.5], label: 0 }];
        let m = model(vec![0.3, -0.7], 0.1);
        let a = score_rows(&rows, &m);
        let b = score_rows(&rows, &m);
        assert_eq!(a[0].probability, b[0].probability);
        assert_eq!(a[1].probability, b[1].probability);
    }

    #[test]
    fn auc_is_none_when_one_class_is_absent() {
        let rows = vec![Row { features: vec![1.0], label: 1 }, Row { features: vec![2.0], label: 1 }];
        let scored = score_rows(&rows, &model(vec![1.0], 0.0));
        assert_eq!(auc(&scored), None);
    }
}
