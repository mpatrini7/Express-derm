import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import App from "./App";
import {
  lesionFixture,
  patientFixture,
} from "./test/fixtures";
import type { Lesion, Patient } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, reject, resolve };
}

vi.mock("./api", () => ({
  api: {
    listPatients: vi.fn(),
    getPatient: vi.fn(),
    createPatient: vi.fn(),
    updatePatient: vi.fn(),
    deletePatient: vi.fn(),
    listLesions: vi.fn(),
    createLesion: vi.fn(),
    updateLesion: vi.fn(),
    deleteLesion: vi.fn(),
    listObservations: vi.fn(),
    listLesionAuditEvents: vi.fn(),
    listLongitudinalReviews: vi.fn(),
    createLongitudinalReview: vi.fn(),
  },
}));

vi.mock("./components/BodyMap3D", () => ({
  BodyMap3D: ({
    busy,
    repositioningLesion,
    onCreatePoint,
    onCancelReposition,
  }: {
    busy: boolean;
    repositioningLesion: Lesion | null;
    onCreatePoint: (
      bodyPart: string,
      point: { x: number; y: number; z: number },
    ) => void;
    onCancelReposition: () => void;
  }) => (
    <section aria-label="Body map test double">
      <span>
        {repositioningLesion
          ? `Repositioning ${repositioningLesion.lesion_code}`
          : "Add mode"}
      </span>
      <button
        type="button"
        disabled={busy || Boolean(repositioningLesion)}
        onClick={() =>
          onCreatePoint("chest", {
            x: 0.12,
            y: 1.18,
            z: 0.31,
          })
        }
      >
        Choose chest point
      </button>
      <button
        type="button"
        disabled={busy || !repositioningLesion}
        onClick={() =>
          onCreatePoint("left-underarm", {
            x: -0.63,
            y: 1.17,
            z: 0.2,
          })
        }
      >
        Choose left underarm
      </button>
      <button
        type="button"
        disabled={!repositioningLesion}
        onClick={onCancelReposition}
      >
        Cancel map move
      </button>
    </section>
  ),
}));

vi.mock("./components/CameraCapture", () => ({
  CameraCapture: ({ onSaved }: { onSaved: () => Promise<void> }) => (
    <div>
      Camera capture test double
      <button type="button" onClick={() => void onSaved()}>
        Simulate saved capture
      </button>
    </div>
  ),
}));

vi.mock("./components/ClinicalPhotoBatch", () => ({
  ClinicalPhotoBatch: () => <section>Clinical photo batch test double</section>,
}));

