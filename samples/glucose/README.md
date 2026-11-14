# Glucose sample data

Synthetic data for trying the UI by hand (not real patient data).

| File | Use it as |
| --- | --- |
| `glucose.csv` | Seller: dataset upload (240 rows, columns `age,glucose,y`) |
| `glucose-schema.json` | Seller: listing schema (features `age` int, `glucose` float; label `y`) |
| `glucose-model.json` | Buyer: model upload (weights match the schema's feature order) |

Suggested listing rules: `min_rows` 100, `min_class_count` 20, metrics `accuracy`, `auc`, `f1`.

Regenerate with `node ops/gen-sample-data.mjs`. Verify with `cargo test --test sample_data` in `crates/evaluator`.
