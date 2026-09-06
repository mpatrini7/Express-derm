# Measured storage results

These directories contain the complete reportable runs used for the Express-Derm
UHS-versus-SD-Express comparison:

- `uhs`: externally connected SanDisk Extreme PRO 256 GB,
  ext4, with five measurement repetitions;
- `sd-express`: 512 GB SD Express system card, ext4, with the
  same workload and five measurement repetitions;
- `final-comparison`: generated CSV, JSON, Markdown table, and SHA-256 receipt.

The Jetson remained in `MAXN_SUPER` mode. Both runs used the same image corpus,
model package, cache-preparation method, application environment, and benchmark
implementation. The operating system remained on SD Express in both scenarios,
so the result compares the complete deployed configurations rather than the SD
standards in isolation.

No workload errors were recorded, and inference remained enabled during both
concurrent and sustained replay. Hardware serial numbers were redacted before
publication and the two affected per-run receipt entries were regenerated. The
unaltered transfer archive is retained offline with SHA-256:

```text
a8b4a984ed201c6ca81fd9b6bf543a421d82a228153dd329cfad2b150925e06c
```

Start with
[`final-comparison/appendix-a-results.md`](final-comparison/appendix-a-results.md)
for the report-ready table. Each raw run includes `fio`, `iostat`, application
replay, power, temperature, environment, and model-load receipts.
