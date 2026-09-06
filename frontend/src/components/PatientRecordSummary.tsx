import { formatDate } from "../risk";
import type { Patient } from "../types";
import { RiskBadge } from "./RiskBadge";

interface Props {
  patient: Patient;
}

const statusLabels: Record<Patient["record_status"], string> = {
  not_mapped: "Not mapped",
  needs_capture: "Capture needed",
  documented: "Documented",
};

export function PatientRecordSummary({ patient }: Props) {
  return (
    <dl
      className="patient-record-summary"
      aria-label={`Summary for ${patient.patient_code}`}
    >
      <div>
        <dt>Workflow</dt>
        <dd>
          <span className={`record-status ${patient.record_status}`}>
            {statusLabels[patient.record_status]}
          </span>
        </dd>
      </div>
      <div>
        <dt>Mapped lesions</dt>
        <dd>{patient.mapped_lesions}</dd>
      </div>
      <div>
        <dt>Accepted coverage</dt>
        <dd>
          {patient.documented_lesions}/{patient.mapped_lesions}
        </dd>
      </div>
      <div>
        <dt>Highest AI risk factor</dt>
        <dd>
          <RiskBadge
            level={patient.highest_attention_level}
            status={patient.attention_status}
            stacked
          />
        </dd>
      </div>
      <div>
        <dt>Last update</dt>
        <dd>{formatDate(patient.last_activity_at)}</dd>
      </div>
      <div>
        <dt>Next check</dt>
        <dd>{formatDate(patient.next_check_at)}</dd>
      </div>
    </dl>
  );
}
