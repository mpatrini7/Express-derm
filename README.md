# Express-Derm

Local-first body mapping and HD/4K photo workflow for skin-lesion follow-up.
The application runs without a login, cloud account, or remote database.

> **Research prototype:** Express-Derm is not a diagnostic device. The included
> model starts automatically but remains experimental and must not be used to
> claim that a lesion is benign, malignant, or safe.

## What is included

- React, TypeScript, Three.js, and a local 3D body model.
- FastAPI, SQLAlchemy, Alembic, and local SQLite/filesystem storage.
- Persistent patients, lesion markers, accepted image observations, and
  longitudinal comparisons.
- HD/4K photo upload with automatic multi-lesion candidate proposals.
- A persistent candidate queue: confirm each proposed crop on the 3D BodyMap
  or dismiss it without creating a lesion.
- Legacy wired UVC/V4L2 single-lesion acquisition remains available.
- Image-quality scoring from 0 to 100% for focus, exposure and clipping, both
  for the complete photo and every proposed lesion crop. New images below 50%
  are discarded before any database record or image file is created.
- Automatic experimental follow-up reminders derived from saved attention
  results, without rewriting model history.
- Two EfficientNet-B0 ONNX research models: melanoma attention and broad
  BCC/SCC/AK attention.
- A deterministic three-view consensus with `No elevated signal`, `Review`,
  and `High confirmed`; both models must agree before the strongest result.
- A 30-image, attributed challenge fixture covering the three experimental UI
  result states.
- Optional ONNX Runtime development inference.
- Optional TensorRT C++ worker source for compatible Linux/NVIDIA GPU systems.
- Backend, frontend, and TypeScript verification suites.

No training datasets, patient data, Python environments, Node packages, or
generated SQLite databases are committed.

## Quick start

Prerequisites:

- Python 3.11 or newer with virtual-environment support;
- Node.js 20 LTS or newer and npm;
- GNU Make.

On Debian or Ubuntu, install virtual-environment support once if it is not
already available:

~~~bash
sudo apt update
sudo apt install python3-venv
~~~

Start the complete application with the included AI model enabled:

~~~bash
git clone https://github.com/mpatrini7/Express-derm.git
cd Express-derm
make start
~~~

The first run automatically creates a project-managed Python environment,
installs `requirements.txt`, installs the locked frontend packages, verifies the
included model, and starts both services. It never installs Python packages into
the operating-system interpreter, so it remains compatible with PEP 668. Do not
use `sudo pip` or `--break-system-packages`.

Open:

- frontend: <http://127.0.0.1:5173>
- backend health: <http://127.0.0.1:8000/api/health>

Press **Ctrl+C** to stop the services started by the launcher.

