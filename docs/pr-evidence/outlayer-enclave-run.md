# OutLayer enclave run on NEAR testnet

A paid run served by the live testnet API with `EVALUATOR_MODE=outlayer`.

| Field | Value |
|---|---|
| Run | `run_d2f9a11c-a9b9-4e0d-ae65-68d134e9162d` |
| Listing | Heart failure readmission (`lst_dd799722…`) |
| Seller | `clinic.hafidbuild.testnet` |
| Buyer | `medai.hafidbuild.testnet` |
| Evaluator mode | `enclave` |
| State | `QUEUED → SUBMITTED → RESULT_READY → SETTLED` |
| Result | `accuracy 0.85` · `AUC 0.93` · `F1 0.75` · row bucket `500-999` |

## On-chain

| Step | Transaction | What it shows |
|---|---|---|
| Execution | [`2xfjVzdv…bApf`](https://testnet.nearblocks.io/txns/2xfjVzdvSchKEoPVLnLdttfoSNxxe34Ggf3SGkpUbApf) | `worker.hafidbuild.testnet` calls `request_execution` on `outlayer.testnet` (2026-11-14 17:33 UTC) |
| Settlement | [`DpXfGrYs…PyYY`](https://testnet.nearblocks.io/txns/DpXfGrYssCapGHDjjSbxN7uF3PDET6Wiu1X69BPHPyYY) | Relayer `irjenpro.testnet` submits the buyer's NEP-366 delegate: `ft_transfer` of 0.03 wNEAR on `wrap.testnet` to the seller, memo `n_823c0389-6f7a-4093-a6b3-2f8d9543d7d0` (2026-11-14 17:35 UTC) |

The settlement was submitted only after the result was ready, as the payment contract in the [README](../../README.md#payment-contract) describes.

## Trust limits

The worker checked the WASM hash OutLayer reported against the listing's pinned evaluator version. SecureLambda does not verify the Intel TDX quote itself, and the evaluator key is operator-generated (Tier 1). See [what is live and what is a prototype](../../README.md#what-is-live-and-what-is-a-prototype).
