import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { patientFixture } from "../test/fixtures";
import { PatientRecordSummary } from "./PatientRecordSummary";

describe("PatientRecordSummary", () => {
  it("shows current workflow, coverage, attention and dates", () => {
    render(
      <PatientRecordSummary
        patient={{
          ...patientFixture,
          mapped_lesions: 3,
          documented_lesions: 2,
          record_status: "needs_capture",
          highest_attention_level: "high",
          attention_status: "experimental",
          last_activity_at: "2026-07-25T09:00:00Z",
          next_check_at: "2026-10-25T09:00:00Z",
        }}
      />,
    );

    const summary = screen.getByLabelText("Summary for ED-0001");
    expect(within(summary).getByText("Capture needed")).toBeInTheDocument();
    expect(within(summary).getByText("2/3")).toBeInTheDocument();
    const attention = within(summary).getByText("High");
    const badge = attention.parentElement;
    expect(badge).toHaveClass("risk-badge", "experimental");
    expect(badge).toHaveClass("stacked");
    expect(badge).toHaveAccessibleName("High Experimental");
    expect(badge?.children[0]).toHaveTextContent("High");
    expect(badge?.children[1]).toHaveTextContent("Experimental");
    expect(within(badge!).getByText("Experimental")).toHaveClass(
      "experimental-label",
    );
    expect(within(badge!).queryByText("·")).not.toBeInTheDocument();
    expect(within(summary).getByText(/Jul 25, 2026/)).toBeInTheDocument();
    expect(within(summary).getByText(/Oct 25, 2026/)).toBeInTheDocument();
  });
});
