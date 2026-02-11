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
  {} as Record<ServiceId, string>
);

/* ---------- helper วันที่ ---------- */

const TH_DOW = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const TH_MONTH_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
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

export default function AdminDashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);

  // filter date (14 วันถัดไป)
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: Date[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      result.push(d);
    }
    return result;
  }, []);

  const [selectedDateIndex, setSelectedDateIndex] = useState(0);

  const [bookings, setBookings] = useState<AdminBookingRow[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---------- state สำหรับตั้งค่าเวลาเปิด + ราคา ---------- */

  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [timeSlotsInput, setTimeSlotsInput] = useState("");
  const [priceInputs, setPriceInputs] = useState<Record<ServiceId, string>>({
    bath: "",
    groom: "",
    nail: "",
    combo: "",
  });

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

  /* ---------- โหลด config เวลาเปิด + ราคา ---------- */

  useEffect(() => {
    if (!isAdmin || checkingAuth || checkingRole) return;

    (async () => {
      setConfigLoading(true);
      setConfigError(null);

      try {
        const ref = doc(db, "settings", "servicesConfig");
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          // ยังไม่มี doc → ใช้ค่า default
          setTimeSlotsInput(DEFAULT_TIME_SLOTS.join(", "));
          setPriceInputs({
            bath: "",
            groom: "",
            nail: "",
            combo: "",
          });
          return;
        }

        const data = snap.data() as ServicesConfigDoc;

        // timeSlots
        const slots = Array.isArray(data.timeSlots)
          ? data.timeSlots.map((t) => String(t).trim()).filter(Boolean)
          : DEFAULT_TIME_SLOTS;

        setTimeSlotsInput(
          (slots.length > 0 ? slots : DEFAULT_TIME_SLOTS).join(", "),
        );

        // prices
        const nextPrices: Record<ServiceId, string> = {
          bath: "",
          groom: "",
          nail: "",
          combo: "",
        };

        if (data.prices) {
          (["bath", "groom", "nail", "combo"] as ServiceId[]).forEach((id) => {
            const v = data.prices?.[id];
            nextPrices[id] =
              typeof v === "number" && Number.isFinite(v) ? String(v) : "";
          });
        }

        setPriceInputs(nextPrices);
      } catch (err) {
        console.error("โหลด servicesConfig ไม่สำเร็จ", err);
        setConfigError("โหลดการตั้งค่าสำหรับบริการไม่สำเร็จ");
        setTimeSlotsInput(DEFAULT_TIME_SLOTS.join(", "));
      } finally {
        setConfigLoading(false);
      }
    })();
  }, [isAdmin, checkingAuth, checkingRole]);

  async function handleSaveConfig() {
    setConfigError(null);

    // 1) parse timeSlots จาก input
    const rawTokens = timeSlotsInput
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
    const slots: string[] = [];

    for (const t of rawTokens) {
      if (timeRegex.test(t) && !slots.includes(t)) {
        slots.push(t);
      }
    }

    if (slots.length === 0) {
      setConfigError("กรุณาระบุช่วงเวลาในรูปแบบ HH:MM อย่างน้อย 1 ช่วง");
      return;
    }

    // sort เวลาให้เป็นลำดับจากเช้าไปเย็น
    slots.sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));

    // 2) parse prices
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
      const ref = doc(db, "settings", "servicesConfig");
      await setDoc(
        ref,
        {
          timeSlots: slots,
          prices,
          updatedAt: Timestamp.now(),
        } satisfies ServicesConfigDoc & { updatedAt: Timestamp },
        { merge: true },
      );
    } catch (err) {
      console.error("บันทึก servicesConfig ไม่สำเร็จ", err);
      setConfigError("ไม่สามารถบันทึกการตั้งค่าได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setConfigSaving(false);
    }
  }

  /* ---------- โหลด bookings ของวันที่เลือก ---------- */
  useEffect(() => {
    if (!isAdmin || checkingAuth || checkingRole) return;

    (async () => {
      setLoadingBookings(true);
      setError(null);

      try {
        const targetDate = days[selectedDateIndex];
        const ts = Timestamp.fromDate(targetDate);

        const q = query(collection(db, "bookings"), where("date", "==", ts));

        const snap = await getDocs(q);
        const rows: AdminBookingRow[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as BookingDocData;

          const dateTs = data.date;
          const createdAtTs = data.createdAt;

          const serviceId =
            (data.serviceId as ServiceId | undefined) ?? "bath";

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
  }, [isAdmin, checkingAuth, checkingRole, days, selectedDateIndex]);

  /* ---------- สรุปคิวต่อบริการ ---------- */
  const summaryByService = useMemo(() => {
    const base: Record<ServiceId, number> = {
      bath: 0,
      groom: 0,
      nail: 0,
      combo: 0,
    };
    for (const b of bookings) {
      if (base[b.serviceId] != null) {
        base[b.serviceId] += 1;
      }
    }
    return base;
  }, [bookings]);

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

  const selectedDate = days[selectedDateIndex];

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
              ภาพรวมคิววันนี้ และ 14 วันถัดไป
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              แสดงรายการจองคิวของลูกค้าตามวันที่ที่เลือก
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-slate-500">
              เข้าสู่ระบบด้วย:{" "}
              <span className="font-medium text-slate-800">
                {user.email}
              </span>
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

        {/* เลือกวันที่ */}
        <section className="space-y-3">
          <p className="text-sm font-medium text-slate-700">
            เลือกวันที่ที่ต้องการดูคิว
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((date, index) => {
              const isSelected = index === selectedDateIndex;
              const isToday = index === 0;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSelectedDateIndex(index)}
                  className={[
                    "rounded-xl border px-4 py-2 text-xs text-black",
                    "border-emerald-100 bg-white",
                    "flex flex-col items-center justify-center whitespace-nowrap",
                    isSelected
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                      : "hover:border-emerald-300 hover:bg-emerald-50",
                  ].join(" ")}
                >
                  <div className="text-[11px] opacity-80 text-emerald-600">
                    {isToday ? "วันนี้" : "\u00A0"}
                  </div>
                  <div className="font-semibold">
                    {formatThaiDateShort(date)}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* สรุปจำนวนคิว */}
        <section className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-3">
            <p className="text-xs text-emerald-700">คิวทั้งหมดของวัน</p>
            <p className="mt-1 text-2xl font-bold text-emerald-800">
              {bookings.length}
            </p>
            <p className="mt-1 text-[11px] text-emerald-700/80">
              {formatThaiDateFull(selectedDate)}
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
                {summaryByService[s.id]}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                จำนวนคิวของบริการนี้
              </p>
            </div>
          ))}
        </section>

        {/* การตั้งค่าเวลาเปิด & ราคา */}
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-emerald-800">
                ตั้งค่าช่วงเวลาเปิดให้จอง & ราคาต่อบริการ
              </h2>
              <p className="text-[11px] text-slate-600 mt-0.5">
                การตั้งค่านี้จะใช้กับหน้าจองคิวของลูกค้าทั้งหมด
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              {configLoading
                ? "กำลังโหลดการตั้งค่า..."
                : "แก้ไขได้ตลอดเวลาแล้วกดบันทึกด้านล่าง"}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* timeSlots editor */}
            <div>
              <label className="block text-xs font-medium text-emerald-900 mb-1">
                ช่วงเวลาที่เปิดให้จอง (รูปแบบ HH:MM)
              </label>
              <textarea
                rows={3}
                value={timeSlotsInput}
                onChange={(e) => setTimeSlotsInput(e.target.value)}
                className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 resize-none"
                placeholder="เช่น 10:00, 10:30, 11:00, ... , 18:00"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                สามารถคั่นด้วยเครื่องหมายจุลภาค หรือขึ้นบรรทัดใหม่ก็ได้
                ระบบจะจัดเรียงเวลาให้อัตโนมัติ
              </p>
            </div>

            {/* price editor */}
            <div>
              <label className="block text-xs font-medium text-emerald-900 mb-1">
                ราคาต่อครั้งของแต่ละบริการ (บาท)
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
                      <span className="text-[11px] text-slate-500">บาท</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                ถ้าปล่อยว่าง ระบบจะไม่แสดงราคาในหน้าลูกค้า
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
              {configSaving ? "กำลังบันทึกการตั้งค่า..." : "บันทึกการตั้งค่า"}
            </button>
          </div>
        </section>

        {/* ตารางคิวลูกค้า (การ์ด) */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">
            รายการคิวของวันที่เลือก
          </h2>

          {loadingBookings && (
            <p className="text-sm text-slate-500">
              กำลังโหลดข้อมูลคิว...
            </p>
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
                    {(b.ownerName || b.petName || b.petWeightKg !== null) && (
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
      </div>
    </main>
  );
}
