import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DashboardLoading from "../app/dashboard/loading";

describe("DashboardLoading", () => {
  it("shows an accessible dashboard skeleton while loading", () => {
    const { container } = render(<DashboardLoading />);

    expect(screen.getByRole("status", { name: "Dashboard betöltése" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByText("A foglalási adatok betöltése folyamatban."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });
});
