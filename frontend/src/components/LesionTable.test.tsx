import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { lesionFixture } from "../test/fixtures";
import type { Lesion } from "../types";
import { LesionTable } from "./LesionTable";

const lesions: Lesion[] = [
  {
    ...lesionFixture,
    id: 1,
    lesion_code: "L-0001",
    body_part: "chest",
    label: "Baseline marker",
    accepted_observation_count: 0,
    attention_level: null,
    last_activity_at: "2026-07-25T12:00:00Z",
    next_check_at: null,
  },
  {
    ...lesionFixture,
    id: 2,
    lesion_code: "L-0002",
    body_part: "left-underarm",
    label: "Axillary marker",
    observation_count: 2,
    accepted_observation_count: 2,
    attention_level: "high",
    risk_status: "experimental",
    last_activity_at: "2026-07-23T12:00:00Z",
    next_check_at: "2026-08-20T12:00:00Z",
  },
  {
    ...lesionFixture,
    id: 3,
    lesion_code: "L-0003",
    body_part: "right-forearm",
    label: "Documented marker",
    observation_count: 1,
    accepted_observation_count: 1,
    attention_level: "low",
    risk_status: "validated",
    follow_up_action: "monitor_12_months",
    last_activity_at: "2026-07-24T12:00:00Z",
    next_check_at: "2026-08-10T12:00:00Z",
  },
];

function renderTable() {
  render(
    <LesionTable
      lesions={lesions}
      onOpen={vi.fn()}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

function visibleCodes() {
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return rows.map(
    (row) =>
      row.querySelector(".lesion-table-identity strong")?.textContent,
  );
}

describe("LesionTable controls", () => {
  it("searches by anatomical location and recovers from no results", async () => {
    const user = userEvent.setup();
    renderTable();

    const search = screen.getByRole("searchbox", {
      name: "Search lesions",
    });
    await user.type(search, "left underarm");

    expect(visibleCodes()).toEqual(["L-0002"]);
    expect(screen.getByText("left underarm")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "not present");
    expect(screen.getByText("No matching lesions.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(visibleCodes()).toHaveLength(3);
  });

  it("combines capture and attention filters and sorts scheduled checks", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Filter lesions by capture",
      }),
      "documented",
    );
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Filter lesions by attention",
      }),
      "high",
    );
    expect(visibleCodes()).toEqual(["L-0002"]);
    const highBadge = screen.getByLabelText("High Experimental");
    expect(highBadge).toHaveClass("stacked");
    expect(highBadge.parentElement).toHaveClass("lesion-table-risk");
    expect(highBadge.parentElement?.tagName).toBe("DIV");
    expect(highBadge).toHaveAccessibleName("High Experimental");
    expect(within(highBadge!).queryByText("·")).not.toBeInTheDocument();
    expect(within(highBadge!).getByText("Experimental")).toHaveClass(
      "experimental-label",
    );

    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Filter lesions by attention",
      }),
      "all",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort lesions" }),
      "next_check",
    );
    expect(visibleCodes()).toEqual(["L-0003", "L-0002"]);
  });

  it("confirms lesion deletion with its persistent code", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <LesionTable
        lesions={lesions}
        onOpen={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Delete lesion L-0002" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete lesion L-0002?",
    });
    expect(within(dialog).getByText("left underarm")).toBeInTheDocument();
    expect(within(dialog).getByText("Accepted captures")).toBeInTheDocument();

    await user.type(
      within(dialog).getByRole("textbox", {
        name: /Type L-0002 to confirm/,
      }),
      "L-0002",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete lesion" }),
    );

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(lesions[1]));
    expect(
      screen.queryByRole("dialog", { name: "Delete lesion L-0002?" }),
    ).not.toBeInTheDocument();
  });
});
