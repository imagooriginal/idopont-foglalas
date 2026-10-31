import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BlockoutManager from "../app/dashboard/BlockoutManager";

vi.mock("../app/dashboard/actions", () => ({
  createBlockoutAction: vi.fn(),
  deleteBlockoutAction: vi.fn(),
}));

describe("BlockoutManager", () => {
  it("shows an empty state and opens and closes the creation dialog", async () => {
    const user = userEvent.setup();
    render(
      <BlockoutManager companyId="company-1" timeZone="Europe/Budapest" blockouts={[]} />,
    );

    expect(screen.getByText("Nincs rögzített jövőbeli blokkolás.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Időpont blokkolása" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("A helyi időzóna: Europe/Budapest")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bezárás" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders scheduled blockouts and converts local inputs to the configured timezone", () => {
    render(
      <BlockoutManager
        companyId="company-1"
        timeZone="Europe/Budapest"
        blockouts={[
          {
            id: "blockout-1",
            kezdes_ideje: "2030-01-15T09:00:00.000Z",
            vege_ideje: "2030-01-15T10:00:00.000Z",
            megjegyzes: "Ebédszünet",
          },
        ]}
      />,
    );

    expect(screen.getByText("Ebédszünet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Időpont blokkolása" }));
    fireEvent.change(screen.getByLabelText("Kezdés"), {
      target: { value: "2030-01-15T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Befejezés"), {
      target: { value: "2030-01-15T11:00" },
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector('input[name="startsAt"]')).toHaveValue(
      "2030-01-15T09:00:00.000Z",
    );
    expect(dialog.querySelector('input[name="endsAt"]')).toHaveValue(
      "2030-01-15T10:00:00.000Z",
    );
  });

  it("rejects local times that do not exist during a daylight-saving transition", () => {
    render(
      <BlockoutManager companyId="company-1" timeZone="Europe/Budapest" blockouts={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Időpont blokkolása" }));
    fireEvent.change(screen.getByLabelText("Kezdés"), {
      target: { value: "2026-03-29T02:30" },
    });

    expect(
      screen.getByRole("dialog").querySelector('input[name="startsAt"]'),
    ).toHaveValue("");
  });
});
