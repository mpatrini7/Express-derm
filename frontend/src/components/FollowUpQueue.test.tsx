import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { patientFixture } from "../test/fixtures";
import type { Patient } from "../types";
import { classifyFollowUp, FollowUpQueue } from "./FollowUpQueue";

const now = new Date(2026, 6, 25, 12);
const patients: Patient[] = [
  {
    ...patientFixture,
    id: 1,
    patient_code: "ED-0001",
    display_name: "Overdue record",
    highest_attention_level: "high",
    attention_status: "validated",
    next_check_at: "2026-07-20T12:00:00",
  },
  {
    ...patientFixture,
    id: 2,
    patient_code: "ED-0002",
    display_name: "Due today",
    highest_attention_level: "uncertain",
    attention_status: "validated",
    next_check_at: "2026-07-25T08:00:00",
  },
  {
    ...patientFixture,
    id: 3,
    patient_code: "ED-0003",
    display_name: "Upcoming record",
    highest_attention_level: "intermediate",
    attention_status: "experimental",
    next_check_at: "2026-08-05T12:00:00",
  },
  {
    ...patientFixture,
    id: 4,
    patient_code: "ED-0004",
    display_name: "Later record",
    highest_attention_level: "intermediate",
    attention_status: "validated",
    next_check_at: "2026-09-10T12:00:00",
  },
  {
    ...patientFixture,
    id: 5,
    patient_code: "ED-0005",
    display_name: "No automatic date",
    next_check_at: null,
  },
];

function scheduledRows() {
  return within(
    screen.getByLabelText("Scheduled follow-up list"),
  ).getAllByRole("button");
}

describe("FollowUpQueue", () => {
  it("classifies calendar-day windows without treating invalid dates as scheduled", () => {
    expect(classifyFollowUp("2026-07-25T12:00:00", now)?.category).toBe(
      "due",
    );
    expect(classifyFollowUp("2026-08-24T12:00:00", now)?.category).toBe(
      "next_30_days",
    );
    expect(classifyFollowUp("2026-08-25T12:00:00", now)?.category).toBe(
      "later",
    );
    expect(classifyFollowUp("not-a-date", now)).toBeNull();
  });

  it("does not present an empty schedule while patient data is unresolved", () => {
    const { rerender } = render(
      <FollowUpQueue
        patients={[]}
        openingId={null}
        loading
        onOpen={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading local patient records.",
    );
    expect(
      screen.queryByText("No automatic AI follow-up dates are scheduled."),
    ).not.toBeInTheDocument();

    rerender(
      <FollowUpQueue
        patients={[]}
        openingId={null}
        unavailable
        onOpen={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByText("Patient data is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("0 scheduled records")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No automatic AI follow-up dates are scheduled."),
    ).not.toBeInTheDocument();
  });

  it("sorts scheduled records and filters operational windows", async () => {
    const user = userEvent.setup();
    render(
      <FollowUpQueue
        patients={patients}
        openingId={null}
        onOpen={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByText("4 scheduled records")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Experimental dates support local review planning only. Clinician-directed checks remain separate and take precedence.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Experimental")).toBeInTheDocument();
    expect(
      scheduledRows().map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("ED-0001"),
      expect.stringContaining("ED-0002"),
      expect.stringContaining("ED-0003"),
      expect.stringContaining("ED-0004"),
    ]);

    await user.click(
      screen.getByRole("button", { name: "Due now 2", pressed: false }),
    );
    expect(scheduledRows()).toHaveLength(2);

    await user.click(
      screen.getByRole("button", {
        name: "Next 30 days 1",
        pressed: false,
      }),
    );
    expect(scheduledRows()).toHaveLength(1);
    expect(scheduledRows()[0]).toHaveAccessibleName(
      expect.stringContaining("ED-0003"),
    );
  });

  it("opens a scheduled patient without changing the queue data", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <FollowUpQueue
        patients={patients}
        openingId={null}
        onOpen={onOpen}
        now={now}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: /ED-0003 Upcoming record/,
      }),
    );

    expect(onOpen).toHaveBeenCalledWith(patients[2]);
  });

  it("announces the opening record while keeping another row available", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <FollowUpQueue
        patients={patients}
        openingId={patients[2].id}
        onOpen={onOpen}
        now={now}
      />,
    );

    const opening = screen.getByRole("button", {
      name: /ED-0003 Upcoming record.*Loading patient record/,
    });
    const alternative = screen.getByRole("button", {
      name: /ED-0004 Later record/,
    });
    expect(opening).toHaveAttribute("aria-busy", "true");
    expect(opening).toBeDisabled();
    expect(alternative).toBeEnabled();

    await user.click(alternative);
    expect(onOpen).toHaveBeenCalledWith(patients[3]);
  });
});
