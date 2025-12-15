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
              typeof data.petWeightKg === "number"
                ? data.petWeightKg
                : null,
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
                            เจ้าของ: <span className="font-medium">{b.ownerName}</span>
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
