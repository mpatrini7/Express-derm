import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  CircleAlert,
  ContactRound,
  List,
  LoaderCircle,
  MapPinned,
  Pencil,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { api } from "./api";
import { CreateLesionDialog } from "./components/CreateLesionDialog";
import { ClinicalPhotoBatch } from "./components/ClinicalPhotoBatch";
import { FollowUpQueue } from "./components/FollowUpQueue";
import { LesionDetailModal } from "./components/LesionDetailModal";
import { LesionPanel } from "./components/LesionPanel";
import { LesionTable } from "./components/LesionTable";
import { PatientProfileModal } from "./components/PatientProfileModal";
import { PatientRecordSummary } from "./components/PatientRecordSummary";
import { PatientSidebar } from "./components/PatientSidebar";
import { RepositionConfirmationDialog } from "./components/RepositionConfirmationDialog";
import type {
  Lesion,
  ClinicalPhotoCandidate,
  LesionEditableState,
  Patient,
  PatientProfileInput,
} from "./types";

type AppView = "patients" | "follow_up" | "patient";
type PatientRecordView = "bodymap" | "table";
type PatientListStatus = "loading" | "ready" | "error";
interface PendingReposition {
  lesion: Lesion;
  bodyPart: string;
  point: { x: number; y: number; z: number };
}
interface PendingLesionPlacement {
  bodyPart: string;
  point: { x: number; y: number; z: number };
}
interface PatientOpenError {
  patient: Patient;
  message: string;
}
interface PatientSummaryError {
  patientId: number;
  message: string;
}

const BodyMap3D = lazy(() =>
  import("./components/BodyMap3D").then((module) => ({
    default: module.BodyMap3D,
  })),
);

function BodyMapLoading() {
  return (
    <section
      className="bodymap panel bodymap-loading"
      aria-live="polite"
      aria-busy="true"
    >
      <div>
        <LoaderCircle aria-hidden="true" size={24} />
        <span>Loading 3D BodyMap</span>
      </div>
    </section>
  );
}

