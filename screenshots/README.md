# SecureLambda screenshots

A walk through the dashboard from both sides of the marketplace. **A buyer** tests a model on data they never see. **A seller** lists a dataset and gets paid per run.

> These were captured with the dashboard in **mock mode** (`npm run dev:mock` in `apps/dashboard`): no backend, no wallet and no testnet funds. The names, hashes, timestamps and scores are demo fixtures, not live records. For a real paid run with its NEAR transactions, see `docs/demo-cases.md`.

## Overview

| | |
|---|---|
| ![Landing](overview/01-landing.png) | **Landing.** "Test a model on data you never see." Only the score comes out. |
| ![Docs](overview/02-docs.png) | **In-app docs** at `/docs`. |

## Buyer: test a model on data you cannot see

Signed in as `medai.testnet`.

1. **Start guide** (`/start`). Sign in, pick a dataset, check `model.json`, encrypt and upload, then run once or hand it to an agent.
   ![Start guide](buyer/01-start-guide.png)
2. **Catalog** (`/listings`). Each dataset shows its price per run, the features it expects and the evaluator version.
   ![Catalog](buyer/02-catalog.png)
3. **Listing detail.** The schema (feature order and types), made-up sample rows, the evaluator build the data is locked to, and what leaves the evaluator: accuracy, AUC, F1 and a row range. A buyer is charged only when a score is delivered.
   ![Listing](buyer/03-listing-detail.png)
4. **Check the model on your device.** The `model.json` is read in the browser only. The page checks feature order and finite weights, and scores the sample rows locally.
   ![Model check](buyer/04-model-checked-on-device.png)
5. **Run it, payments off.** The model is now encrypted and locked to the evaluator. The price is shown, and the same run can be made from the agent SDK (snippet on the right).
   ![Run it](buyer/05-run-it-payments-off.png)
6. **Run it, payments on.** One wallet approval lets this tab sign run payments. It lasts only for this tab.
   ![Payments on](buyer/06-run-it-payments-on.png)
7. **Run in progress.** Authorised, then Paid, Attested and Result. The score tiles stay empty until the evaluator answers.
   ![In progress](buyer/07-run-in-progress.png)
8. **Result and receipt.** The score, the payment and run transaction links, the evaluator build, "Matches the build pinned by this listing", and "Attested by the enclave".
   ![Result](buyer/08-result-attested-receipt.png)

### Other buyer states

- **Failed run, never charged.** The model file could not be used (for example the feature order is wrong). Paid stays "Not charged" and the page offers "Try again".
  ![Failed](buyer/09-failed-run-not-charged.png)
- **Slow run.** The run is still executing. A slow run is a status, not a failure.
  ![Slow](buyer/10-slow-run-in-progress.png)

## Seller: list a dataset and get paid per run

Signed in as `hospital.testnet`. Selling needs an account the operator has enabled. If the operator's allow-list is empty, any signed-in account can sell.

1. **Sign in.** Connect a NEAR wallet, then sign a one-time message (no gas, nothing on-chain).
   ![Sign in](seller/01-sign-in.png)
2. **Describe.** Name the dataset and drop a CSV (`samples/glucose/glucose.csv`, 240 rows). The file is read on the device. The page shows the inferred schema and the label column.
   ![Describe](seller/02-describe-dataset.png)
3. **Sample rows.** Buyers see made-up rows that follow the schema, not copies of your data. You can regenerate them.
   ![Samples](seller/03-sample-rows.png)
4. **Price and limits.** Price per run in NEAR, score rounding, minimum rows, minimum rows per class, runs per buyer per day and a total per buyer. For the sample file the minimums were lowered to 200 rows and 50 per class, because the default of 500 rows is larger than the file.
   ![Price](seller/04-price-and-limits.png)
5. **Encrypt and upload.** The checks run on the device. The dataset is encrypted in the browser and locked to the evaluator build.
   ![Upload](seller/05-encrypt-and-upload.png)
6. **Publish.** A final summary: evaluator version, price, limits.
   ![Publish](seller/06-publish.png)
7. **Published.** The listing is live. From here you can see runs or open the listing.
   ![Published](seller/07-published.png)
8. **Runs on your data** (`/sell/runs`). Who ran a model and when, with the state of each run (settled, executing, queued, failed not charged, payment rejected). The seller never sees a buyer's model or score.
   ![Runs](seller/08-runs-on-your-data.png)

## Regenerating

```bash
cd apps/dashboard
npm run dev:mock                      # http://localhost:3001
# append ?as=hospital.testnet to sign in as a seller, and ?scenario=enclave|fail|slow|happy to pick a run outcome
```
