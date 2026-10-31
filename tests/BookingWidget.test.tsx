import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookingWidget from "../components/BookingWidget";

const service = {
  id: "service-1",
  nev: "Olajcsere",
  idotartam_percben: 45,
  ar: "12500",
};

const authMock = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("../lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({ auth: authMock }),
}));

const mockBookings = Array.from({ length: 35 }, (_, index) => {
  const date = new Date("2030-01-14T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index);
  return {
    slotStart: `${date.toISOString().slice(0, 10)}T08:00:00.000Z`,
    available: false,
  };
});

const currentWeekSlots = [
  ...mockBookings,
  { slotStart: "2030-01-15T08:30:00.000Z", available: true },
];

function renderWidget(services = [service]) {
  return render(
    <BookingWidget
      companyId="company-1"
      companyName="Minta Szerviz"
      companySlug="minta-szerviz"
      initialDay="2030-01-15"
      primaryColor="#1d4ed8"
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

  it("renders a seven-day aligned grid with disabled, struck-through booked slots", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ slots: currentWeekSlots }), {
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

    expect(await screen.findByRole("grid", { name: "Heti időpontnaptár" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(screen.getByRole("button", { name: /09:00 foglalt, .*hétfő/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /09:00 foglalt, .*hétfő/ })).toHaveClass(
      "line-through",
      "text-red-500",
    );
    expect(screen.getByRole("button", { name: /09:30 szabad, .*kedd/ })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("weekStart=2030-01-14"),
      expect.any(Object),
    );
    expect(mockBookings).toHaveLength(35);
  });

  it("navigates between weeks and loads the selected week's grid", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ slots: currentWeekSlots }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            slots: [{ slotStart: "2030-01-21T08:00:00.000Z", available: false }],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ slots: currentWeekSlots }), {
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
    await screen.findByRole("grid", { name: "Heti időpontnaptár" });

    await user.click(screen.getByRole("button", { name: "Következő hét" }));

    expect(await screen.findByRole("button", { name: /09:00 foglalt, .*hétfő/ })).toBeDisabled();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("weekStart=2030-01-21"),
      expect.any(Object),
    );
    await user.click(screen.getByRole("button", { name: "Előző hét" }));
    expect(await screen.findByRole("button", { name: /09:00 foglalt, .*hétfő/ })).toBeDisabled();
  });

  it("completes service selection, slot locking, and booking confirmation", async () => {
    const user = userEvent.setup();
    authMock.signInWithOtp.mockResolvedValue({ error: null });
    authMock.verifyOtp.mockResolvedValue({ error: null });
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ slots: currentWeekSlots }),
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

    const slot = await screen.findByRole("button", { name: /09:30 szabad, .*kedd/ });
    await user.click(slot);

    expect(await screen.findByRole("heading", { name: "3. Személyes adatok" })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      companyId: "company-1",
      serviceIds: ["service-1"],
      start: "2030-01-15T08:30:00.000Z",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      vehicleRegistration: "ABC123",
    });

    await user.type(screen.getByLabelText("Név"), "Teszt Elek");
    await user.type(screen.getByLabelText("E-mail-cím"), "teszt@example.com");
    await user.type(screen.getByLabelText("Telefonszám"), "+3612345678");

    await user.click(screen.getByRole("button", { name: "E-mail-cím megerősítése" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A foglalás folytatásához el kell fogadnod",
    );
    expect(authMock.signInWithOtp).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", {
        name: /Elolvastam és elfogadom az Adatkezelési Tájékoztatót/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "E-mail-cím megerősítése" }));
    expect(authMock.signInWithOtp).toHaveBeenCalledWith({
      email: "teszt@example.com",
      options: { shouldCreateUser: true },
    });

    await user.type(screen.getByLabelText("E-mail-megerősítő kód"), "123456");
    await user.click(screen.getByRole("button", { name: "Kód ellenőrzése" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Az e-mail-címed megerősítve.",
    );
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
      privacyAccepted: true,
    });
  });

  it("shows API failures and removes a slot that could not be reserved", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ slots: currentWeekSlots }), {
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
    await user.click(
      await screen.findByRole("button", { name: /09:30 szabad, .*kedd/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Az időpont zárolása nem sikerült.",
    );
    expect(screen.getByRole("button", { name: /09:30 foglalt, .*kedd/ })).toBeDisabled();
  });
});
