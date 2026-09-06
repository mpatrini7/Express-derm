import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhotoQuality } from "./PhotoQuality";
import { visiblePhotoQualityReason } from "../imageQuality";


describe("PhotoQuality", () => {
  it("shows a rounded percentage and caution label", () => {
    render(<PhotoQuality score={50.4} />);

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Usable with caution")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Photo quality 50 percent" }),
    ).toHaveAttribute("value", "50");
  });

  it("supports legacy observations without a persisted score", () => {
    render(<PhotoQuality score={null} />);

    expect(screen.getByText("Not scored")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("removes the legacy sharpness sentence without hiding other warnings", () => {
    expect(
      visiblePhotoQualityReason(
        "Image is not sufficiently sharp; Image is too dark",
      ),
    ).toBe("Image is too dark");
    expect(
      visiblePhotoQualityReason("Image is not sufficiently sharp"),
    ).toBeNull();
  });
});
