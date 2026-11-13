// --- Típusdefiníciók ---

export type BookingStatus = "confirmed" | "pending" | "cancelled";

export interface BusinessHours {
  start: string; // HH:mm formátum, pl. '08:00'
  end: string;   // HH:mm formátum, pl. '17:00'
}

export interface Booking {
  id: string;
  start: string; // HH:mm
  end: string;   // HH:mm
  status: BookingStatus;
  lockedUntil?: Date; // Opcionális, csak 'pending' esetén releváns
}

export interface ManualBlockout {
  start: string; // HH:mm
  end: string;   // HH:mm
}

export interface CalculateSlotsParams {
  date: Date;
  businessHours: BusinessHours;
  serviceDuration: number; // percben
  slotIntervalMinutes: number;
  existingBookings: Booking[];
  manualBlockouts: ManualBlockout[];
  maxConcurrentBookings?: number;
}

interface TimeRange {
  startMin: number;
  endMin: number;
}

// --- Segédfüggvények ---

/**
 * Átalakítja a "HH:mm" formátumot a nap kezdete óta eltelt percekre.
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Visszaalakítja a perceket "HH:mm" formátumú stringgé.
 */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Ellenőrzi, hogy két idősáv fedi-e egymást.
 */
function isOverlapping(slot: TimeRange, block: TimeRange): boolean {
  // Egy idősáv átfedi a másikat, ha az egyik kezdete hamarabb van, mint a másik vége, 
  // ÉS az egyik vége később van, mint a másik kezdete.
  return slot.startMin < block.endMin && slot.endMin > block.startMin;
}

/**
 * Kiszűri és egységes TimeRange formátumra hozza a manuális tiltásokat és az aktív foglalásokat.
 */
function partitionBlockedRanges(
  bookings: Booking[],
  blockouts: ManualBlockout[],
  now: Date
): { blockoutRanges: TimeRange[]; bookingRanges: TimeRange[] } {
  const blockoutRanges: TimeRange[] = blockouts.map((block) => ({
    startMin: timeToMinutes(block.start),
    endMin: timeToMinutes(block.end),
  }));

  const bookingRanges: TimeRange[] = [];
  for (const booking of bookings) {
    const isConfirmed = booking.status === 'confirmed';
    const isLockedPending =
      booking.status === 'pending' &&
      Boolean(booking.lockedUntil && booking.lockedUntil > now);

    if (isConfirmed || isLockedPending) {
      bookingRanges.push({
        startMin: timeToMinutes(booking.start),
        endMin: timeToMinutes(booking.end),
      });
    }
  }

  return { blockoutRanges, bookingRanges };
}

// --- Fő függvény ---

/**
 * Kiszámolja a megadott napra a foglalható idősávokat.
 */
export function calculateAvailableSlots(params: CalculateSlotsParams): string[] {
  const {
    businessHours,
    serviceDuration,
    slotIntervalMinutes,
    existingBookings,
    manualBlockouts,
    maxConcurrentBookings = 1,
  } = params;
  if (!Number.isInteger(serviceDuration) || serviceDuration <= 0) {
    throw new RangeError('A szolgáltatás időtartamának pozitív egész számnak kell lennie.');
  }
  if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes <= 0) {
    throw new RangeError('Az időpontok lépésközének pozitív egész számnak kell lennie.');
  }
  const capacity = Math.max(1, Math.floor(maxConcurrentBookings));

  const availableSlots: string[] = [];
  
  // Ezt az időpontot használjuk a pending foglalások lejáratának ellenőrzéséhez
  const now = new Date(); 

  const startOfDayMin = timeToMinutes(businessHours.start);
  const endOfDayMin = timeToMinutes(businessHours.end);
  const slotDuration =
    Math.ceil(serviceDuration / slotIntervalMinutes) * slotIntervalMinutes;

  const { blockoutRanges, bookingRanges } = partitionBlockedRanges(
    existingBookings,
    manualBlockouts,
    now
  );

  // Idősávok generálása és szűrése
  let currentSlotStart = startOfDayMin;

  while (currentSlotStart + serviceDuration <= endOfDayMin) {
    const currentSlotEnd = currentSlotStart + slotDuration;
    
    const currentSlotRange: TimeRange = {
      startMin: currentSlotStart,
      endMin: currentSlotEnd,
    };

    const hasManualBlockout = blockoutRanges.some((block) =>
      isOverlapping(currentSlotRange, block)
    );
    let overlappingBookingsCount = 0;
    if (!hasManualBlockout) {
      for (const range of bookingRanges) {
        if (isOverlapping(currentSlotRange, range)) {
          overlappingBookingsCount += 1;
          if (overlappingBookingsCount >= capacity) {
            break;
          }
        }
      }
    }

    if (!hasManualBlockout && overlappingBookingsCount < capacity) {
      availableSlots.push(minutesToTime(currentSlotStart));
    }

    // Lépés a következő idősávra
    currentSlotStart += slotIntervalMinutes;
  }

  return availableSlots;
}