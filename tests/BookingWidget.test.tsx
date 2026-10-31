import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookingWidget from "../components/BookingWidget";

const service = {
  id: "service-1",
  nev: "Olajcsere",
  idotartam_percben: 45,
  ar: "12500",
};

function renderWidget(services = [service]) {
  return render(
    <BookingWidget
      companyId="company-1"
      companyName="Minta Szerviz"
      companySlug="minta-szerviz"
      initialDay="2030-01-15"
      services={services}
      slotIntervalMinutes={15}
      timeZone="Europe/Budapest"
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BookingWidget", () => {
  it("shows an empty service message and prevents proceeding without a selection", () => {
    renderWidget([]);

    expect(
      screen.getByText("Jelenleg nincs foglalható szolgáltatás."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Szolgáltatások")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tovább az időpontokhoz" })).toBeDisabled();
  });

  it("adds a service, displays its price and duration, and allows it to be removed", async () => {
    const user = userEvent.setup();
    renderWidget();

    await user.selectOptions(screen.getByLabelText("Szolgáltatások"), "service-1");

    expect(screen.getByText(/Összesen:/)).toHaveTextContent("12 500 Ft");
    expect(screen.getByText(/Összesen:/)).toHaveTextContent("45 perc");

    await user.click(screen.getByRole("button", { name: "Olajcsere eltávolítása" }));

    expect(screen.queryByText("Kiválasztott szolgáltatások")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tovább az időpontokhoz" })).toBeDisabled();
  });

  it("completes service selection, slot locking, and booking confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ slots: ["2030-01-15T09:00:00+01:00"] }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bookingId: "booking-1",
            lockToken: "lock-token",
            lockedUntil: new Date(Date.now() + 300_000).toISOString(),
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ warning: "Az e-mail nem küldhető el." }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderWidget();

    await user.type(screen.getByLabelText("Márka"), "Honda");
    await user.type(screen.getByLabelText("Modell"), "Civic");
    await user.type(screen.getByLabelText("Rendszám"), "ABC123");
    await user.selectOptions(screen.getByLabelText("Szolgáltatások"), "service-1");
    await user.click(screen.getByRole("button", { name: "Tovább az időpontokhoz" }));

    const slot = await screen.findByRole("button", { name: "09:00" });
    await user.click(slot);

    expect(await screen.findByRole("heading", { name: "3. Személyes adatok" })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      companyId: "company-1",
      serviceIds: ["service-1"],
      start: "2030-01-15T09:00:00+01:00",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      vehicleRegistration: "ABC123",
    });

    await user.type(screen.getByLabelText("Név"), "Teszt Elek");
    await user.type(screen.getByLabelText("E-mail-cím"), "teszt@example.com");
    await user.type(screen.getByLabelText("Telefonszám"), "+3612345678");
    await user.click(
      screen.getByRole("button", { name: "Foglalás megerősítése" }),
    );

    expect(await screen.findByRole("heading", { name: "Sikeres foglalás!" })).toBeInTheDocument();
    expect(screen.getByText("Az e-mail nem küldhető el.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({
      lockToken: "lock-token",
      name: "Teszt Elek",
      email: "teszt@example.com",
      phone: "+3612345678",
    });
  });

  it("shows API failures and removes a slot that could not be reserved", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ slots: ["2030-01-15T09:00:00+01:00"] }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Az időpont zárolása nem sikerült." }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderWidget();
    await user.type(screen.getByLabelText("Márka"), "Honda");
    await user.type(screen.getByLabelText("Modell"), "Civic");
    await user.type(screen.getByLabelText("Rendszám"), "ABC123");
    await user.selectOptions(screen.getByLabelText("Szolgáltatások"), "service-1");
    await user.click(screen.getByRole("button", { name: "Tovább az időpontokhoz" }));
    await user.click(await screen.findByRole("button", { name: "09:00" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Az időpont zárolása nem sikerült.",
    );
    await waitFor(() => {
      expect(screen.getByText("Erre a napra nincs szabad időpont.")).toBeInTheDocument();
    });
  });
});
