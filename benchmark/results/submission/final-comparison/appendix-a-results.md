# Appendix A measured results

| Workload | Metric | UHS baseline | SD Express | Comparison |
|---|---:|---:|---:|---|
| Sequential read | MiB/s | 84.94 | 585.22 | 6.89x |
| 4 KiB random read | IOPS | 3125.55 | 70586.64 | 22.58x |
| 4 KiB random-read p95 | ms | 10.81 | 0.85 | Lower is better |
| Model cold load | s | 0.85 | 0.48 | 44.07% faster |
| 1,000-image ingest | images/s | 100.10 | 302.26 | 3.02x |
| Concurrent replay p50 | ms | 145.10 | 142.10 | Lower is better |
| Concurrent replay p95 | ms | 244.89 | 214.56 | Lower is better |
| History-read p95 during replay | ms | 0.22 | 0.27 | Lower is better |
| Sustained replay | operations/s | 6.63 | 6.58 | Higher is better |
| Peak Jetson temperature | °C | 58.75 | 58.97 | No thermal throttling |
| Median VDD_IN power | W | 9.89 | 9.88 | Reported, not optimised |

The measurements compare the complete tested deployment configurations. The Jetson operating system remained on the SD Express card in both scenarios; application data and model packages were placed first on the externally connected UHS card and then in a dedicated directory on SD Express. The cards differ in capacity and controller, and the UHS result includes its external reader interface.

Concurrent replay inference enabled: UHS=yes, SD Express=yes.
Recorded replay errors: UHS=0, SD Express=0; sustained errors: UHS=0, SD Express=0.

Raw fio, iostat, application replay, power and temperature logs are retained with SHA-256 receipts.
