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
const secondService = {
  id: "service-2",
  nev: "Fékellenőrzés",
  idotartam_percben: 30,
  ar: "5000",
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

const currentMonthSlots = [
  ...mockBookings,
  { slotStart: "2030-01-15T08:30:00.000Z", available: true },
];
type BookingField = (typeof fields)[number];

const fields = [
  { key: "rendszam", label: "Rendszám", type: "text" as const, required: true },
  { key: "marka", label: "Márka", type: "text" as const, required: false },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFetchMock(
  slots = currentMonthSlots,
  lockResponse: Response = jsonResponse({
    bookingId: "booking-1",
    lockToken: "lock-token",
    lockedUntil: new Date(Date.now() + 300_000).toISOString(),
  }),
) {
  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/slots")) {
      const weekStart = url.searchParams.get("weekStart") ?? "";
      const weekEnd = new Date(`${weekStart}T00:00:00.000Z`);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const weekSlots = slots.filter((slot) => {
        const slotDate = slot.slotStart.slice(0, 10);
        return slotDate >= weekStart && slotDate < weekEnd.toISOString().slice(0, 10);
      });
      return Promise.resolve(jsonResponse({ slots: weekSlots }));
    }
    if (url.pathname.endsWith("/lock")) return Promise.resolve(lockResponse);
    if (url.pathname.endsWith("/confirm")) {
      return Promise.resolve(
        jsonResponse({ warning: "Az e-mail nem küldhető el." }),
      );
    }
    return Promise.resolve(jsonResponse({ error: "Ismeretlen kérés." }, 404));
  });
}

function renderWidget(
  services: (typeof service)[] = [service],
  customBookingFields: BookingField[] = [],
) {
  return render(
    <BookingWidget
      companyId="company-1"
      companyName="Minta Szerviz"
      companySlug="minta-szerviz"
      customBookingFields={customBookingFields}
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
  authMock.signInWithOtp.mockReset();
  authMock.verifyOtp.mockReset();
});

describe("BookingWidget", () => {
  it("shows an empty service message and prevents proceeding without a selection", () => {
    renderWidget([]);

    expect(
      screen.getByText("Jelenleg nincs foglalható szolgáltatás."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Szolgáltatások" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tovább az időpontokhoz" })).toBeDisabled();
  });

  it("toggles multiple service cards in place", async () => {
    const user = userEvent.setup();
    renderWidget([service, secondService]);

    const first = screen.getByRole("button", { name: "Olajcsere" });
    await user.click(first);
    await user.click(screen.getByRole("button", { name: "Fékellenőrzés" }));

    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveClass("bg-yellow-100", "border-yellow-400");
    expect(screen.getByText(/Összesen:/)).toHaveTextContent("17 500 Ft");
    expect(screen.getByText(/Összesen:/)).toHaveTextContent("75 perc");
  });

  it("renders a monthly calendar and only the selected day's available slots", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Olajcsere" }));
    await user.click(screen.getByRole("button", { name: "Tovább az időpontokhoz" }));

    expect(
      await screen.findByLabelText("Havi naptár – nap kiválasztása"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Délelőtt" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Délután" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /09:30 szabad, .*kedd/ }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: /09:00 foglalt/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).includes("weekStart=2029-12-31"),
      ),
    ).toBe(true);

    const selectedWednesday = new Intl.DateTimeFormat("hu-HU", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date("2030-01-16T12:00:00.000Z"));
    await user.click(screen.getByRole("button", { name: selectedWednesday }));
    expect(
      screen.queryByRole("button", { name: /09:30 szabad, .*szerda/ }),
    ).not.toBeInTheDocument();
  });

  it("generates tenant-defined fields and requires only configured required values", async () => {
    const user = userEvent.setup();
    renderWidget([service], fields);
    expect(screen.getByLabelText("Rendszám *")).toBeRequired();
    expect(screen.getByLabelText("Márka")).not.toBeRequired();
    await user.click(screen.getByRole("button", { name: "Olajcsere" }));
    expect(screen.getByRole("button", { name: "Tovább az időpontokhoz" })).toBeDisabled();
    await user.type(screen.getByLabelText("Rendszám *"), "ABC123");
    expect(screen.getByRole("button", { name: "Tovább az időpontokhoz" })).toBeEnabled();
  });

  it("locks a slot and completes confirmation with the custom booking values", async () => {
    const user = userEvent.setup();
    authMock.signInWithOtp.mockResolvedValue({ error: null });
    authMock.verifyOtp.mockResolvedValue({ error: null });
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWidget([service], fields);

    await user.type(screen.getByLabelText("Rendszám *"), "ABC123");
    await user.type(screen.getByLabelText("Márka"), "Honda");
    await user.click(screen.getByRole("button", { name: "Olajcsere" }));
    await user.click(screen.getByRole("button", { name: "Tovább az időpontokhoz" }));
    await user.click(
      await screen.findByRole("button", { name: /09:30 szabad, .*kedd/ }),
    );

    expect(
      await screen.findByRole("heading", { name: "3. Személyes adatok" }),
    ).toBeInTheDocument();
    const lockCall = fetchMock.mock.calls.find(([request]) =>
      String(request).endsWith("/api/bookings/lock"),
    );
    expect(JSON.parse(lockCall?.[1]?.body as string)).toMatchObject({
      companyId: "company-1",
      serviceIds: ["service-1"],
      start: "2030-01-15T08:30:00.000Z",
      customFields: { rendszam: "ABC123", marka: "Honda" },
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
    await user.click(screen.getByRole("button", { name: "Foglalás megerősítése" }));

    expect(
      await screen.findByRole("heading", { name: "Sikeres foglalás!" }),
    ).toBeInTheDocument();
    const confirmationCall = fetchMock.mock.calls.find(([request]) =>
      String(request).endsWith("/api/bookings/confirm"),
    );
    expect(JSON.parse(confirmationCall?.[1]?.body as string)).toEqual({
      lockToken: "lock-token",
      name: "Teszt Elek",
      email: "teszt@example.com",
      phone: "+3612345678",
      privacyAccepted: true,
    });
  });

  it("shows booking errors and removes a slot that could not be reserved", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock(
      currentMonthSlots,
      jsonResponse({ error: "Az időpont zárolása nem sikerült." }, 409),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Olajcsere" }));
    await user.click(screen.getByRole("button", { name: "Tovább az időpontokhoz" }));
    await user.click(
      await screen.findByRole("button", { name: /09:30 szabad, .*kedd/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Az időpont zárolása nem sikerült.",
    );
    expect(
      screen.queryByRole("button", { name: /09:30 szabad, .*kedd/ }),
    ).not.toBeInTheDocument();
  });
});