export default function App() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [lesions, setLesions] = useState<Lesion[]>([]);
  const [selectedLesion, setSelectedLesion] = useState<Lesion | null>(null);
  const [activeView, setActiveView] = useState<AppView>("patients");
  const [patientRecordView, setPatientRecordView] =
    useState<PatientRecordView>("bodymap");
  const [detailLesionId, setDetailLesionId] = useState<number | null>(null);
  const [repositioningLesionId, setRepositioningLesionId] =
    useState<number | null>(null);
  const [pendingReposition, setPendingReposition] =
    useState<PendingReposition | null>(null);
  const [pendingLesionPlacement, setPendingLesionPlacement] =
    useState<PendingLesionPlacement | null>(null);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [assigningCandidate, setAssigningCandidate] =
    useState<ClinicalPhotoCandidate | null>(null);
  const [clinicalQueueRevision, setClinicalQueueRevision] = useState(0);
  const [clinicalAssignmentMessage, setClinicalAssignmentMessage] = useState("");
  const [openingPatientId, setOpeningPatientId] = useState<number | null>(null);
  const [loadedPatientId, setLoadedPatientId] = useState<number | null>(null);
  const [patientListStatus, setPatientListStatus] =
    useState<PatientListStatus>("loading");
  const [patientListError, setPatientListError] = useState("");
  const [patientOpenError, setPatientOpenError] =
    useState<PatientOpenError | null>(null);
  const [patientSummaryError, setPatientSummaryError] =
    useState<PatientSummaryError | null>(null);
  const [profilePatient, setProfilePatient] =
    useState<Patient | "create" | null>(null);
  const patientListRevision = useRef(0);
  const patientOpenRevision = useRef(0);
  const patientSummaryRevisions = useRef(new Map<number, number>());
  const selectedPatientIdRef = useRef<number | null>(null);

  async function loadPatients() {
    const revision = patientListRevision.current + 1;
    patientListRevision.current = revision;
    setPatientListStatus("loading");
    setPatientListError("");
    try {
      const items = await api.listPatients();
      if (revision !== patientListRevision.current) return null;
      setPatients(items);
      setSelectedPatient((current) =>
        current ? items.find((item) => item.id === current.id) ?? null : null,
      );
      setPatientOpenError((current) => {
        if (!current) return null;
        const patient = items.find((item) => item.id === current.patient.id);
        return patient ? { ...current, patient } : null;
      });
      setPatientListStatus("ready");
      return items;
    } catch (reason) {
      if (revision !== patientListRevision.current) return null;
      const message =
        reason instanceof Error ? reason.message : "Unknown database error";
      setPatientListStatus("error");
      setPatientListError(message);
      return null;
    }
  }

  async function loadLesions(patient: Patient, revision: number) {
    const items = await api.listLesions(patient.id);
    if (
      revision !== patientOpenRevision.current ||
      selectedPatientIdRef.current !== patient.id
    ) {
      return false;
    }
    setLesions(items);
    setLoadedPatientId(patient.id);
    return true;
  }

  function invalidatePatientSummary(patientId: number) {
    const revision =
      (patientSummaryRevisions.current.get(patientId) ?? 0) + 1;
    patientSummaryRevisions.current.set(patientId, revision);
    setPatientSummaryError((current) =>
      current?.patientId === patientId ? null : current,
    );
    return revision;
  }

  async function refreshPatientSummary(patientId: number) {
    const revision = invalidatePatientSummary(patientId);
    try {
      const summary = await api.getPatient(patientId);
      if (patientSummaryRevisions.current.get(patientId) !== revision) {
        return false;
      }
      setPatients((items) =>
        items.map((item) => (item.id === summary.id ? summary : item)),
      );
      setSelectedPatient((current) =>
        current?.id === summary.id ? summary : current,
      );
      return true;
    } catch (reason) {
      if (patientSummaryRevisions.current.get(patientId) !== revision) {
        return false;
      }
      const message =
        reason instanceof Error ? reason.message : "Unknown refresh error";
      if (selectedPatientIdRef.current === patientId) {
        setPatientSummaryError({ patientId, message });
      }
      return false;
    }
  }

  async function refreshLesions() {
    if (!selectedPatient) return;
    const patientId = selectedPatient.id;
    const items = await api.listLesions(patientId);
    if (selectedPatientIdRef.current !== patientId) return;
    setLesions(items);
    setSelectedLesion((current) =>
      current ? items.find((item) => item.id === current.id) ?? null : null,
    );
    await refreshPatientSummary(patientId);
  }

  useEffect(() => {
    void loadPatients();
  }, []);

  async function createPatient(payload: PatientProfileInput) {
    const patient = await api.createPatient(payload);
    const refreshedPatients = await loadPatients();
    if (refreshedPatients === null) {
      setPatients((items) =>
        items.some((item) => item.id === patient.id)
          ? items.map((item) => (item.id === patient.id ? patient : item))
          : [patient, ...items],
      );
    }
    await selectPatient(patient);
  }

  async function updatePatient(
    patient: Patient,
    payload: PatientProfileInput,
  ) {
    const updated = await api.updatePatient(patient.id, payload);
    invalidatePatientSummary(patient.id);
    setPatients((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedPatient((current) =>
      current?.id === updated.id ? updated : current,
    );
    setPatientOpenError((current) =>
      current?.patient.id === updated.id
        ? { ...current, patient: updated }
        : current,
    );
  }

  function showPatients() {
    patientOpenRevision.current += 1;
    setOpeningPatientId(null);
    setPatientOpenError(null);
    setPatientSummaryError(null);
    setActiveView("patients");
    cancelMapping();
    void loadPatients();
  }

  function showFollowUp() {
    patientOpenRevision.current += 1;
    setOpeningPatientId(null);
    setPatientOpenError(null);
    setPatientSummaryError(null);
    setActiveView("follow_up");
    cancelMapping();
    void loadPatients();
  }

  async function selectPatient(patient: Patient) {
    const revision = patientOpenRevision.current + 1;
    patientOpenRevision.current = revision;
    selectedPatientIdRef.current = patient.id;
    setSelectedPatient(patient);
    setLoadedPatientId(null);
    setOpeningPatientId(patient.id);
    setLesions([]);
    setSelectedLesion(null);
    setDetailLesionId(null);
    setMappingBusy(false);
    cancelMapping();
    setPatientOpenError(null);
    setPatientSummaryError(null);
    try {
      if (!(await loadLesions(patient, revision))) return false;
      setPatientRecordView("bodymap");
      setActiveView("patient");
      return true;
    } catch (reason) {
      if (
        revision !== patientOpenRevision.current ||
        selectedPatientIdRef.current !== patient.id
      ) {
        return false;
      }
      const message =
        reason instanceof Error ? reason.message : "Unknown record error";
      setPatientOpenError({ patient, message });
      return false;
    } finally {
      if (revision === patientOpenRevision.current) {
        setOpeningPatientId(null);
      }
    }
  }

  async function deletePatient(patient: Patient) {
    await api.deletePatient(patient.id);
    invalidatePatientSummary(patient.id);
    setPatients((items) => items.filter((item) => item.id !== patient.id));
    if (selectedPatient?.id === patient.id) {
      patientOpenRevision.current += 1;
      selectedPatientIdRef.current = null;
      setSelectedPatient(null);
      setLoadedPatientId(null);
      setOpeningPatientId(null);
      setLesions([]);
      setSelectedLesion(null);
      setDetailLesionId(null);
      cancelMapping();
      setActiveView("patients");
    }
    if (profilePatient !== "create" && profilePatient?.id === patient.id) {
      setProfilePatient(null);
    }
    setPatientOpenError((current) =>
      current?.patient.id === patient.id ? null : current,
    );
  }

  async function deleteLesion(lesion: Lesion) {
    await api.deleteLesion(lesion.id);
    if (selectedPatientIdRef.current !== lesion.patient_id) {
      await refreshPatientSummary(lesion.patient_id);
      return;
    }
    setLesions((items) => items.filter((item) => item.id !== lesion.id));
    if (selectedLesion?.id === lesion.id) {
      setSelectedLesion(null);
    }
    if (detailLesionId === lesion.id) {
      setDetailLesionId(null);
    }
    if (repositioningLesionId === lesion.id) {
      cancelReposition();
    }
    await refreshPatientSummary(lesion.patient_id);
  }

  async function createPoint(
    bodyPart: string,
    point: { x: number; y: number; z: number },
  ) {
    if (!selectedPatient) return;
    if (assigningCandidate) {
      const patientId = selectedPatient.id;
      const candidate = assigningCandidate;
      let savedLesionCode: string | null = null;
      setMappingBusy(true);
      setClinicalAssignmentMessage("");
      try {
        const assignment = await api.assignClinicalPhotoCandidate(candidate.id, {
          body_part: bodyPart,
          ...point,
          label: `Photo candidate ${candidate.candidate_index}`,
        });
        savedLesionCode = assignment.lesion.lesion_code;
        if (selectedPatientIdRef.current !== patientId) return;
        setAssigningCandidate(null);
        setClinicalQueueRevision((value) => value + 1);
        setClinicalAssignmentMessage(
          `${assignment.lesion.lesion_code} created from the photo candidate.`,
        );
        try {
          const aiStatus = await api.aiStatus();
          if (aiStatus.ready) {
            await api.evaluateObservation(assignment.observation.id);
            setClinicalAssignmentMessage(
              `${assignment.lesion.lesion_code} created and experimental AI assessment saved.`,
            );
          }
        } catch (reason) {
          const detail = reason instanceof Error ? reason.message : "model unavailable";
          setClinicalAssignmentMessage(
            `${assignment.lesion.lesion_code} created. AI assessment unavailable: ${detail}`,
          );
        }
        await refreshLesions();
        const current = await api.getLesion(assignment.lesion.id);
        if (selectedPatientIdRef.current === patientId) setSelectedLesion(current);
      } catch (reason) {
        if (selectedPatientIdRef.current === patientId) {
          const detail = reason instanceof Error ? reason.message : "unknown error";
          setClinicalAssignmentMessage(
            savedLesionCode
              ? `${savedLesionCode} was created, but the record refresh failed: ${detail}`
              : `Candidate assignment failed: ${detail}`,
          );
        }
      } finally {
        if (selectedPatientIdRef.current === patientId) setMappingBusy(false);
      }
      return;
    }
    const repositioningLesion = lesions.find(
      (lesion) => lesion.id === repositioningLesionId,
    );
    if (repositioningLesion) {
      setPendingReposition({
        lesion: repositioningLesion,
        bodyPart,
        point,
      });
      return;
    }

    setPendingLesionPlacement({ bodyPart, point });
  }

  async function confirmLesionPlacement(label: string | null) {
    if (!pendingLesionPlacement || !selectedPatient) return;
    const patientId = selectedPatient.id;
    const { bodyPart, point } = pendingLesionPlacement;
    setMappingBusy(true);
    try {
      const lesion = await api.createLesion(patientId, {
        body_part: bodyPart,
        ...point,
        label,
      });
      if (selectedPatientIdRef.current !== patientId) {
        await refreshPatientSummary(patientId);
        return;
      }
      setLesions((items) => [...items, lesion]);
      setSelectedLesion(lesion);
      await refreshPatientSummary(patientId);
      setPendingLesionPlacement(null);
    } finally {
      if (selectedPatientIdRef.current === patientId) {
        setMappingBusy(false);
      }
    }
  }

  async function confirmReposition() {
    if (!pendingReposition) return;
    const { lesion, bodyPart, point } = pendingReposition;
    const patientId = lesion.patient_id;
    setMappingBusy(true);
    try {
      const updated = await api.updateLesion(lesion.id, {
        body_part: bodyPart,
        ...point,
        label: lesion.label,
        notes: lesion.notes,
        change_reason: "Manual BodyMap repositioning",
      });
      if (selectedPatientIdRef.current !== patientId) {
        await refreshPatientSummary(patientId);
        return;
      }
      replaceLesion(updated);
      setRepositioningLesionId(null);
      await refreshPatientSummary(patientId);
      setPendingReposition(null);
    } finally {
      if (selectedPatientIdRef.current === patientId) {
        setMappingBusy(false);
      }
    }
  }

  function cancelReposition() {
    setPendingReposition(null);
    setRepositioningLesionId(null);
  }

  function cancelMapping() {
    setPendingLesionPlacement(null);
    setAssigningCandidate(null);
    cancelReposition();
  }

  function replaceLesion(updated: Lesion) {
    setLesions((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedLesion((current) =>
      current?.id === updated.id ? updated : current,
    );
  }

  async function updateLesion(
    lesion: Lesion,
    values: LesionEditableState,
  ) {
    const updated = await api.updateLesion(lesion.id, values);
    if (selectedPatientIdRef.current === lesion.patient_id) {
      replaceLesion(updated);
    }
    await refreshPatientSummary(lesion.patient_id);
    return updated;
  }

  const detailLesion =
    detailLesionId === null
      ? null
      : lesions.find((lesion) => lesion.id === detailLesionId) ?? null;
  const repositioningLesion =
    repositioningLesionId === null
      ? null
      : lesions.find((lesion) => lesion.id === repositioningLesionId) ?? null;

  return (
    <main>
      <header className="app-header">
        <div className="app-brand">
          <p className="eyebrow">Offline edge prototype</p>
          <h1>Express-Derm</h1>
        </div>
        <nav className="app-nav" aria-label="Primary navigation">
          <button
            type="button"
            className={activeView === "patients" ? "nav-button active" : "nav-button"}
            aria-current={activeView === "patients" ? "page" : undefined}
            onClick={showPatients}
          >
            <UsersRound aria-hidden="true" size={17} strokeWidth={2} />
            Patients
          </button>
          <button
            type="button"
            className={
              activeView === "follow_up" ? "nav-button active" : "nav-button"
            }
            aria-current={activeView === "follow_up" ? "page" : undefined}
            onClick={showFollowUp}
          >
            <CalendarClock aria-hidden="true" size={17} strokeWidth={2} />
            Follow-up
          </button>
          <button
            type="button"
            className={activeView === "patient" ? "nav-button active" : "nav-button"}
            aria-current={activeView === "patient" ? "page" : undefined}
            disabled={
              !selectedPatient ||
              openingPatientId !== null ||
              loadedPatientId !== selectedPatient.id
            }
            title={
              openingPatientId !== null
                ? "Loading patient record"
                : selectedPatient &&
                    loadedPatientId === selectedPatient.id
                  ? "Open patient record"
                  : selectedPatient
                    ? "Patient record not loaded"
                    : "Select a patient first"
            }
            onClick={() => setActiveView("patient")}
          >
            <ContactRound aria-hidden="true" size={17} strokeWidth={2} />
            Patient
          </button>
        </nav>
        <div className="prototype-warning">
          Research prototype · Not for diagnosis
        </div>
      </header>

      {patientListError && (
        <div className="error-banner patient-data-error" role="alert">
          <CircleAlert aria-hidden="true" size={20} strokeWidth={2} />
          <div>
            <strong>Patient list could not be refreshed</strong>
            <span>{patientListError}</span>
          </div>
          <button
            type="button"
            className="patient-data-retry"
            onClick={() => void loadPatients()}
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      {patientOpenError && (
        <div className="error-banner patient-data-error" role="alert">
          <CircleAlert aria-hidden="true" size={20} strokeWidth={2} />
          <div>
            <strong>Patient record could not be opened</strong>
            <span>
              {patientOpenError.patient.patient_code}: {patientOpenError.message}
            </span>
          </div>
          <button
            type="button"
            className="patient-data-retry"
            onClick={() => void selectPatient(patientOpenError.patient)}
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      {patientSummaryError &&
        activeView === "patient" &&
        selectedPatient?.id === patientSummaryError.patientId && (
          <div className="error-banner patient-data-error" role="alert">
            <CircleAlert aria-hidden="true" size={20} strokeWidth={2} />
            <div>
              <strong>Patient summary could not be refreshed</strong>
              <span>{patientSummaryError.message}</span>
            </div>
            <button
              type="button"
              className="patient-data-retry"
              onClick={() =>
                void refreshPatientSummary(patientSummaryError.patientId)
              }
            >
              <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
              Retry
            </button>
          </div>
        )}

      {activeView === "patients" ? (
        <div className="patient-workspace">
          <PatientSidebar
            patients={patients}
            selectedId={selectedPatient?.id ?? null}
            openingId={openingPatientId}
            loading={patientListStatus === "loading"}
            unavailable={
              patientListStatus === "error" && patients.length === 0
            }
            onSelect={(patient) => {
              void selectPatient(patient);
            }}
            onCreate={() => setProfilePatient("create")}
            onDelete={deletePatient}
          />
        </div>
      ) : activeView === "follow_up" ? (
        <div className="patient-workspace">
          <FollowUpQueue
            patients={patients}
            openingId={openingPatientId}
            loading={patientListStatus === "loading"}
            unavailable={
              patientListStatus === "error" && patients.length === 0
            }
            onOpen={(patient) => {
              void selectPatient(patient);
            }}
          />
        </div>
      ) : selectedPatient ? (
        <div className="patient-record-workspace">
          <header className="patient-record-header">
            <div className="patient-record-identity">
              <p className="eyebrow">Patient record</p>
              <div className="patient-record-title-row">
                <h2>
                  {selectedPatient.display_name || selectedPatient.patient_code}
                </h2>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Edit patient ${selectedPatient.patient_code}`}
                  title="Edit patient profile"
                  onClick={() => setProfilePatient(selectedPatient)}
                >
                  <Pencil aria-hidden="true" size={16} />
                </button>
              </div>
              <div className="patient-record-meta">
                <span>{selectedPatient.patient_code}</span>
                {selectedPatient.birth_year && (
                  <span>Birth year {selectedPatient.birth_year}</span>
                )}
              </div>
              {selectedPatient.notes && (
                <p className="patient-record-note">{selectedPatient.notes}</p>
              )}
            </div>
            <PatientRecordSummary patient={selectedPatient} />
            <div className="record-view-tabs" role="tablist" aria-label="Patient views">
              <button
                type="button"
                role="tab"
                aria-selected={patientRecordView === "bodymap"}
                className={patientRecordView === "bodymap" ? "active" : ""}
                onClick={() => setPatientRecordView("bodymap")}
              >
                <MapPinned aria-hidden="true" size={17} />
                BodyMap
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={patientRecordView === "table"}
                className={patientRecordView === "table" ? "active" : ""}
                onClick={() => {
                  cancelMapping();
                  setPatientRecordView("table");
                }}
              >
                <List aria-hidden="true" size={17} />
                Lesion table
              </button>
            </div>
          </header>

          {patientRecordView === "bodymap" ? (
            <>
              <ClinicalPhotoBatch
                patientId={selectedPatient.id}
                selectedCandidate={assigningCandidate}
                revision={clinicalQueueRevision}
                assignmentMessage={clinicalAssignmentMessage}
                onAssignRequested={(candidate) => {
                  setClinicalAssignmentMessage("");
                  setPendingLesionPlacement(null);
                  cancelReposition();
                  setAssigningCandidate(candidate);
                }}
                onCancelAssignment={() => setAssigningCandidate(null)}
              />
              <div className="workspace-grid patient-record-grid">
              <Suspense fallback={<BodyMapLoading />}>
                <BodyMap3D
                  lesions={lesions}
                  selectedLesionId={selectedLesion?.id ?? null}
                  disabled={false}
                  busy={mappingBusy}
                  repositioningLesion={repositioningLesion}
                  onCreatePoint={createPoint}
                  onSelectLesion={(lesion) => {
                    if (repositioningLesionId === null) {
                      setSelectedLesion(lesion);
                    }
                  }}
                  onCancelReposition={cancelReposition}
                />
              </Suspense>

              <LesionPanel
                patient={selectedPatient}
                lesions={lesions}
                selectedLesion={selectedLesion}
                onSelectLesion={setSelectedLesion}
                onOpenLesion={(lesion) => {
                  setSelectedLesion(lesion);
                  setDetailLesionId(lesion.id);
                }}
                onDeleteLesion={deleteLesion}
                onLesionChanged={refreshLesions}
                onUpdateLesion={updateLesion}
                repositioningLesionId={repositioningLesionId}
                onStartReposition={(lesion) => {
                  setAssigningCandidate(null);
                  setSelectedLesion(lesion);
                  setPendingLesionPlacement(null);
                  setPendingReposition(null);
                  setRepositioningLesionId(lesion.id);
                }}
                onCancelReposition={cancelReposition}
              />
              </div>
            </>
          ) : (
            <LesionTable
              lesions={lesions}
              onOpen={(lesion) => {
                setSelectedLesion(lesion);
                setDetailLesionId(lesion.id);
              }}
              onDelete={deleteLesion}
            />
          )}

          {detailLesion && (
            <LesionDetailModal
              key={detailLesion.id}
              lesion={detailLesion}
              onClose={() => setDetailLesionId(null)}
              onChanged={refreshLesions}
            />
          )}
        </div>
      ) : (
        <div className="empty-state">
          <p>Select a patient to open the record.</p>
        </div>
      )}

      {profilePatient && (
        <PatientProfileModal
          patient={profilePatient === "create" ? null : profilePatient}
          onClose={() => setProfilePatient(null)}
          onSubmit={(payload) =>
            profilePatient === "create"
              ? createPatient(payload)
              : updatePatient(profilePatient, payload)
          }
        />
      )}

      {pendingLesionPlacement && (
        <CreateLesionDialog
          bodyPart={pendingLesionPlacement.bodyPart}
          onCancel={() => setPendingLesionPlacement(null)}
          onConfirm={confirmLesionPlacement}
        />
      )}

      {pendingReposition && (
        <RepositionConfirmationDialog
          lesionCode={pendingReposition.lesion.lesion_code}
          currentBodyPart={pendingReposition.lesion.body_part}
          proposedBodyPart={pendingReposition.bodyPart}
          onCancel={() => setPendingReposition(null)}
          onConfirm={confirmReposition}
        />
      )}
    </main>
  );
}
