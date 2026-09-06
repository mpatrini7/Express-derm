import type { Observation } from "../types";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";

interface Props {
  lesionCode: string;
  observation: Observation;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function observationDeleteCode(observationId: number) {
  return `IMG-${String(observationId).padStart(4, "0")}`;
}

export function ObservationDeleteDialog({
  lesionCode,
  observation,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <DeleteConfirmationDialog
      title="Delete this microscope image?"
      recordCode={observationDeleteCode(observation.id)}
      description={`This permanently removes only this image from lesion ${lesionCode}. The lesion and its other images remain. Connected AI evaluations and visual reviews are also removed.`}
      impacts={[
        {
          label: "Image",
          value: observationDeleteCode(observation.id),
        },
        {
          label: "Captured",
          value: new Date(observation.captured_at).toLocaleString(),
        },
        {
          label: "Lesion retained",
          value: lesionCode,
        },
      ]}
      confirmLabel="Delete image"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
