export const REPO = "https://github.com/hafidabid/secure-lambda402-server-api";
export const DOCS = `${REPO}/blob/main/docs/api/integration-guide.md`;
export const API_REFERENCE = `${REPO}/blob/main/docs/api/endpoint-reference.md`;
export const LIVE_RUN_TX = "https://testnet.nearblocks.io/txns/67fYJJtxNqFM33UeXMWfAvP5ELkp4vDZWnWfQMCJUkXj";

export const METRICS = [
  { label: "Accuracy", value: "0.86" },
  { label: "AUC", value: "0.91" },
  { label: "F1", value: "0.84" },
];

export const BEATS = [
  { title: "You’re building an AI model. You don’t have the data.", line: "To prove it works, you need real records. Patients, transactions, customers." },
  { title: "Someone has it. They can’t share it.", line: "A hospital’s records are protected by law. Sending them to you isn’t an option." },
  { title: "Now you can test on it anyway.", line: "Your model runs on their data inside a hardware enclave (a TEE): a sealed part of the chip that no one can look into. You get the score. Neither side sees the other’s file." },
]

export type UseCase = {
  industry: string;
  dataOwner: string;
  data: string;
  modelOwner: string;
  model: string;
  question: string;
  metric: string;
  value: string;
};

export const USE_CASES: UseCase[] = [
  {
    industry: "Healthcare",
    dataOwner: "A hospital",
    data: "Patient records",
    modelOwner: "A diagnostics startup",
    model: "Diabetes-risk model",
    question: "Does the model spot diabetes risk in our patients?",
    metric: "AUC",
    value: "0.90",
  },
  {
    industry: "Banking",
    dataOwner: "A bank",
    data: "Card transactions",
    modelOwner: "A fraud-detection vendor",
    model: "Fraud model",
    question: "Would it catch the fraud we actually see, before we buy it?",
    metric: "F1",
    value: "0.87",
  },
  {
    industry: "Lending",
    dataOwner: "A lender",
    data: "Five years of loans",
    modelOwner: "A credit-scoring startup",
    model: "Default-risk model",
    question: "Would it have predicted our past defaults?",
    metric: "AUC",
    value: "0.82",
  },
  {
    industry: "Telecom",
    dataOwner: "A mobile carrier",
    data: "Customer usage",
    modelOwner: "An analytics firm",
    model: "Churn model",
    question: "Can it tell which customers are about to leave?",
    metric: "Accuracy",
    value: "0.79",
  },
];

export const LOOP = [
  { label: "Find a dataset", from: "agent" },
  { label: "402 · price", from: "gateway" },
  { label: "Pay in NEAR", from: "agent" },
  { label: "Run in the enclave", from: "enclave" },
  { label: "Score: 0.84", from: "gateway" },
] as const;



export const FAQ = [
  {
    q: "Can SecureLambda see my data or my model?",
    a: "Your files are encrypted in your own browser before upload and are only opened inside the hardware enclave. The enclave’s key is set up once by us and our copy deleted, so you’re trusting that step. The next version has the enclave create its own key, so nobody ever holds it.",
  },
  {
    q: "What do I get back from a run?",
    a: "Three scores rounded to two decimals (accuracy, AUC and F1) and a rough row count. Never individual rows or predictions.",
  },
  {
    q: "What happens if a run fails?",
    a: "You aren’t charged. Payment is only taken after a run succeeds.",
  },
  {
    q: "Which models can I test?",
    a: "Logistic regression models exported as JSON, for yes-or-no predictions like fraud, churn or disease risk. More model types are planned.",
  },
  {
    q: "How do I pay?",
    a: "Per run, in NEAR. Pay from the dashboard with your wallet, or let your agent pay over x402.",
  },
  {
    q: "Is it live?",
    a: "Yes, on NEAR testnet. Paid runs work end to end: real payment, real scoring, real settlement.",
  },
];