describe("App workflows", () => {
  beforeEach(() => {
    vi.mocked(api.listPatients).mockResolvedValue([patientFixture]);
    vi.mocked(api.getPatient).mockResolvedValue(patientFixture);
    vi.mocked(api.listLesions).mockResolvedValue([lesionFixture]);
    vi.mocked(api.listObservations).mockResolvedValue([]);
    vi.mocked(api.listLesionAuditEvents).mockResolvedValue([]);
    vi.mocked(api.listLongitudinalReviews).mockResolvedValue([]);
  });

  it("distinguishes initial patient loading from an empty database", async () => {
    const patientResponse = deferred<Patient[]>();
    vi.mocked(api.listPatients).mockReturnValue(patientResponse.promise);

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Express-Derm" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Express-Derm BodyMap" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading local patient records.",
    );
    expect(
      screen.getByRole("button", { name: "New patient" }),
    ).toBeDisabled();
    expect(screen.queryByText("No patients saved.")).not.toBeInTheDocument();

    patientResponse.resolve([patientFixture]);

    expect(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Loading local patient records."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New patient" }),
    ).toBeEnabled();
  });

  it("retries a failed patient-list request", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listPatients)
      .mockRejectedValueOnce(new Error("Local database unavailable"))
      .mockResolvedValueOnce([patientFixture]);

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Patient list could not be refreshed");
    expect(alert).toHaveTextContent("Local database unavailable");
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Patient data is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("0 records")).not.toBeInTheDocument();
    expect(screen.queryByText("No patients saved.")).not.toBeInTheDocument();

    await user.click(
      within(alert).getByRole("button", {
        name: "Retry",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Patient list could not be refreshed"),
    ).not.toBeInTheDocument();
    expect(api.listPatients).toHaveBeenCalledTimes(2);
  });

  it("ignores an obsolete patient-list response", async () => {
    const user = userEvent.setup();
    const firstResponse = deferred<Patient[]>();
    const secondResponse = deferred<Patient[]>();
    const newerPatient = {
      ...patientFixture,
      id: 2,
      patient_code: "ED-0002",
      display_name: "Newer patient",
    };
    vi.mocked(api.listPatients)
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Patients" }));
    secondResponse.resolve([newerPatient]);

    expect(
      await screen.findByRole("button", {
        name: /ED-0002 Newer patient/,
      }),
    ).toBeInTheDocument();

    firstResponse.resolve([patientFixture]);
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /ED-0002 Newer patient/,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: /ED-0001 Test patient/,
        }),
      ).not.toBeInTheDocument();
    });
  });

  it("offers a retry when a patient record cannot be opened", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listLesions)
      .mockRejectedValueOnce(new Error("Lesion store unavailable"))
      .mockResolvedValueOnce([lesionFixture]);

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Patient record could not be opened");
    expect(alert).toHaveTextContent(
      "ED-0001: Lesion store unavailable",
    );
    expect(screen.getByRole("button", { name: "Patient" })).toBeDisabled();
    expect(
      screen.queryByLabelText("Body map test double"),
    ).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByLabelText("Body map test double"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Patient record could not be opened"),
    ).not.toBeInTheDocument();
    expect(api.listLesions).toHaveBeenCalledTimes(2);
  });

  it("does not report an obsolete patient-opening failure", async () => {
    const user = userEvent.setup();
    const secondPatient = {
      ...patientFixture,
      id: 2,
      patient_code: "ED-0002",
      display_name: "Second patient",
    };
    const secondLesion = {
      ...lesionFixture,
      id: 2,
      patient_id: secondPatient.id,
      body_part: "left-forearm",
    };
    const firstResponse = deferred<Lesion[]>();
    const secondResponse = deferred<Lesion[]>();
    vi.mocked(api.listPatients).mockResolvedValue([
      patientFixture,
      secondPatient,
    ]);
    vi.mocked(api.listLesions).mockImplementation((patientId) =>
      patientId === patientFixture.id
        ? firstResponse.promise
        : secondResponse.promise,
    );

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: /ED-0002 Second patient/,
      }),
    );
    secondResponse.resolve([secondLesion]);

    expect(
      await screen.findByRole("heading", { name: "Second patient" }),
    ).toBeInTheDocument();
    firstResponse.reject(new Error("Obsolete failure"));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Second patient" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Obsolete failure")).not.toBeInTheDocument();
    });
  });

  it("keeps a created patient successful when record opening fails", async () => {
    const user = userEvent.setup();
    const createdPatient = {
      ...patientFixture,
      id: 2,
      patient_code: "ED-0002",
      display_name: "New local patient",
      mapped_lesions: 0,
      observation_count: 0,
      documented_lesions: 0,
    };
    vi.mocked(api.createPatient).mockResolvedValue(createdPatient);
    vi.mocked(api.listPatients)
      .mockResolvedValueOnce([patientFixture])
      .mockResolvedValueOnce([patientFixture, createdPatient]);
    vi.mocked(api.listLesions).mockRejectedValueOnce(
      new Error("Record loading failed"),
    );

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "New patient" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Display label" }),
      "New local patient",
    );
    await user.click(
      screen.getByRole("button", { name: "Create patient" }),
    );

    expect(
      await screen.findByRole("button", {
        name: /ED-0002 New local patient/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "New patient" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent("Patient record could not be opened");
    expect(api.createPatient).toHaveBeenCalledOnce();
  });

  it("keeps a failed patient deletion inside its confirmation dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(api.deletePatient).mockRejectedValueOnce(
      new Error("Patient delete unavailable"),
    );

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Delete patient ED-0001",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete patient ED-0001?",
    });
    await user.type(
      within(dialog).getByRole("textbox", {
        name: /Type ED-0001 to confirm/,
      }),
      "ED-0001",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete patient" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Patient delete unavailable",
    );
    expect(screen.getAllByText("Patient delete unavailable")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /ED-0001 Test patient/ }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("dialog", { name: "Delete patient ED-0001?" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Patient delete unavailable"),
    ).not.toBeInTheDocument();
  });

  it("creates a marker only after confirming its proposed location", async () => {
    const user = userEvent.setup();
    const createdLesion = {
      ...lesionFixture,
      id: 8,
      lesion_code: "L-0002",
      x: 0.12,
      y: 1.18,
      z: 0.31,
      label: "Shoulder baseline",
    };
    vi.mocked(api.createLesion).mockResolvedValue(createdLesion);

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Choose chest point" }),
    );

    let createDialog = await screen.findByRole("dialog", {
      name: "Add lesion marker?",
    });
    expect(api.createLesion).not.toHaveBeenCalled();
    await user.click(
      within(createDialog).getByRole("button", { name: "Cancel" }),
    );
    expect(api.createLesion).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Choose chest point" }),
    );
    createDialog = await screen.findByRole("dialog", {
      name: "Add lesion marker?",
    });
    await user.type(
      within(createDialog).getByRole("textbox", {
        name: "Display label (optional)",
      }),
      "Shoulder baseline",
    );
    await user.click(
      within(createDialog).getByRole("button", { name: "Add marker" }),
    );

    await waitFor(() => {
      expect(api.createLesion).toHaveBeenCalledWith(patientFixture.id, {
        body_part: "chest",
        x: 0.12,
        y: 1.18,
        z: 0.31,
        label: "Shoulder baseline",
      });
    });
    expect(
      await screen.findByRole("button", { name: /L-0002 chest/ }),
    ).toBeInTheDocument();
  });

  it("keeps a failed lesion deletion inside its confirmation dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteLesion).mockRejectedValueOnce(
      new Error("Lesion delete unavailable"),
    );

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Delete lesion L-0001",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete lesion L-0001?",
    });
    await user.type(
      within(dialog).getByRole("textbox", {
        name: /Type L-0001 to confirm/,
      }),
      "L-0001",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete lesion" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Lesion delete unavailable",
    );
    expect(screen.getAllByText("Lesion delete unavailable")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /L-0001 chest/ }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("dialog", { name: "Delete lesion L-0001?" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Lesion delete unavailable"),
    ).not.toBeInTheDocument();
  });

  it("edits details, cancels a move and confirms marker repositioning", async () => {
    const user = userEvent.setup();
    const editedLesion = {
      ...lesionFixture,
      label: "Axillary marker",
      notes: "Checked against the body map.",
      last_activity_at: "2026-07-24T08:30:00Z",
    };
    const relocatedLesion = {
      ...editedLesion,
      body_part: "left-underarm",
      x: -0.63,
      y: 1.17,
      z: 0.2,
      last_activity_at: "2026-07-24T09:00:00Z",
    };
    vi.mocked(api.updateLesion)
      .mockResolvedValueOnce(editedLesion)
      .mockResolvedValueOnce(relocatedLesion);
    const refreshedPatient = {
      ...patientFixture,
      documented_lesions: 1,
      highest_attention_level: "intermediate" as const,
      attention_status: "validated" as const,
      last_activity_at: "2026-07-24T09:00:00Z",
      next_check_at: "2026-10-24T09:00:00Z",
    };
    vi.mocked(api.getPatient)
      .mockResolvedValueOnce(refreshedPatient)
      .mockRejectedValueOnce(new Error("Summary temporarily unavailable"));

    render(<App />);

    expect(
      screen.queryByLabelText("Body map test double"),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    expect(
      await screen.findByLabelText("Body map test double"),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", {
        name: /L-0001 chest/,
      }),
    );

    const openRecord = screen.getByRole("button", {
      name: "Open full record for L-0001",
    });
    await user.click(openRecord);
    const lesionDialog = await screen.findByRole("dialog", {
      name: "L-0001",
    });
    expect(
      within(lesionDialog).getByRole("heading", { name: "Image history" }),
    ).toBeInTheDocument();
    expect(api.listLesionAuditEvents).toHaveBeenCalledWith(lesionFixture.id);
    expect(api.listLongitudinalReviews).toHaveBeenCalledWith(lesionFixture.id);
    await user.click(
      within(lesionDialog).getByRole("button", {
        name: "Close lesion details",
      }),
    );
    await waitFor(() => expect(openRecord).toHaveFocus());

    await user.click(
      screen.getByRole("button", {
        name: "Edit L-0001 details",
      }),
    );
    const label = screen.getByRole("textbox", { name: "Label" });
    await user.clear(label);
    await user.type(label, "Axillary marker");
    await user.type(
      screen.getByRole("textbox", { name: "Notes" }),
      "Checked against the body map.",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(api.updateLesion).toHaveBeenNthCalledWith(
        1,
        lesionFixture.id,
        {
          body_part: "chest",
          x: 0.1,
          y: 1.1,
          z: 0.3,
          label: "Axillary marker",
          notes: "Checked against the body map.",
        },
      );
    });
    expect(
      await screen.findByText("Lesion details updated."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getPatient).toHaveBeenCalledWith(patientFixture.id);
    });
    const summary = screen.getByLabelText("Summary for ED-0001");
    expect(within(summary).getByText("1/1")).toBeInTheDocument();
    expect(within(summary).getByText("Inconclusive")).toBeInTheDocument();
    expect(within(summary).getByText(/Oct 24, 2026/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Reposition L-0001" }),
    );
    expect(screen.getByText("Repositioning L-0001")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Cancel map move" }),
    );
    expect(screen.getByText("Add mode")).toBeInTheDocument();
    expect(api.updateLesion).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Reposition L-0001" }),
    );
    expect(screen.getByText("Repositioning L-0001")).toBeInTheDocument();
    await user.click(openRecord);
    await user.click(
      within(await screen.findByRole("dialog", { name: "L-0001" })).getByRole(
        "button",
        { name: "Close lesion details" },
      ),
    );
    expect(screen.getByText("Add mode")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Reposition L-0001" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Choose left underarm" }),
    );
    let moveDialog = await screen.findByRole("dialog", {
      name: "Move marker L-0001?",
    });
    expect(within(moveDialog).getByText("chest")).toBeInTheDocument();
    expect(within(moveDialog).getByText("left underarm")).toBeInTheDocument();
    expect(api.updateLesion).toHaveBeenCalledTimes(1);
    await user.click(
      within(moveDialog).getByRole("button", { name: "Cancel" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Move marker L-0001?" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Repositioning L-0001")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Choose left underarm" }),
    );
    moveDialog = await screen.findByRole("dialog", {
      name: "Move marker L-0001?",
    });
    await user.click(
      within(moveDialog).getByRole("button", { name: "Move marker" }),
    );

    await waitFor(() => {
      expect(api.updateLesion).toHaveBeenNthCalledWith(
        2,
        lesionFixture.id,
        {
          body_part: "left-underarm",
          x: -0.63,
          y: 1.17,
          z: 0.2,
          label: "Axillary marker",
          notes: "Checked against the body map.",
          change_reason: "Manual BodyMap repositioning",
        },
      );
    });
    expect(screen.getByText("Add mode")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /L-0001 left underarm/ }),
    ).toBeInTheDocument();
    expect(api.getPatient).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Patient summary could not be refreshed"),
    ).toBeInTheDocument();
    const summaryError = screen
      .getByText("Patient summary could not be refreshed")
      .closest("[role='alert']");
    expect(summaryError).not.toBeNull();
    expect(summaryError as HTMLElement).toHaveTextContent(
      "Summary temporarily unavailable",
    );
    await user.click(
      within(summaryError as HTMLElement).getByRole("button", {
        name: "Retry",
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByText("Patient summary could not be refreshed"),
      ).not.toBeInTheDocument();
    });
    expect(api.getPatient).toHaveBeenCalledTimes(3);
  });

  it("updates the selected patient profile without changing its code", async () => {
    const user = userEvent.setup();
    const updatedPatient = {
      ...patientFixture,
      birth_year: 1980,
      notes: "Non-identifying follow-up note.",
      updated_at: "2026-07-24T10:00:00Z",
      last_activity_at: "2026-07-24T10:00:00Z",
    };
    vi.mocked(api.updatePatient).mockResolvedValue(updatedPatient);

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Edit patient ED-0001",
      }),
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Birth year" }),
      "1980",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Notes" }),
      "Non-identifying follow-up note.",
    );
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(api.updatePatient).toHaveBeenCalledWith(patientFixture.id, {
        display_name: "Test patient",
        birth_year: 1980,
        notes: "Non-identifying follow-up note.",
      });
    });
    expect(screen.getByText("Birth year 1980")).toBeInTheDocument();
    expect(
      screen.getByText("Non-identifying follow-up note."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit patient ED-0001" }),
    ).toBeInTheDocument();
  });

  it("does not let a pending summary overwrite a saved patient profile", async () => {
    const user = userEvent.setup();
    const pendingSummary = deferred<Patient>();
    const updatedPatient = {
      ...patientFixture,
      display_name: "Updated profile",
      notes: "Saved while summary refresh was pending.",
      updated_at: "2026-07-24T10:00:00Z",
      last_activity_at: "2026-07-24T10:00:00Z",
    };
    vi.mocked(api.getPatient).mockReturnValue(pendingSummary.promise);
    vi.mocked(api.updatePatient).mockResolvedValue(updatedPatient);

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /L-0001 chest/,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Simulate saved capture" }),
    );
    await waitFor(() => expect(api.getPatient).toHaveBeenCalledOnce());

    await user.click(
      screen.getByRole("button", {
        name: "Edit patient ED-0001",
      }),
    );
    const displayName = screen.getByRole("textbox", {
      name: "Display label",
    });
    await user.clear(displayName);
    await user.type(displayName, "Updated profile");
    await user.type(
      screen.getByRole("textbox", { name: "Notes" }),
      "Saved while summary refresh was pending.",
    );
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByRole("heading", { name: "Updated profile" }),
    ).toBeInTheDocument();
    pendingSummary.resolve(patientFixture);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Updated profile" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Test patient" }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the newest patient summary when an older response arrives last", async () => {
    const user = userEvent.setup();
    const olderResponse = deferred<Patient>();
    const newerResponse = deferred<Patient>();
    const olderSummary = {
      ...patientFixture,
      mapped_lesions: 2,
      documented_lesions: 1,
      observation_count: 1,
      last_activity_at: "2026-07-24T09:00:00Z",
    };
    const newerSummary = {
      ...patientFixture,
      mapped_lesions: 3,
      documented_lesions: 3,
      observation_count: 3,
      record_status: "documented" as const,
      last_activity_at: "2026-07-24T10:00:00Z",
    };
    vi.mocked(api.getPatient)
      .mockReturnValueOnce(olderResponse.promise)
      .mockReturnValueOnce(newerResponse.promise);

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /L-0001 chest/,
      }),
    );
    const refreshSummary = screen.getByRole("button", {
      name: "Simulate saved capture",
    });
    await user.click(refreshSummary);
    await waitFor(() => expect(api.getPatient).toHaveBeenCalledTimes(1));
    await user.click(refreshSummary);
    await waitFor(() => expect(api.getPatient).toHaveBeenCalledTimes(2));

    newerResponse.resolve(newerSummary);
    const summary = screen.getByLabelText("Summary for ED-0001");
    expect(await within(summary).findByText("3/3")).toBeInTheDocument();

    olderResponse.resolve(olderSummary);
    await waitFor(() => {
      expect(within(summary).getByText("3/3")).toBeInTheDocument();
      expect(within(summary).queryByText("1/2")).not.toBeInTheDocument();
    });
  });

  it("ignores an obsolete patient-summary failure", async () => {
    const user = userEvent.setup();
    const olderResponse = deferred<Patient>();
    const newerResponse = deferred<Patient>();
    const newerSummary = {
      ...patientFixture,
      documented_lesions: 1,
      observation_count: 1,
      record_status: "documented" as const,
      last_activity_at: "2026-07-24T10:00:00Z",
    };
    vi.mocked(api.getPatient)
      .mockReturnValueOnce(olderResponse.promise)
      .mockReturnValueOnce(newerResponse.promise);

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /L-0001 chest/,
      }),
    );
    const refreshSummary = screen.getByRole("button", {
      name: "Simulate saved capture",
    });
    await user.click(refreshSummary);
    await waitFor(() => expect(api.getPatient).toHaveBeenCalledTimes(1));
    await user.click(refreshSummary);
    await waitFor(() => expect(api.getPatient).toHaveBeenCalledTimes(2));

    newerResponse.resolve(newerSummary);
    const summary = screen.getByLabelText("Summary for ED-0001");
    expect(await within(summary).findByText("1/1")).toBeInTheDocument();

    olderResponse.reject(new Error("Obsolete summary failure"));
    await waitFor(() => {
      expect(within(summary).getByText("1/1")).toBeInTheDocument();
      expect(
        screen.queryByText("Obsolete summary failure"),
      ).not.toBeInTheDocument();
    });
  });

  it("opens a scheduled patient from the top-level follow-up queue", async () => {
    const user = userEvent.setup();
    const scheduledPatient = {
      ...patientFixture,
      highest_attention_level: "intermediate" as const,
      attention_status: "validated" as const,
      next_check_at: "2999-08-10T12:00:00Z",
    };
    vi.mocked(api.listPatients).mockResolvedValue([scheduledPatient]);

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Follow-up" }),
    );
    expect(
      screen.getByRole("heading", { name: "Follow-up" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 scheduled record")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );

    expect(
      await screen.findByLabelText("Body map test double"),
    ).toBeInTheDocument();
    expect(api.listLesions).toHaveBeenCalledWith(scheduledPatient.id);
  });

  it("ignores an older patient response that completes after a newer one", async () => {
    const user = userEvent.setup();
    const secondPatient = {
      ...patientFixture,
      id: 2,
      patient_code: "ED-0002",
      display_name: "Second patient",
    };
    const secondLesion = {
      ...lesionFixture,
      id: 2,
      patient_id: secondPatient.id,
      body_part: "left-forearm",
    };
    const firstResponse = deferred<Lesion[]>();
    const secondResponse = deferred<Lesion[]>();
    vi.mocked(api.listPatients).mockResolvedValue([
      patientFixture,
      secondPatient,
    ]);
    vi.mocked(api.listLesions).mockImplementation((patientId) =>
      patientId === patientFixture.id
        ? firstResponse.promise
        : secondResponse.promise,
    );

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Patient" }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", {
        name: /ED-0002 Second patient/,
      }),
    );
    secondResponse.resolve([secondLesion]);

    expect(
      await screen.findByRole("heading", { name: "Second patient" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: /L-0001 left forearm/,
      }),
    ).toBeInTheDocument();

    firstResponse.resolve([lesionFixture]);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Second patient" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /L-0001 chest/ }),
      ).not.toBeInTheDocument();
    });
  });

  it("does not reopen a patient after navigation cancels its pending load", async () => {
    const user = userEvent.setup();
    const lesionResponse = deferred<Lesion[]>();
    vi.mocked(api.listLesions).mockReturnValue(lesionResponse.promise);

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /ED-0001 Test patient/,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Follow-up" }),
    );
    expect(
      screen.getByRole("heading", { name: "Follow-up" }),
    ).toBeInTheDocument();

    lesionResponse.resolve([lesionFixture]);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Follow-up" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Body map test double"),
      ).not.toBeInTheDocument();
    });
  });
});
