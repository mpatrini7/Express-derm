import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { patientFixture } from "../test/fixtures";
import type { Patient } from "../types";
import { PatientSidebar } from "./PatientSidebar";

const patients: Patient[] = [
  {
    ...patientFixture,
    id: 1,
    patient_code: "ED-0001",
    display_name: "Recent record",
    record_status: "needs_capture",
    last_activity_at: "2026-07-24T12:00:00Z",
    next_check_at: null,
  },
  {
    ...patientFixture,
    id: 2,
    patient_code: "ED-0002",
    display_name: "Scheduled record",
    birth_year: 1974,
    record_status: "documented",
    last_activity_at: "2026-07-22T12:00:00Z",
    next_check_at: "2026-08-10T12:00:00Z",
  },
  {
    ...patientFixture,
    id: 3,
    patient_code: "ED-0003",
    display_name: "Unmapped record",
    record_status: "not_mapped",
    mapped_lesions: 0,
    last_activity_at: "2026-07-23T12:00:00Z",
    next_check_at: "2026-09-10T12:00:00Z",
  },
];

function renderDirectory() {
  render(
    <PatientSidebar
      patients={patients}
      selectedId={null}
      openingId={null}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

function visiblePatientButtons() {
  return within(screen.getByLabelText("Patient list")).getAllByRole("button", {
    name: /^ED-/,
  });
}

describe("PatientSidebar directory controls", () => {
  it("keeps cached records available while the directory refreshes", () => {
    render(
      <PatientSidebar
        patients={patients}
        selectedId={null}
        openingId={null}
        loading
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("Refreshing")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ED-0001 Recent record/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "New patient" }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Loading local patient records."),
    ).not.toBeInTheDocument();
  });

  it("searches by patient profile data and clears the query", async () => {
    const user = userEvent.setup();
    renderDirectory();

    const search = screen.getByRole("searchbox", {
      name: "Search patients",
    });
    await user.type(search, "1974");

    expect(visiblePatientButtons()).toHaveLength(1);
    expect(visiblePatientButtons()[0]).toHaveAccessibleName(
      expect.stringContaining("ED-0002"),
    );
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Clear patient search" }),
    );
    expect(visiblePatientButtons()).toHaveLength(3);

    await user.type(search, "not present");
    expect(screen.getByText("No matching patients.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(visiblePatientButtons()).toHaveLength(3);
  });

  it("filters workflow state and sorts scheduled checks first", async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(
      screen.getByRole("button", {
        name: "Documented",
        pressed: false,
      }),
    );
    expect(visiblePatientButtons()).toHaveLength(1);
    expect(visiblePatientButtons()[0]).toHaveAccessibleName(
      expect.stringContaining("ED-0002"),
    );

    await user.click(
      screen.getByRole("button", {
        name: "All",
        pressed: false,
      }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort patients" }),
      "next_check",
    );

    expect(
      visiblePatientButtons().map((button) =>
        button.getAttribute("aria-label") ?? button.textContent,
      ),
    ).toEqual([
      expect.stringContaining("ED-0002"),
      expect.stringContaining("ED-0003"),
      expect.stringContaining("ED-0001"),
    ]);
  });

  it("shows deletion impact and requires the patient code", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <PatientSidebar
        patients={patients}
        selectedId={null}
        openingId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Delete patient ED-0002" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete patient ED-0002?",
    });
    expect(within(dialog).getByText("Mapped lesions")).toBeInTheDocument();
    expect(within(dialog).getByText("Observations")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Accepted coverage"),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", {
      name: "Delete patient",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", {
        name: /Type ED-0002 to confirm/,
      }),
      "ED-0002",
    );
    await user.click(confirm);

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(patients[1]));
    expect(
      screen.queryByRole("dialog", { name: "Delete patient ED-0002?" }),
    ).not.toBeInTheDocument();
  });

  it("marks only the opening record busy and keeps alternatives selectable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PatientSidebar
        patients={patients}
        selectedId={patients[1].id}
        openingId={patients[1].id}
        onSelect={onSelect}
        onCreate={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const opening = screen.getByRole("button", {
      name: /ED-0002 Scheduled record.*Loading patient record/,
    });
    const alternative = screen.getByRole("button", {
      name: /ED-0001 Recent record/,
    });
    expect(opening).toHaveAttribute("aria-busy", "true");
    expect(opening).toBeDisabled();
    expect(alternative).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "New patient" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete patient ED-0001" }),
    ).toBeDisabled();

    await user.click(alternative);
    expect(onSelect).toHaveBeenCalledWith(patients[0]);
  });
});
