import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  BodyMapModelError,
  BodyMapModelErrorBoundary,
  BodyMapModelLoading,
} from "./BodyMapModelState";

function FailedModel(): ReactElement {
  throw new Error("Invalid local GLB");
}

describe("BodyMap model states", () => {
  it("announces model loading without presenting an error", () => {
    render(<BodyMapModelLoading />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading human model",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the record usable and offers a retry after failure", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<BodyMapModelError onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The patient record remains available",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("contains a model rendering error and reports it to the canvas owner", () => {
    const onError = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <BodyMapModelErrorBoundary onError={onError}>
        <FailedModel />
      </BodyMapModelErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid local GLB" }),
    );
    consoleError.mockRestore();
  });
});
