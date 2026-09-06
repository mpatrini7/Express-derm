# Express-Derm storage benchmark

This directory provides the runner, summarizer, and measurement receipts for
comparing two real Express-Derm deployment scenarios:

1. Jetson OS on SD Express, with images and model packages on an externally
   connected UHS card.
2. Jetson OS on SD Express, with images and model packages in a dedicated
   directory on SD Express.

The result is an end-to-end configuration comparison. It is not an isolated
comparison of the SD standards because the cards have different capacities and
controllers, the UHS card uses an external reader, and SD Express also hosts the
operating system.

The completed measurements and their SHA-256 receipts are in
[`results/submission`](results/submission/). The report-ready table is
[`appendix-a-results.md`](results/submission/final-comparison/appendix-a-results.md).

## Safety

The runner refuses a target path unless its basename is exactly
`express-derm-benchmark`. `fio` is run only against a generated file below that
directory and never against `/dev/nvme*`, `/dev/mmcblk*` or another raw device.

After a successful run, generated test data are removed. Application data and
other files are never deleted. Pass `--keep-test-data` only when the generated
8 GiB test file and replay data should remain on the card.

## Jetson prerequisites

Install the two standard measurement packages:

```bash
sudo apt-get update
sudo apt-get install -y fio sysstat
```

`tegrastats` is normally supplied with JetPack. The runner records its absence
instead of fabricating power or temperature results.

Use the Python environment created by Express-Derm so that `onnxruntime` and
`numpy` are available. For example:

```bash
/home/mike/Desktop/Express-derm/.runtime/python/bin/python -c "import numpy, onnxruntime"
```

Adjust the path if the project created the environment elsewhere.

Before testing, record how each card is connected:

```bash
lsblk -o NAME,MODEL,SERIAL,SIZE,FSTYPE,MOUNTPOINTS,TRAN
findmnt
lspci -nn
```

Both targets should use the same filesystem and mount options where practical.
Do not reformat a card containing data. If the filesystems differ, retain that
difference in the report as a limitation.

Run the benchmark as the normal user, not with `sudo`. The runner requests sudo
only when Linux page caches must be cleared. Close Express-Derm and other
nonessential workloads before starting, select one Jetson power/fan profile,
and use the same profile for both cards. Start the second scenario only after
the reported temperatures have returned to approximately the first scenario's
starting range. Record ambient temperature in `--notes`.

## First run: UHS baseline

The UHS mount below is only an example. It must point to the actual mounted card.

```bash
sudo -v

./run_storage_benchmark.sh \
  --label uhs \
  --target-dir /media/mike/UHS/express-derm-benchmark \
  --image-dir /home/mike/Desktop/Express-derm/demo_images \
  --model-dir /home/mike/Desktop/Express-derm/models/express-derm-1 \
  --python /home/mike/Desktop/Express-derm/.runtime/python/bin/python \
  --output-dir /home/mike/Desktop/express-derm-benchmark-results \
  --notes "SanDisk Extreme PRO 256 GB; record reader model and interface here"
```

## Second run: SD Express

The dedicated directory is created on the existing SD Express root filesystem.

```bash
sudo -v

./run_storage_benchmark.sh \
  --label sd-express \
  --target-dir /home/mike/express-derm-benchmark \
  --image-dir /home/mike/Desktop/Express-derm/demo_images \
  --model-dir /home/mike/Desktop/Express-derm/models/express-derm-1 \
  --python /home/mike/Desktop/Express-derm/.runtime/python/bin/python \
  --output-dir /home/mike/Desktop/express-derm-benchmark-results \
  --notes "SD Express 512 GB; record exact card and interface here"
```

The normal protocol performs five repetitions, two 60-second `fio` workloads
per repetition, five model cold loads, five 1,000-image ingests, a two-minute
concurrent replay, and a 30-minute sustained replay. Active logs are written to
`/dev/shm` and copied to the result directory only after measurements finish.

The script asks `sudo` only for Linux cold-cache preparation. Do not use
`--no-drop-caches` for the final cold-load results.

## Quick validation

Before the final test, verify paths and dependencies with a short run:

```bash
./run_storage_benchmark.sh \
  --quick \
  --label uhs-check \
  --target-dir /mnt/express-uhs/express-derm-benchmark \
  --image-dir /home/mike/Desktop/Express-derm/demo_images \
  --model-dir /home/mike/Desktop/Express-derm/models/express-derm-1 \
  --python /home/mike/Desktop/Express-derm/.runtime/python/bin/python \
  --output-dir /home/mike/Desktop/express-derm-benchmark-results
```

Quick results are explicitly marked as unsuitable for the competition report.

## Generate the Appendix A comparison

Use the two result directories printed by the runner:

```bash
python3 summarize_storage_benchmarks.py \
  --uhs /path/to/uhs-result \
  --sd-express /path/to/sd-express-result \
  --output-dir /home/mike/Desktop/express-derm-benchmark-results/comparison
```

The comparison directory contains:

- `appendix-a-results.md`, ready to copy into the report;
- `comparison.csv` and `comparison.json`;
- `SHA256SUMS`;
- links back to the raw per-card receipts and logs.

Retain both raw result directories with the final report evidence.
