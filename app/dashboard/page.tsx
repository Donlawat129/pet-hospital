// app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/* ---------- Services config (ใช้เหมือนหน้า /services) ---------- */

type ServiceId = "bath" | "groom" | "nail" | "combo";

const SERVICES: {
  id: ServiceId;
  icon: string;
  title: string;
}[] = [
  { id: "bath", icon: "💦", title: "อาบน้ำทำความสะอาด" },
  { id: "groom", icon: "✂️", title: "ตัดแต่งขน" },
  { id: "nail", icon: "🐾", title: "ตัดเล็บ & ทำความสะอาดอุ้งเท้า" },
  { id: "combo", icon: "🎀", title: "อาบน้ำ & ตัดแต่งขน" },
];

const serviceTitleMap: Record<ServiceId, string> = SERVICES.reduce(
  (acc, s) => ({ ...acc, [s.id]: s.title }),
  {} as Record<ServiceId, string>,
);

/* ---------- helper วันที่ ---------- */

const TH_DOW = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
];
const TH_MONTH_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

function formatThaiDateShort(d: Date): string {
  const dow = TH_DOW[d.getDay()];
  const day = d.getDate();
  const month = TH_MONTH_SHORT[d.getMonth()];
  return `${dow} ${day} ${month}`;
}

function formatThaiDateFull(d: Date): string {
  const day = d.getDate();
  const month = TH_MONTH_SHORT[d.getMonth()];
  const year = d.getFullYear() + 543;
  return `${day} ${month} ${year}`;
}

// เวลา "HH:MM" → นาทีจาก 00:00 (ใช้ sort)
function parseTimeToMinutes(time: string): number {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

// นาที → "HH:MM" สำหรับสร้าง slot สวย ๆ
function minutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hh = String(Math.max(0, Math.min(23, h))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, m))).padStart(2, "0");
  return `${hh}:${mm}`;
}

/* ---------- helper แปลงวันที่เป็น YMD ---------- */

function todayYMD(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToDate(ymd: string): Date {
  const [yStr, mStr, dStr] = ymd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const res = new Date();
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return res;
  }
  res.setFullYear(y, m - 1, d);
  res.setHours(0, 0, 0, 0);
  return res;
}

/* ---------- default time slots (ใช้เป็นค่าเริ่มต้นถ้าไม่มี config) ---------- */

const DEFAULT_TIME_SLOTS: string[] = [
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
];

// สร้างรายการ timeSlots จาก เวลาเริ่ม / เวลาสิ้นสุด / ช่วงห่าง (นาที)
function buildSlotsFromConfig(
  startTime: string,
  endTime: string,
  intervalMinutesRaw: string,
): string[] {
  const step = Number(intervalMinutesRaw);
  if (!Number.isFinite(step) || step <= 0) return [];

  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start >= end) return [];

  const result: string[] = [];
  // safety: ไม่เกิน 24 ชั่วโมง
  for (let t = start, guard = 0; t <= end && guard < 200; t += step, guard++) {
    result.push(minutesToTimeStr(t));
  }
  return result;
}

/* ---------- types ---------- */

type AdminBookingRow = {
  id: string;
  userId: string;
  userEmail: string;
  serviceId: ServiceId;
  serviceTitle: string;
  date: Date;
  time: string;
  note: string;
  createdAt: Date | null;

  // ---- ฟิลด์ใหม่ ----
  ownerName: string;
  petName: string;
  petWeightKg: number | null;
};

type BookingDocData = {
  userId?: string;
  userEmail?: string;
  serviceId?: string;
  serviceTitle?: string;
  date?: Timestamp;
  time?: string;
  note?: string;
  createdAt?: Timestamp;

  // ---- ฟิลด์ใหม่ใน Firestore ----
  ownerName?: string;
  petName?: string;
  petWeightKg?: number;
};

type ServicesConfigDoc = {
  timeSlots?: string[];
  prices?: Partial<Record<ServiceId, number>>;
};

type DayConfigDoc = {
  dateKey?: string;
  isClosed?: boolean;
  startTime?: string;
  endTime?: string;
  intervalMinutes?: number;
  timeSlots?: string[];
  prices?: Partial<Record<ServiceId, number>>;
  updatedAt?: Timestamp;
};

