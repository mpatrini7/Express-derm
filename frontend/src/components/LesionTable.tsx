import {
  ArrowUpDown,
  Eye,
  ImageOff,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatBodyRegion } from "../bodyRegions";
import { followUpLabels, formatDate } from "../risk";
import type { Lesion } from "../types";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { RiskBadge } from "./RiskBadge";

interface Props {
  lesions: Lesion[];
  onOpen: (lesion: Lesion) => void;
  onDelete: (lesion: Lesion) => Promise<void>;
}

type CaptureFilter = "all" | "needs_capture" | "documented";
type AttentionFilter =
  | "all"
  | "not_assessed"
  | "low"
  | "intermediate"
  | "high"
  | "uncertain";
type LesionSort = "recent" | "next_check" | "attention" | "code";

const attentionPriority: Record<
  Exclude<AttentionFilter, "all">,
  number
> = {
  not_assessed: 0,
  low: 1,
  intermediate: 2,
  uncertain: 3,
  high: 4,
};

function dateValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function LesionTable({ lesions, onOpen, onDelete }: Props) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Lesion | null>(null);
  const [query, setQuery] = useState("");
  const [captureFilter, setCaptureFilter] =
    useState<CaptureFilter>("all");
  const [attentionFilter, setAttentionFilter] =
    useState<AttentionFilter>("all");
  const [sort, setSort] = useState<LesionSort>("recent");

  const visibleLesions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = lesions.filter((lesion) => {
      const searchable = [
        lesion.lesion_code,
        lesion.label,
        formatBodyRegion(lesion.body_part),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      const matchesQuery =
        !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesCapture =
        captureFilter === "all" ||
        (captureFilter === "needs_capture"
          ? lesion.accepted_observation_count === 0
          : lesion.accepted_observation_count > 0);
      const attention = lesion.attention_level ?? "not_assessed";
      const matchesAttention =
        attentionFilter === "all" ||
        attention === attentionFilter ||
        (attentionFilter === "uncertain" && attention === "intermediate");
      return matchesQuery && matchesCapture && matchesAttention;
    });

    return [...filtered].sort((left, right) => {
      if (sort === "code") {
        return left.lesion_code.localeCompare(right.lesion_code, undefined, {
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
      } else if (sort === "attention") {
        const leftAttention =
          attentionPriority[left.attention_level ?? "not_assessed"];
        const rightAttention =
          attentionPriority[right.attention_level ?? "not_assessed"];
        if (leftAttention !== rightAttention) {
          return rightAttention - leftAttention;
        }
      } else {
        const leftActivity = dateValue(left.last_activity_at) ?? 0;
        const rightActivity = dateValue(right.last_activity_at) ?? 0;
        if (leftActivity !== rightActivity) return rightActivity - leftActivity;
      }

      return left.lesion_code.localeCompare(right.lesion_code, undefined, {
        numeric: true,
      });
    });
  }, [attentionFilter, captureFilter, lesions, query, sort]);

  const filtersActive =
    query.trim() !== "" ||
    captureFilter !== "all" ||
    attentionFilter !== "all";

  async function remove(lesion: Lesion) {
    setDeletingId(lesion.id);
    try {
      await onDelete(lesion);
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="panel lesion-table-panel">
      <div className="panel-heading row-between">
        <div>
          <p className="eyebrow">Longitudinal overview</p>
          <h2>Lesion table</h2>
        </div>
        <span className="status-chip" aria-live="polite">
          {visibleLesions.length === lesions.length
            ? `${lesions.length} ${
                lesions.length === 1 ? "lesion" : "lesions"
              }`
            : `${visibleLesions.length} of ${lesions.length}`}
        </span>
      </div>

      {lesions.length > 0 && (
        <div className="lesion-table-toolbar">
          <div className="lesion-search">
            <label className="sr-only" htmlFor="lesion-table-search">
              Search lesions
            </label>
            <Search aria-hidden="true" size={17} strokeWidth={2} />
            <input
              id="lesion-table-search"
              type="search"
              value={query}
              placeholder="Search code, label, or location"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear lesion search"
                title="Clear search"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            )}
          </div>

          <label className="lesion-table-filter">
            <span>Capture</span>
            <select
              aria-label="Filter lesions by capture"
              value={captureFilter}
              onChange={(event) =>
                setCaptureFilter(event.target.value as CaptureFilter)
              }
            >
              <option value="all">All capture states</option>
              <option value="needs_capture">Needs accepted capture</option>
              <option value="documented">Has accepted capture</option>
            </select>
          </label>

          <label className="lesion-table-filter">
            <span>Attention</span>
            <select
              aria-label="Filter lesions by attention"
              value={attentionFilter}
              onChange={(event) =>
                setAttentionFilter(event.target.value as AttentionFilter)
              }
            >
              <option value="all">All attention factors</option>
              <option value="not_assessed">Not assessed</option>
              <option value="low">Low</option>
              <option value="high">High</option>
              <option value="uncertain">Inconclusive</option>
            </select>
          </label>

          <label className="lesion-table-filter lesion-table-sort">
            <span>
              <ArrowUpDown aria-hidden="true" size={15} strokeWidth={2} />
              Sort
            </span>
            <select
              aria-label="Sort lesions"
              value={sort}
              onChange={(event) => setSort(event.target.value as LesionSort)}
            >
              <option value="recent">Recently updated</option>
              <option value="next_check">Next check</option>
              <option value="attention">Attention factor</option>
              <option value="code">Lesion code</option>
            </select>
          </label>
        </div>
      )}

      {lesions.length === 0 ? (
        <div className="empty-state">
          <p>No lesions mapped for this patient.</p>
        </div>
      ) : visibleLesions.length === 0 ? (
        <div className="empty-state lesion-filter-empty">
          <p>No matching lesions.</p>
          <button
            type="button"
            className="secondary"
            disabled={!filtersActive}
            onClick={() => {
              setQuery("");
              setCaptureFilter("all");
              setAttentionFilter("all");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="lesion-table-shell">
          <table className="lesion-table">
            <thead>
              <tr>
                <th>Lesion</th>
                <th>Location</th>
                <th>Captures</th>
                <th>AI risk factor</th>
                <th>Follow-up</th>
                <th>Last update</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleLesions.map((lesion) => (
                <tr
                  key={lesion.id}
                  className="clickable-table-row"
                  tabIndex={0}
                  onClick={() => onOpen(lesion)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(lesion);
                    }
                  }}
                >
                  <td>
                    <div className="lesion-table-identity">
                      <div className="lesion-thumbnail">
                        {lesion.latest_accepted_image_path ? (
                          <img
                            src={`/media/${lesion.latest_accepted_image_path}`}
                            alt=""
                          />
                        ) : (
                          <ImageOff aria-hidden="true" size={18} />
                        )}
                      </div>
                      <div>
                        <strong>{lesion.lesion_code}</strong>
                        <span>{lesion.label || "No label"}</span>
                      </div>
                    </div>
                  </td>
                  <td>{formatBodyRegion(lesion.body_part)}</td>
                  <td>
                    <strong>{lesion.observation_count}</strong>
                    <span>{lesion.accepted_observation_count} accepted</span>
                  </td>
                  <td>
                    <div className="lesion-table-risk">
                      <RiskBadge
                        level={lesion.attention_level}
                        status={lesion.risk_status}
                        stacked
                      />
                    </div>
                  </td>
                  <td>
                    <strong>{followUpLabels[lesion.follow_up_action]}</strong>
                    <span>{formatDate(lesion.next_check_at, "No date")}</span>
                  </td>
                  <td>{formatDate(lesion.last_activity_at)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Open lesion ${lesion.lesion_code}`}
                        title={`Open lesion ${lesion.lesion_code}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(lesion);
                        }}
                      >
                        <Eye aria-hidden="true" size={17} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Delete lesion ${lesion.lesion_code}`}
                        title={`Delete lesion ${lesion.lesion_code}`}
                        disabled={deletingId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDelete(lesion);
                        }}
                      >
                        <Trash2 aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pendingDelete && (
        <DeleteConfirmationDialog
          title={`Delete lesion ${pendingDelete.lesion_code}?`}
          recordCode={pendingDelete.lesion_code}
          description="This permanently removes the mapped lesion, its observation and model-run history, audit events, visual reviews and all associated microscope images."
          impacts={[
            {
              label: "Location",
              value: formatBodyRegion(pendingDelete.body_part),
            },
            {
              label: "Observations",
              value: pendingDelete.observation_count,
            },
            {
              label: "Accepted captures",
              value: pendingDelete.accepted_observation_count,
            },
          ]}
          confirmLabel="Delete lesion"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => remove(pendingDelete)}
        />
      )}
    </section>
  );
}
