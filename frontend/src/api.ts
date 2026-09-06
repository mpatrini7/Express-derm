import type {
  AIStatus,
  AcquisitionSetup,
  AcquisitionSetupUpdate,
  CameraDevice,
  CameraMode,
  ClinicalPhoto,
  ClinicalPhotoCandidate,
  ClinicalPhotoCandidateAssignment,
  Lesion,
  LesionAuditEvent,
  LesionEditableState,
  LongitudinalReview,
  LongitudinalReviewCreate,
  ModelRun,
  Observation,
  Patient,
  PatientProfileInput,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : detail?.reason ?? detail?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  listPatients: () => request<Patient[]>("/api/patients"),

  getPatient: (patientId: number) =>
    request<Patient>(`/api/patients/${patientId}`),

  createPatient: (payload: PatientProfileInput) =>
    request<Patient>("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  updatePatient: (patientId: number, payload: PatientProfileInput) =>
    request<Patient>(`/api/patients/${patientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  deletePatient: (patientId: number) =>
    request<void>(`/api/patients/${patientId}`, { method: "DELETE" }),

  listLesions: (patientId: number) =>
    request<Lesion[]>(`/api/patients/${patientId}/lesions`),

  getLesion: (lesionId: number) =>
    request<Lesion>(`/api/lesions/${lesionId}`),

  createLesion: (
    patientId: number,
    payload: {
      body_part: string;
      x: number;
      y: number;
      z: number;
      label?: string | null;
    },
  ) =>
    request<Lesion>(`/api/patients/${patientId}/lesions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  updateLesion: (
    lesionId: number,
    payload: LesionEditableState & { change_reason?: string },
  ) =>
    request<Lesion>(`/api/lesions/${lesionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  listLesionAuditEvents: (lesionId: number) =>
    request<LesionAuditEvent[]>(
      `/api/lesions/${lesionId}/audit-events`,
    ),

  deleteLesion: (lesionId: number) =>
    request<void>(`/api/lesions/${lesionId}`, { method: "DELETE" }),

  listObservations: (lesionId: number) =>
    request<Observation[]>(`/api/lesions/${lesionId}/observations`),

  deleteObservation: (observationId: number) =>
    request<void>(`/api/observations/${observationId}`, {
      method: "DELETE",
    }),

  listClinicalPhotoCandidates: (patientId: number) =>
    request<ClinicalPhotoCandidate[]>(
      `/api/patients/${patientId}/clinical-photo-candidates`,
    ),

  uploadClinicalPhoto: (patientId: number, file: File) => {
    const data = new FormData();
    data.append("file", file);
    data.append("source_confirmed", "true");
    return request<ClinicalPhoto>(
      `/api/patients/${patientId}/clinical-photos`,
      { method: "POST", body: data },
    );
  },

  dismissClinicalPhotoCandidate: (candidateId: number) =>
    request<ClinicalPhotoCandidate>(
      `/api/clinical-photo-candidates/${candidateId}/dismiss`,
      { method: "POST" },
    ),

  assignClinicalPhotoCandidate: (
    candidateId: number,
    payload: {
      body_part: string;
      x: number;
      y: number;
      z: number;
      label?: string | null;
    },
  ) =>
    request<ClinicalPhotoCandidateAssignment>(
      `/api/clinical-photo-candidates/${candidateId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),

  listLongitudinalReviews: (lesionId: number) =>
    request<LongitudinalReview[]>(
      `/api/lesions/${lesionId}/longitudinal-reviews`,
    ),

  createLongitudinalReview: (
    lesionId: number,
    payload: LongitudinalReviewCreate,
  ) =>
    request<LongitudinalReview>(
      `/api/lesions/${lesionId}/longitudinal-reviews`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),

  uploadObservation: async (
    lesionId: number,
    file: File,
    notes: string,
    microscopeSourceConfirmed: boolean,
  ) => {
    const data = new FormData();
    data.append("file", file);
    data.append("notes", notes);
    data.append("source_type", "microscope");
    data.append(
      "microscope_source_confirmed",
      String(microscopeSourceConfirmed),
    );
    return request<Observation>(
      `/api/lesions/${lesionId}/observations/upload`,
      { method: "POST", body: data },
    );
  },

  listCameraDevices: () => request<CameraDevice[]>("/api/camera/devices"),

  captureSnapshot: (
    lesionId: number,
    device: string,
    mode: CameraMode | null,
  ) => {
    const params = new URLSearchParams({ device });
    if (mode) {
      params.set("width", String(mode.width));
      params.set("height", String(mode.height));
      params.set("pixel_format", mode.pixel_format);
      if (mode.fps.length) {
        params.set("frame_rate", String(Math.max(...mode.fps)));
      }
    }
    return request<Observation>(
      `/api/camera/snapshot/${lesionId}?${params.toString()}`,
      { method: "POST" },
    );
  },

  getAcquisitionSetup: () =>
    request<AcquisitionSetup>("/api/acquisition/setup"),

  updateAcquisitionSetup: (payload: AcquisitionSetupUpdate) =>
    request<AcquisitionSetup>("/api/acquisition/setup", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  uploadAcquisitionReference: (
    referenceType: "scale" | "color",
    file: File,
  ) => {
    const data = new FormData();
    data.append("file", file);
    return request<AcquisitionSetup>(
      `/api/acquisition/setup/references/${referenceType}`,
      { method: "POST", body: data },
    );
  },

  aiStatus: () => request<AIStatus>("/api/ai/status"),

  listEvaluations: (observationId: number) =>
    request<ModelRun[]>(
      `/api/ai/observations/${observationId}/evaluations`,
    ),

  evaluateObservation: (observationId: number) =>
    request<ModelRun>(
      `/api/ai/observations/${observationId}/evaluate`,
      { method: "POST" },
    ),
};