type MonthlyBookingRow = {
  id: string;
  serviceId: ServiceId;
  serviceTitle: string;
  date: Date;
};

export default function AdminDashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);

  // วันที่ที่เลือก (ใช้ทั้งดูคิวและตั้งค่าเวลา)
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayYMD());
  const selectedDate = useMemo(
    () => ymdToDate(selectedDateStr),
    [selectedDateStr],
  );

  const [bookings, setBookings] = useState<AdminBookingRow[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---------- state สำหรับตั้งค่าเวลาเปิด + ราคา ---------- */

  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // ปิดรับจองทั้งวัน?
  const [isClosed, setIsClosed] = useState(false);

  // config ที่เป็น "ค่าเริ่มต้น" จาก settings/servicesConfig (ใช้เป็น template เวลาไม่มี config รายวัน)
  const [defaultConfig, setDefaultConfig] = useState<{
    startTime: string;
    endTime: string;
    intervalMinutes: string;
    priceInputs: Record<ServiceId, string>;
  } | null>(null);

  // state ที่ใช้งานจริงในฟอร์ม (สำหรับ "วันที่ที่เลือก")
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("18:00");
  const [intervalMinutes, setIntervalMinutes] = useState("30");

  const [priceInputs, setPriceInputs] = useState<Record<ServiceId, string>>({
    bath: "",
    groom: "",
    nail: "",
    combo: "",
  });

  // preview ช่วงเวลา (ถ้าปิดร้านทั้งวัน จะไม่แสดง slot)
  const slotsPreview = useMemo(
    () =>
      isClosed ? [] : buildSlotsFromConfig(startTime, endTime, intervalMinutes),
    [startTime, endTime, intervalMinutes, isClosed],
  );

  /* ---------- Tab state ---------- */

  const [activeTab, setActiveTab] = useState<"today" | "monthly">("today");

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });

  const [monthlyBookings, setMonthlyBookings] = useState<MonthlyBookingRow[]>(
    [],
  );
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  /* ---------- เช็ค login + role admin ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        router.replace("/");
        return;
      }

      setUser(firebaseUser);
      setCheckingAuth(false);

      try {
        const ref = doc(db, "users", firebaseUser.uid);
        const snap = await getDoc(ref);
        const data = snap.data() as { role?: string } | undefined;

        if (data?.role === "admin") {
          setIsAdmin(true);
        } else {
          // ถ้าไม่ใช่ admin ส่งกลับไปหน้า services
          router.replace("/services");
        }
      } catch (err) {
        console.error("โหลด role ไม่สำเร็จ", err);
        router.replace("/services");
      } finally {
        setCheckingRole(false);
      }
    });

    return () => unsub();
  }, [router]);

  /* ---------- โหลด config ค่าเริ่มต้น (global) จาก settings/servicesConfig ---------- */

  useEffect(() => {
    if (!isAdmin || checkingAuth || checkingRole) return;

    (async () => {
      try {
        const ref = doc(db, "settings", "servicesConfig");
        const snap = await getDoc(ref);

        let baseStart = "10:00";
        let baseEnd = "18:00";
        let baseInterval = "30";
        const basePrices: Record<ServiceId, string> = {
          bath: "",
          groom: "",
          nail: "",
          combo: "",
        };

        if (snap.exists()) {
          const data = snap.data() as ServicesConfigDoc;
          let slots = Array.isArray(data.timeSlots)
            ? data.timeSlots.map((t) => String(t).trim()).filter(Boolean)
            : [];

          if (slots.length === 0) {
            slots = [...DEFAULT_TIME_SLOTS];
          }

          // sort จากเช้าไปเย็น
          slots.sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));

          baseStart = slots[0] ?? baseStart;
          baseEnd = slots[slots.length - 1] ?? baseEnd;

          // เดาว่าช่วงห่างจากความแตกต่างที่น้อยที่สุดระหว่างสองช่วงเวลา
          let guessedInterval: number | null = null;
          for (let i = 1; i < slots.length; i++) {
            const prev = parseTimeToMinutes(slots[i - 1]);
            const curr = parseTimeToMinutes(slots[i]);
            const diff = curr - prev;
            if (
              diff > 0 &&
              (guessedInterval === null || diff < guessedInterval)
            ) {
              guessedInterval = diff;
            }
          }

          baseInterval = String(guessedInterval ?? Number(baseInterval));

          if (data.prices) {
            (["bath", "groom", "nail", "combo"] as ServiceId[]).forEach(
              (id) => {
                const v = data.prices?.[id];
                basePrices[id] =
                  typeof v === "number" && Number.isFinite(v) ? String(v) : "";
              },
            );
          }
        }

        const cfg = {
          startTime: baseStart,
          endTime: baseEnd,
          intervalMinutes: baseInterval,
          priceInputs: basePrices,
        };

        setDefaultConfig(cfg);

        // ใช้ default เป็นค่าเริ่มต้นของหน้าฟอร์ม (ถ้ายังไม่มี config รายวันมาทับ)
        setStartTime(cfg.startTime);
        setEndTime(cfg.endTime);
        setIntervalMinutes(cfg.intervalMinutes);
        setPriceInputs(cfg.priceInputs);
      } catch (err) {
        console.error("โหลด servicesConfig ไม่สำเร็จ", err);
        const cfg = {
          startTime: "10:00",
          endTime: "18:00",
          intervalMinutes: "30",
          priceInputs: {
            bath: "",
            groom: "",
            nail: "",
            combo: "",
          } as Record<ServiceId, string>,
        };
        setDefaultConfig(cfg);
        setStartTime(cfg.startTime);
        setEndTime(cfg.endTime);
        setIntervalMinutes(cfg.intervalMinutes);
        setPriceInputs(cfg.priceInputs);
      }
    })();
  }, [isAdmin, checkingAuth, checkingRole]);

  /* ---------- โหลด config เฉพาะ "วันที่ที่เลือก" จาก collection bookingDayConfigs ---------- */

  useEffect(() => {
    if (!isAdmin || checkingAuth || checkingRole) return;
    if (!selectedDateStr) return;

    (async () => {
      setConfigLoading(true);
      setConfigError(null);

      try {
        const ref = doc(db, "bookingDayConfigs", selectedDateStr);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          // ไม่มี config เฉพาะวัน → fallback ใช้ default config ถ้ามี
          setIsClosed(false);
          if (defaultConfig) {
            setStartTime(defaultConfig.startTime);
            setEndTime(defaultConfig.endTime);
            setIntervalMinutes(defaultConfig.intervalMinutes);
            setPriceInputs(defaultConfig.priceInputs);
          }
        } else {
          const data = snap.data() as DayConfigDoc;

          setIsClosed(Boolean(data.isClosed));

          const nextStart =
            data.startTime ?? defaultConfig?.startTime ?? "10:00";
          const nextEnd = data.endTime ?? defaultConfig?.endTime ?? "18:00";
          const nextInterval =
            typeof data.intervalMinutes === "number" &&
            Number.isFinite(data.intervalMinutes)
              ? String(data.intervalMinutes)
              : (defaultConfig?.intervalMinutes ?? "30");

          setStartTime(nextStart);
          setEndTime(nextEnd);
          setIntervalMinutes(nextInterval);

          const nextPrices: Record<ServiceId, string> = {
            bath: "",
            groom: "",
            nail: "",
            combo: "",
          };

          if (data.prices) {
            (["bath", "groom", "nail", "combo"] as ServiceId[]).forEach(
              (id) => {
                const v = data.prices?.[id];
                nextPrices[id] =
                  typeof v === "number" && Number.isFinite(v) ? String(v) : "";
              },
            );
          }

          // ถ้ายังไม่มีราคาใน doc นี้เลย แต่มี defaultConfig → ใช้ default เป็นค่าเริ่มต้น
          if (!data.prices && defaultConfig) {
            (["bath", "groom", "nail", "combo"] as ServiceId[]).forEach(
              (id) => {
                if (!nextPrices[id] && defaultConfig.priceInputs[id]) {
                  nextPrices[id] = defaultConfig.priceInputs[id];
                }
              },
            );
          }

          setPriceInputs(nextPrices);
        }
      } catch (err) {
        console.error("โหลด config สำหรับวันที่เลือกไม่สำเร็จ", err);
        setConfigError("โหลดการตั้งค่าสำหรับวันที่เลือกไม่สำเร็จ");
        setIsClosed(false);
        if (defaultConfig) {
          setStartTime(defaultConfig.startTime);
          setEndTime(defaultConfig.endTime);
          setIntervalMinutes(defaultConfig.intervalMinutes);
          setPriceInputs(defaultConfig.priceInputs);
        }
      } finally {
        setConfigLoading(false);
      }
    })();
  }, [isAdmin, checkingAuth, checkingRole, selectedDateStr, defaultConfig]);

  async function handleSaveConfig() {
    setConfigError(null);

    if (!selectedDateStr) {
      setConfigError("กรุณาเลือกวันที่ที่จะตั้งค่าก่อน");
      return;
    }

    // ถ้าปิดรับจองทั้งวัน ไม่ต้องบังคับเวลา ให้ timeSlots = [] ได้เลย
    let slots: string[] = [];

    if (!isClosed) {
      slots = buildSlotsFromConfig(startTime, endTime, intervalMinutes);

      if (slots.length === 0) {
        setConfigError(
          "กรุณาตั้งเวลาเริ่มต้น / เวลาสิ้นสุด และช่วงห่างให้ถูกต้อง (เช่น 10:00 - 18:00 ทุก 30 นาที)",
        );
        return;
      }

      // sort เผื่อกรณีอนาคต
      slots.sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));
    }

    // parse prices
    const prices: Partial<Record<ServiceId, number>> = {};
    (["bath", "groom", "nail", "combo"] as ServiceId[]).forEach((id) => {
      const raw = priceInputs[id].trim();
      if (!raw) return;
      const n = Number(raw.replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 0) {
        prices[id] = n;
      }
    });

    try {
      setConfigSaving(true);
      const ref = doc(db, "bookingDayConfigs", selectedDateStr);
      await setDoc(
        ref,
        {
          dateKey: selectedDateStr,
          isClosed,
          // ถ้าปิดร้านทั้งวันจะเก็บเวลาเดิม ๆ ก็ได้ แต่ timeSlots จะเป็น [] ไว้เป็น flag หลัก
          startTime,
          endTime,
          intervalMinutes: Number(intervalMinutes),
          timeSlots: slots,
          prices,
          updatedAt: Timestamp.now(),
        } satisfies DayConfigDoc & {
          dateKey: string;
          isClosed: boolean;
          intervalMinutes: number;
          timeSlots: string[];
        },
        { merge: true },
      );
    } catch (err) {
      console.error("บันทึก dayConfig ไม่สำเร็จ", err);
      setConfigError("ไม่สามารถบันทึกการตั้งค่าได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setConfigSaving(false);
    }
  }

  /* ---------- โหลด bookings ของ "วันที่ที่เลือก" ---------- */
  useEffect(() => {
    if (!isAdmin || checkingAuth || checkingRole) return;
    if (!selectedDateStr) return;

    (async () => {
      setLoadingBookings(true);
      setError(null);

      try {
        const targetDate = ymdToDate(selectedDateStr);
        const ts = Timestamp.fromDate(targetDate);

        const q = query(collection(db, "bookings"), where("date", "==", ts));

        const snap = await getDocs(q);
        const rows: AdminBookingRow[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as BookingDocData;

          const dateTs = data.date;
          const createdAtTs = data.createdAt;

          const serviceId = (data.serviceId as ServiceId | undefined) ?? "bath";

          return {
            id: docSnap.id,
            userId: data.userId ?? "",
            userEmail: data.userEmail ?? "",
            serviceId,
            serviceTitle:
              data.serviceTitle ?? serviceTitleMap[serviceId] ?? "-",
            date: dateTs ? dateTs.toDate() : targetDate,
            time: data.time ?? "",
            note: data.note ?? "",
            createdAt: createdAtTs ? createdAtTs.toDate() : null,

            // ค่าใหม่ (fallback ถ้าเอกสารเก่ายังไม่มี field)
            ownerName: data.ownerName ?? "",
            petName: data.petName ?? "",
            petWeightKg:
              typeof data.petWeightKg === "number" ? data.petWeightKg : null,
          };
        });

        // sort ตามเวลา
        rows.sort((a, b) => {
          const aT = parseTimeToMinutes(a.time);
          const bT = parseTimeToMinutes(b.time);
          return aT - bT;
        });

        setBookings(rows);
      } catch (err) {
        console.error(err);
        setError("โหลดข้อมูลคิวไม่สำเร็จ");
      } finally {
        setLoadingBookings(false);
      }
    })();
  }, [isAdmin, checkingAuth, checkingRole, selectedDateStr]);

  /* ---------- โหลดสรุปคิวทั้งเดือน ---------- */
  useEffect(() => {
    if (!isAdmin || checkingAuth || checkingRole) return;
    if (!selectedMonth) return;

    (async () => {
      setLoadingMonthly(true);
      setMonthlyError(null);

      try {
        const [yearStr, monthStr] = selectedMonth.split("-");
        const year = Number(yearStr);
        const monthIndex = Number(monthStr) - 1; // 0-based
        if (
          !Number.isFinite(year) ||
          !Number.isFinite(monthIndex) ||
          monthIndex < 0 ||
          monthIndex > 11
        ) {
          throw new Error("รูปแบบเดือนไม่ถูกต้อง");
        }

        const start = new Date(year, monthIndex, 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(year, monthIndex + 1, 0);
        end.setHours(23, 59, 59, 999);

        const startTs = Timestamp.fromDate(start);
        const endTs = Timestamp.fromDate(end);

        const q = query(
          collection(db, "bookings"),
          where("date", ">=", startTs),
          where("date", "<=", endTs),
        );

        const snap = await getDocs(q);
        const rows: MonthlyBookingRow[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as BookingDocData;
          const dateTs = data.date;
          const serviceId = (data.serviceId as ServiceId | undefined) ?? "bath";
          const dateObj = dateTs ? dateTs.toDate() : start;
          dateObj.setHours(0, 0, 0, 0);

          return {
            id: docSnap.id,
            serviceId,
            serviceTitle:
              data.serviceTitle ?? serviceTitleMap[serviceId] ?? "-",
            date: dateObj,
          };
        });

        // sort ตามวันที่
        rows.sort((a, b) => a.date.getTime() - b.date.getTime());

        setMonthlyBookings(rows);
      } catch (err) {
        console.error(err);
        setMonthlyError("โหลดข้อมูลสรุปทั้งเดือนไม่สำเร็จ");
      } finally {
        setLoadingMonthly(false);
      }
    })();
  }, [isAdmin, checkingAuth, checkingRole, selectedMonth]);

  const monthlySummaryByService = useMemo(() => {
    const base: Record<ServiceId, number> = {
      bath: 0,
      groom: 0,
      nail: 0,
      combo: 0,
    };
    for (const b of monthlyBookings) {
      if (base[b.serviceId] != null) {
        base[b.serviceId] += 1;
      }
    }
    return base;
  }, [monthlyBookings]);

  type MonthlyDaySummary = {
    key: string;
    date: Date;
    total: number;
    byService: Record<ServiceId, number>;
  };

  const monthlyPerDaySummaries = useMemo<MonthlyDaySummary[]>(() => {
    const map = new Map<string, MonthlyDaySummary>();

    for (const b of monthlyBookings) {
      const d = new Date(b.date);
      d.setHours(0, 0, 0, 0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const key = `${yyyy}-${mm}-${dd}`;

      let summary = map.get(key);
      if (!summary) {
        summary = {
          key,
          date: d,
          total: 0,
          byService: {
            bath: 0,
            groom: 0,
            nail: 0,
            combo: 0,
          },
        };
        map.set(key, summary);
      }

      summary.total += 1;
      summary.byService[b.serviceId] =
        (summary.byService[b.serviceId] ?? 0) + 1;
    }

    return Array.from(map.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
  }, [monthlyBookings]);

  if (checkingAuth || checkingRole) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-linear-to-br from-emerald-50 via-white to-sky-50">
        <p className="text-sm text-slate-600">กำลังโหลดข้อมูลผู้ใช้...</p>
      </main>
    );
  }

  if (!user || !isAdmin) {
    return null;
  }

  async function handleLogout() {
    await signOut(auth);
    router.replace("/");
  }

  return (
    <main className="min-h-screen bg-linear-to-br from-emerald-50 via-white to-sky-50 px-4 py-8">
      <div className="mx-auto max-w-5xl bg-white/80 backdrop-blur border border-emerald-100 shadow-xl shadow-emerald-100 rounded-2xl px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-100">
              Admin Dashboard · คิวอาบน้ำตัดแต่งขน
            </span>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              จัดการคิว และตั้งค่าเวลาเปิดให้จอง
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              เลือกวันเพื่อดูคิว และตั้งค่าเวลา / ปิดรับจองล่วงหน้าได้เลย
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-slate-500">
              เข้าสู่ระบบด้วย:{" "}
              <span className="font-medium text-slate-800">{user.email}</span>
            </p>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => router.push("/services")}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white/80 hover:bg-slate-50 shadow-sm text-slate-700"
              >
                ไปหน้าจองคิว (มุมมองลูกค้า)
              </button>

              {/* ปุ่มไปหน้าประวัติทั้งหมด */}
              <button
                type="button"
                onClick={() => router.push("/dashboard/bookings-history")}
                className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 shadow-sm"
              >
                ประวัติการจองทั้งหมด
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 shadow-sm"
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 border-b border-emerald-100">
          <div className="inline-flex rounded-full bg-emerald-50 p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("today")}
              className={[
                "px-3 py-1.5 rounded-full font-medium transition-colors",
                activeTab === "today"
                  ? "bg-white text-emerald-700 shadow-sm border border-emerald-200"
                  : "text-emerald-600/80 hover:text-emerald-800",
              ].join(" ")}
            >
              คิวรายวัน & ตั้งค่าเวลาแต่ละวัน
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("monthly")}
              className={[
                "ml-1 px-3 py-1.5 rounded-full font-medium transition-colors",
                activeTab === "monthly"
                  ? "bg-white text-emerald-700 shadow-sm border border-emerald-200"
                  : "text-emerald-600/80 hover:text-emerald-800",
              ].join(" ")}
            >
              สรุปคิวทั้งเดือน
            </button>
          </div>
        </div>

        {activeTab === "today" ? (
          <>
            {/* ตารางคิวลูกค้า (วันที่เลือก) */}
            <section className="space-y-3 mt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">
                    รายการคิวของวันที่เลือก
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    วันที่ {formatThaiDateFull(selectedDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600">เลือกวันที่</span>
                  <input
                    type="date"
                    value={selectedDateStr}
                    onChange={(e) => setSelectedDateStr(e.target.value)}
                    className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
              </div>

              {loadingBookings && (
                <p className="text-sm text-slate-500">กำลังโหลดข้อมูลคิว...</p>
              )}

              {!loadingBookings && error && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {!loadingBookings && !error && bookings.length === 0 && (
                <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                  ยังไม่มีการจองคิวในวันที่เลือก
                </div>
              )}

              {!loadingBookings && !error && bookings.length > 0 && (
                <div className="space-y-2">
                  {bookings.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-emerald-700">
                          {b.serviceTitle}
                        </p>
                        <p className="text-xs text-slate-500">
                          เวลา {b.time} น. · {formatThaiDateFull(b.date)}
                        </p>

                        {/* แสดงเจ้าของ / สัตว์เลี้ยง / น้ำหนัก */}
                        {(b.ownerName ||
                          b.petName ||
                          b.petWeightKg !== null) && (
                          <p className="mt-1 text-xs text-slate-600">
                            {b.ownerName && (
                              <>
                                เจ้าของ:{" "}
                                <span className="font-medium">
                                  {b.ownerName}
                                </span>
                              </>
                            )}
                            {b.petName && (
                              <>
                                {b.ownerName ? " · " : ""}สัตว์เลี้ยง:{" "}
                                <span className="font-medium">{b.petName}</span>
                              </>
                            )}
                            {b.petWeightKg !== null && (
                              <>
                                {b.ownerName || b.petName ? " · " : ""}น้ำหนัก:{" "}
                                <span className="font-medium">
                                  {b.petWeightKg} กก.
                                </span>
                              </>
                            )}
                          </p>
                        )}

                        {b.note && (
                          <p className="mt-1 text-xs text-slate-600">
                            หมายเหตุลูกค้า: {b.note}
                          </p>
                        )}
                      </div>

                      <div className="text-right text-xs text-slate-500 space-y-1">
                        {(b.userEmail || b.userId) && (
                          <p>
                            ลูกค้า:{" "}
                            <span className="font-medium text-slate-700">
                              {b.userEmail || b.userId}
                            </span>
                          </p>
                        )}
                        {b.createdAt && (
                          <p className="text-[11px]">
                            สร้างเมื่อ:{" "}
                            {b.createdAt.toLocaleString("th-TH", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* การตั้งค่าเวลาเปิด & ราคา สำหรับ "วันที่ที่เลือก" */}
            <section className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-emerald-800">
                    ตั้งค่าช่วงเวลาเปิดให้จอง & ราคาต่อบริการ (ตามวันที่เลือก)
                  </h2>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    การตั้งค่านี้จะใช้กับหน้าจองคิวของลูกค้าในวันที่{" "}
                    {formatThaiDateFull(selectedDate)}
                  </p>
                </div>
                <div className="text-[11px] text-slate-500 text-right">
                  {configLoading
                    ? "กำลังโหลดการตั้งค่าสำหรับวันที่เลือก..."
                    : "เลือกเวลาเริ่ม–สิ้นสุด และช่วงห่าง หรือเลือกปิดรับจองทั้งวัน แล้วกดบันทึกด้านล่าง"}
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    สามารถตั้งค่าล่วงหน้าได้เลยหลายวัน
                  </div>
                </div>
              </div>

              {/* ปิดรับจองทั้งวัน */}
              <div className="flex items-center gap-2 rounded-xl bg-white/70 border border-amber-100 px-3 py-2">
                <input
                  id="isClosed"
                  type="checkbox"
                  checked={isClosed}
                  onChange={(e) => setIsClosed(e.target.checked)}
                  className="h-4 w-4 accent-amber-500"
                />
                <label
                  htmlFor="isClosed"
                  className="text-xs text-amber-800 cursor-pointer"
                >
                  ปิดรับจองทั้งวัน (หยุด / ไม่เปิดให้ลูกค้าจองในวันที่นี้)
                </label>
              </div>

              {isClosed && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  วันนี้ถูกตั้งค่าให้{" "}
                  <span className="font-semibold">ปิดรับจองทั้งวัน</span>{" "}
                  ลูกค้าจะไม่เห็นช่วงเวลาจองในวันที่นี้ (เมื่อไปปรับหน้า
                  /services ให้รองรับ).
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                {/* timeSlots editor ใหม่: ใช้ time picker + ช่วงห่าง */}
                <div
                  className={isClosed ? "opacity-60 pointer-events-none" : ""}
                >
                  <label className="block text-xs font-medium text-emerald-900 mb-1">
                    ช่วงเวลาที่เปิดให้จอง (เวลาเปิด–ปิด และช่วงห่าง)
                    ของวันที่เลือก
                  </label>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <p className="text-[11px] text-slate-500 mb-0.5">
                        เวลาเริ่มต้น
                      </p>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        disabled={isClosed}
                        className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50"
                      />
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 mb-0.5">
                        เวลาสิ้นสุด
                      </p>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        disabled={isClosed}
                        className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50"
                      />
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 mb-0.5">
                        ช่วงห่าง (นาที)
                      </p>
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={intervalMinutes}
                        onChange={(e) => setIntervalMinutes(e.target.value)}
                        disabled={isClosed}
                        className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50"
                        placeholder="เช่น 30"
                      />
                    </div>
                  </div>

                  <p className="mt-1 text-[11px] text-slate-500">
                    ระบบจะสร้างช่วงเวลาให้โดยอัตโนมัติ เช่น 10:00, 10:30, 11:00,
                    ... จนถึงเวลาสิ้นสุด และใช้กับวันที่ที่คุณเลือกเท่านั้น
                  </p>

                  <div className="mt-2">
                    <p className="text-[11px] font-medium text-emerald-900 mb-1">
                      ตัวอย่างช่วงเวลาที่จะเปิดให้จอง ในวันที่{" "}
                      {formatThaiDateShort(selectedDate)}
                    </p>
                    {slotsPreview.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {slotsPreview.map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] text-emerald-800"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      !isClosed && (
                        <p className="text-[11px] text-red-600">
                          กรุณาตั้งเวลาเริ่มต้น / เวลาสิ้นสุด
                          และช่วงห่างให้ถูกต้อง
                        </p>
                      )
                    )}
                    {isClosed && (
                      <p className="text-[11px] text-slate-500">
                        เนื่องจากวันนี้ปิดรับจอง จึงไม่แสดงช่วงเวลา
                      </p>
                    )}
                  </div>
                </div>

                {/* price editor */}
                <div>
                  <label className="block text-xs font-medium text-emerald-900 mb-1">
                    ราคาต่อครั้งของแต่ละบริการ (บาท) สำหรับวันที่เลือก
                  </label>
                  <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                    {SERVICES.map((s) => (
                      <div key={s.id}>
                        <p className="text-[11px] text-slate-500 mb-0.5 flex items-center gap-1">
                          <span>{s.icon}</span>
                          <span>{s.title}</span>
                        </p>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={priceInputs[s.id]}
                            onChange={(e) =>
                              setPriceInputs((prev) => ({
                                ...prev,
                                [s.id]: e.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                            placeholder="เช่น 350"
                          />
                          <span className="text-[11px] text-slate-500">
                            บาท
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    ถ้าปล่อยว่าง ระบบจะไม่แสดงราคาในหน้าลูกค้าสำหรับวันที่นี้
                  </p>
                </div>
              </div>

              {configError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  {configError}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={configSaving || configLoading}
                  className={[
                    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold shadow-sm",
                    "bg-emerald-600 text-white hover:bg-emerald-700",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  {configSaving
                    ? "กำลังบันทึกการตั้งค่าของวันที่เลือก..."
                    : "บันทึกการตั้งค่าวันนี้"}
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            {/* สรุปคิวทั้งเดือน */}
            <section className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">
                    สรุปคิวทั้งเดือน
                  </h2>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    ดูจำนวนคิวรวม และแยกตามบริการ ในเดือนที่เลือก
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600">เลือกเดือน</span>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
              </div>

              {loadingMonthly && (
                <p className="text-sm text-slate-500">
                  กำลังโหลดข้อมูลสรุปทั้งเดือน...
                </p>
              )}

              {!loadingMonthly && monthlyError && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {monthlyError}
                </div>
              )}

              {!loadingMonthly && !monthlyError && (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-3">
                      <p className="text-xs text-emerald-700">
                        คิวทั้งหมดในเดือนนี้
                      </p>
                      <p className="mt-1 text-2xl font-bold text-emerald-800">
                        {monthlyBookings.length}
                      </p>
                    </div>

                    {SERVICES.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3"
                      >
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <span>{s.icon}</span>
                          <span>{s.title}</span>
                        </p>
                        <p className="mt-1 text-xl font-semibold text-slate-800">
                          {monthlySummaryByService[s.id] ?? 0}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          จำนวนคิวของบริการนี้ในเดือนที่เลือก
                        </p>
                      </div>
                    ))}
                  </div>

                  {monthlyPerDaySummaries.length === 0 ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-emerald-200 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                      ยังไม่มีการจองในเดือนนี้
                    </div>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
                      <table className="min-w-full text-xs text-slate-700">
                        <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2 text-left">วันนัด</th>
                            <th className="px-3 py-2 text-left">คิวทั้งหมด</th>
                            <th className="px-3 py-2 text-left">
                              แยกตามบริการ
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyPerDaySummaries.map((d) => (
                            <tr
                              key={d.key}
                              className="border-t border-slate-100 hover:bg-emerald-50/40"
                            >
                              <td className="px-3 py-2 align-top">
                                <div className="text-xs text-slate-500">
                                  {formatThaiDateFull(d.date)}
                                </div>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="text-sm font-medium text-slate-800">
                                  {d.total.toLocaleString("th-TH")}
                                </div>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                                  {SERVICES.map((s) => {
                                    const count = d.byService[s.id] ?? 0;
                                    if (!count) return null;
                                    return (
                                      <span key={s.id}>
                                        {s.icon} {s.title}:{" "}
                                        <span className="font-medium">
                                          {count}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
