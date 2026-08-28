# Retrieval gate

`golden.csv` is the 40 Nimbus questions from rag-eval-harness.
`baseline.json` is the lexical means from title-boosted top-3 retrieval.

CI starts the app, calls `POST /api/eval`, and fails if any mean drops more than 0.05 versus that baseline.
