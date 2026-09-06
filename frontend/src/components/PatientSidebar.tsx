import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpDown,
  Database,
  LoaderCircle,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { formatAttention, formatDate } from "../risk";
import type { Patient } from "../types";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";

interface Props {
  patients: Patient[];
  selectedId: number | null;
  openingId: number | null;
  loading?: boolean;
  unavailable?: boolean;
  onSelect: (patient: Patient) => void;
  onCreate: () => void;
  onDelete: (patient: Patient) => Promise<void>;
}

const statusLabels: Record<Patient["record_status"], string> = {
  not_mapped: "Not mapped",
  needs_capture: "Capture needed",
  documented: "Documented",
};

type PatientStatusFilter = "all" | Patient["record_status"];
type PatientSort = "recent" | "next_check" | "code";

const statusFilters: Array<{
  value: PatientStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "not_mapped", label: "Not mapped" },
  { value: "needs_capture", label: "Capture needed" },
  { value: "documented", label: "Documented" },
];

function dateValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function PatientSidebar({
  patients,
  selectedId,
  openingId,
  loading = false,
  unavailable = false,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Patient | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<PatientStatusFilter>("all");
  const [sort, setSort] = useState<PatientSort>("recent");

  const visiblePatients = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = patients.filter((patient) => {
      const matchesQuery =
        !normalizedQuery ||
        patient.patient_code.toLocaleLowerCase().includes(normalizedQuery) ||
        patient.display_name
          ?.toLocaleLowerCase()
          .includes(normalizedQuery) ||
        String(patient.birth_year ?? "").includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || patient.record_status === statusFilter;
      return matchesQuery && matchesStatus;
    });

    return [...filtered].sort((left, right) => {
      if (sort === "code") {
        return left.patient_code.localeCompare(right.patient_code, undefined, {
          numeric: true,
        });
      }

      if (sort === "next_check") {
        const leftCheck = dateValue(left.next_check_at);
        const rightCheck = dateValue(right.next_check_at);
        if (leftCheck === null && rightCheck !== null) return 1;
        if (leftCheck !== null && rightCheck === null) return -1;
        if (leftCheck !== null && rightCheck !== null && leftCheck !== rightCheck) {
          return leftCheck - rightCheck;
        }
      } else {
        const leftActivity = dateValue(left.last_activity_at) ?? 0;
        const rightActivity = dateValue(right.last_activity_at) ?? 0;
        if (leftActivity !== rightActivity) return rightActivity - leftActivity;
      }

      return left.patient_code.localeCompare(right.patient_code, undefined, {
        numeric: true,
      });
    });
  }, [patients, query, sort, statusFilter]);

  const filtersActive = query.trim() !== "" || statusFilter !== "all";

  async function remove(patient: Patient) {
    setDeletingId(patient.id);
    try {
      await onDelete(patient);
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section
      className="panel patient-panel patient-directory"
      aria-busy={loading}
    >
      <div className="panel-heading row-between">
        <div>
          <p className="eyebrow">Local database</p>
          <h2>Patients</h2>
        </div>
        <div className="patient-directory-actions">
          <span
            className={
              loading
                ? "status-chip loading"
                : unavailable
                  ? "status-chip unavailable"
                  : "status-chip"
            }
            aria-live="polite"
          >
            {loading ? (
              <>
                <LoaderCircle aria-hidden="true" size={15} strokeWidth={2} />
                {patients.length === 0 ? "Loading" : "Refreshing"}
              </>
            ) : unavailable ? (
              "Unavailable"
            ) : visiblePatients.length === patients.length ? (
              `${patients.length} ${
                patients.length === 1 ? "record" : "records"
              }`
            ) : (
              `${visiblePatients.length} of ${patients.length}`
            )}
          </span>
          <button
            className="create-patient-button"
            type="button"
            disabled={
              openingId !== null ||
              (loading && patients.length === 0) ||
              unavailable
            }
            onClick={onCreate}
          >
            <UserPlus aria-hidden="true" size={17} strokeWidth={2} />
            New patient
          </button>
        </div>
      </div>

      {patients.length > 0 && (
        <div className="patient-directory-toolbar">
          <div className="patient-search">
            <label className="sr-only" htmlFor="patient-search-input">
              Search patients
            </label>
            <Search aria-hidden="true" size={17} strokeWidth={2} />
            <input
              id="patient-search-input"
              type="search"
              value={query}
              placeholder="Search code, label, or birth year"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear patient search"
                title="Clear search"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            )}
          </div>

          <label className="patient-sort">
            <span>
              <ArrowUpDown aria-hidden="true" size={15} strokeWidth={2} />
              Sort
            </span>
            <select
              aria-label="Sort patients"
              value={sort}
              onChange={(event) => setSort(event.target.value as PatientSort)}
            >
              <option value="recent">Recently updated</option>
              <option value="next_check">Next check</option>
              <option value="code">Patient code</option>
            </select>
          </label>

          <div className="patient-status-filter">
            <span id="patient-status-filter-label">Workflow</span>
            <div
              className="segmented-filter"
              role="group"
              aria-labelledby="patient-status-filter-label"
            >
              {statusFilters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={statusFilter === filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="patient-list" aria-label="Patient list">
        {patients.length === 0 && loading && (
          <div
            className="empty-state patient-empty patient-data-state"
            role="status"
          >
            <LoaderCircle aria-hidden="true" size={22} strokeWidth={2} />
            <p>Loading local patient records.</p>
          </div>
        )}
        {patients.length === 0 && !loading && unavailable && (
          <div className="empty-state patient-empty patient-data-state">
            <Database aria-hidden="true" size={22} strokeWidth={2} />
            <p>Patient data is unavailable.</p>
          </div>
        )}
        {patients.length === 0 && !loading && !unavailable && (
          <div className="empty-state patient-empty">
            <p>No patients saved.</p>
          </div>
        )}
        {patients.length > 0 && visiblePatients.length === 0 && (
          <div className="empty-state patient-empty">
            <p>No matching patients.</p>
            <button
              type="button"
              className="secondary"
              disabled={!filtersActive}
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        {visiblePatients.map((patient) => (
          <div className="entity-row" key={patient.id}>
            <button
              type="button"
              className={
                selectedId === patient.id ? "patient active" : "patient"
              }
              aria-busy={openingId === patient.id}
              onClick={() => onSelect(patient)}
              disabled={
                deletingId === patient.id || openingId === patient.id
              }
            >
              <div className="patient-identity">
                <div>
                  <strong>{patient.patient_code}</strong>
                  <span>{patient.display_name || "No display label"}</span>
                  {patient.birth_year && (
                    <small>Birth year {patient.birth_year}</small>
                  )}
                </div>
                <span className={`record-status ${patient.record_status}`}>
                  {statusLabels[patient.record_status]}
                </span>
              </div>
              <div className="patient-metrics">
                <div>
                  <span>Mapped lesions</span>
                  <strong>{patient.mapped_lesions}</strong>
                </div>
                <div>
                  <span>With accepted capture</span>
                  <strong>
                    {patient.documented_lesions}/{patient.mapped_lesions}
                  </strong>
                </div>
                <div>
                  <span>Highest AI risk factor</span>
                  <strong>
                    {formatAttention(
                      patient.highest_attention_level,
                      patient.attention_status,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Last update</span>
                  <strong>{formatDate(patient.last_activity_at)}</strong>
                </div>
                <div>
                  <span>Next check</span>
                  <strong>{formatDate(patient.next_check_at)}</strong>
                </div>
              </div>
              {openingId === patient.id ? (
                <>
                  <LoaderCircle
                    className="patient-open-icon patient-loading-icon"
                    aria-hidden="true"
                    size={19}
                    strokeWidth={2}
                  />
                  <span className="sr-only">Loading patient record</span>
                </>
              ) : (
                <ArrowRight
                  className="patient-open-icon"
                  aria-hidden="true"
                  size={19}
                  strokeWidth={2}
                />
              )}
            </button>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Delete patient ${patient.patient_code}`}
              title={`Delete patient ${patient.patient_code}`}
              disabled={deletingId !== null || openingId !== null}
              onClick={() => setPendingDelete(patient)}
            >
              <Trash2 aria-hidden="true" size={17} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      {pendingDelete && (
        <DeleteConfirmationDialog
          title={`Delete patient ${pendingDelete.patient_code}?`}
          recordCode={pendingDelete.patient_code}
          description="This permanently removes the patient, every mapped lesion, observation and model result, plus all associated microscope images. The patient code will not be reused."
          impacts={[
            {
              label: "Mapped lesions",
              value: pendingDelete.mapped_lesions,
            },
            {
              label: "Observations",
              value: pendingDelete.observation_count,
            },
            {
              label: "Accepted coverage",
              value: `${pendingDelete.documented_lesions}/${pendingDelete.mapped_lesions}`,
            },
          ]}
          confirmLabel="Delete patient"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove(pendingDelete)}
        />
      )}
    </section>
  );
}