All local records and accepted images are written below **backend/data/**, which
is excluded from Git. Back up that directory before moving or upgrading an
installation.

## Recommended HD/4K workflow

1. Open or create a patient.
2. In **HD / 4K multi-lesion photo**, upload a clear JPEG, PNG, or WebP image.
3. Express-Derm saves the original, scores its quality, and proposes up to 30
   separate lesion crops.
4. Inspect every crop. Choose **Assign on BodyMap**, then click its anatomical
   location on the 3D body; or dismiss the proposal.
5. Assignment creates the persistent lesion and its first observation together.
   When the included research model is ready, its experimental assessment is
   started automatically.

Use diffuse, even light; keep the camera parallel to the skin; avoid digital
zoom; and include enough surrounding skin to distinguish the lesion boundary.
Images scoring exactly 50% or more are retained; images and individual crops
below 50% are discarded automatically. Existing historical images are not
deleted retroactively. Candidate detection may miss lesions or propose
non-lesion skin features and therefore always requires operator confirmation.
The pending queue is ordered from highest to lowest photo quality. **Visual
prominence** describes only how strongly a proposed region stands out by local
contrast and compact shape; it is not AI confidence, medical risk, or evidence
that the region is a lesion.

## Demo challenge images

The attributed challenge fixture is available directly in:

~~~text
demo_images/
~~~

It contains 30 CC0 ISIC images selected against the immutable melanoma
component to demonstrate its historical `Low`, `Inconclusive`, and `High`
outputs. It is retained as a component regression fixture, not an estimate of
the new combined policy, accuracy, or clinical validation. Verify its
manifests, hashes, quality measurements, and stable recorded outputs with:

~~~bash
make demo-check
~~~

## Included research AI

The included runtime package is:

~~~text
models/express-derm-1/
~~~

The package contains two independently verified ONNX graphs:

~~~text
melanoma attention: f47087ac224641740f7af18b4d112b460d7905cd37dc90f0b9fce707a5a106be
broad attention:    abc037a089b38ed01bd6823b9ad20cbf53a24d7c410954efc271f354c03c5ff2
dual bundle:        f6a516b94d98783878378fe5d3be6c0afc4d493317a14b42f0e2fa862988afcc
~~~

For every accepted image, each graph evaluates the original image plus 90% and
80% center crops. `High confirmed` requires all three melanoma views to be high
and all three broad views to exceed the validation-frozen 99%-specificity
confirmation threshold. Any disagreement becomes `Review`; `No elevated
signal` is exposed only when both models and all views support low. These are
attention states, never diagnoses or claims that a lesion is safe.

The normal startup loads both ONNX Runtime sessions and verifies every model
hash plus the combined policy receipt:

~~~bash
make start
~~~

The compatibility alias `make start-research-ai` starts the same configuration.
Startup stops with an error if the model package or ONNX Runtime is unavailable.
The enabled research override does not validate the thresholds or the camera
photo domain. Inference is limited to operator-confirmed, decodable lesion
observations. A low image-quality score remains attached to the observation and
model-run receipt as a warning; it does not silently replace or promote the
experimental result. Any acquisition-protocol state is retained as context but
does not promote the experimental result.

To run without AI only when explicitly required for maintenance:

~~~bash
EXPRESS_DERM_AI_ENABLED=false make start
~~~

## Legacy single-lesion camera development

The previous wired UVC/V4L2 path remains available as a fallback. On Linux,
inspect a connected UVC device with:

~~~bash
./scripts/check_microscope.sh
~~~

Live capture samples up to 12 frames and selects the one with the best quality
score. Manual uploads and live captures below 50% are discarded without a file
or observation record. At 50% or above, the image is saved with its 0–100%
score and specific acquisition warnings beside the experimental AI result.

For interface development without hardware:

~~~bash
EXPRESS_DERM_CAMERA_MOCK=true make start
~~~

Mock-camera output is provisional and cannot establish image-domain compatibility.

## C++/TensorRT research source

The included C++ worker remains a single-model research implementation and does
not implement the dual confirmation policy. It must not be selected for the
current bundle. `make start` and `make start-gpu` both use the complete ONNX
Runtime implementation; the latter automatically selects CUDA when ONNX
Runtime exposes it.

For continued single-model runtime research, an engine can still be built on a
compatible Linux/NVIDIA GPU system:

~~~bash
./scripts/build_tensorrt_engine.sh \
  models/express-derm-1/model.onnx \
  /tmp/express-derm-model.engine

./scripts/build_cpp_ai_worker.sh
~~~

The included ONNX graph has a fixed `1x3x224x224` input. Pass the optional
third argument to the engine builder only for an explicitly dynamic square
`image` input.

Engine registration alone does not authorize combined inference. A future C++
runtime must execute both graphs, reproduce all six calibrated view outputs,
and pass parity against `dual-center-scale-confirmation-v1` before it can
replace the ONNX Runtime adapter.

## Verification

~~~bash
make check
~~~

This runs backend tests, frontend tests, and the TypeScript compiler. The test
database and image files are created in isolated temporary directories.

## Storage benchmark

The reproducible UHS-versus-SD-Express runner, raw Jetson measurement receipts,
and report-ready comparison are available in [`benchmark/`](benchmark/README.md).
The committed hardware identifiers are redacted; measurements, environment
metadata, and public receipt hashes are retained.

## Architecture

~~~text
Browser UI
   |
   v
Local FastAPI API -- SQLite + originals, crops, and lesion observations
   |
   +-- ONNX Runtime adapter + two-model center-scale consensus (default)
   +-- AI disabled only by explicit override
   +-- single-model TensorRT C++ worker source (research only)
~~~

The 3D marker stores location only. A multi-lesion photo first creates editable
candidate crops; only an operator-assigned crop becomes a lesion observation and
can reach the experimental AI. The model is not clinically validated for this
camera-photo domain, and no output is a diagnosis or proof that a lesion is safe.
