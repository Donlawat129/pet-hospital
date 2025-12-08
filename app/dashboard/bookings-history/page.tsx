"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/* ---------- Services config ---------- */

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

function formatThaiDateFull(d: Date): string {
  const day = d.getDate();
  const month = TH_MONTH_SHORT[d.getMonth()];
  const year = d.getFullYear() + 543;
  return `${day} ${month} ${year}`;
}

// เวลา "HH:MM" → นาทีจาก 00:00 ใช้สำหรับ sort
function parseTimeToMinutes(time: string): number {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/* ---------- types ---------- */

type BookingHistoryRow = {
  id: string;
  userId: string;
  userEmail: string;
  serviceId: ServiceId;
  serviceTitle: string;
  date: Date;
  time: string;
  note: string;
  createdAt: Date | null;
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
};

type ServiceFilter = "all" | ServiceId;
type DateFilter = "all" | "7d" | "30d";

export default function BookingsHistoryPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);

  const [rows, setRows] = useState<BookingHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filter state
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [search, setSearch] = useState("");

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
        const ref = doc(db, "users");
        const snap = await getDoc(ref);
        const data = snap.data() as { role?: string } | undefined;

        if (data?.role === "admin") {
          setIsAdmin(true);
        } else {
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

  /* ---------- โหลด bookings ทั้งหมด ---------- */
  useEffect(() => {
    if (!isAdmin || checkingAuth || checkingRole) return;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const snap = await getDocs(collection(db, "bookings"));

        const list: BookingHistoryRow[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as BookingDocData;

          const dateTs = data.date;
          const createdAtTs = data.createdAt;

          const serviceId =
            (data.serviceId as ServiceId | undefined) ?? "bath";

          const dateObj = dateTs ? dateTs.toDate() : new Date();

          return {
            id: docSnap.id,
            userId: data.userId ?? "",
            userEmail: data.userEmail ?? "",
            serviceId,
            serviceTitle:
              data.serviceTitle ?? serviceTitleMap[serviceId] ?? "-",
            date: dateObj,
            time: data.time ?? "",
            note: data.note ?? "",
            createdAt: createdAtTs ? createdAtTs.toDate() : null,
          };
        });

        // sort: ล่าสุดอยู่บน (ตามวันนัด + เวลา)
        list.sort((a, b) => {
          const aKey = a.date.getTime() + parseTimeToMinutes(a.time) * 60_000;
          const bKey = b.date.getTime() + parseTimeToMinutes(b.time) * 60_000;
          return bKey - aKey;
        });

        setRows(list);
      } catch (err) {
        console.error(err);
        setError("โหลดประวัติการจองไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin, checkingAuth, checkingRole]);

  const filteredRows = useMemo(() => {
    let result = [...rows];

    // filter service
    if (serviceFilter !== "all") {
      result = result.filter((r) => r.serviceId === serviceFilter);
    }

    // filter date range
    if (dateFilter !== "all") {
      const now = new Date();
      const threshold = new Date(now);
      if (dateFilter === "7d") {
        threshold.setDate(now.getDate() - 7);
      } else if (dateFilter === "30d") {
        threshold.setDate(now.getDate() - 30);
      }

      result = result.filter((r) => r.date >= threshold);
    }

    // search
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((r) => {
        const emailOrId = (r.userEmail || r.userId).toLowerCase();
        const service = r.serviceTitle.toLowerCase();
        const note = r.note.toLowerCase();
        const time = r.time.toLowerCase();
        return (
          emailOrId.includes(q) ||
          service.includes(q) ||
          note.includes(q) ||
          time.includes(q)
        );
      });
    }

    return result;
  }, [rows, serviceFilter, dateFilter, search]);

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
      <div className="mx-auto max-w-6xl bg-white/80 backdrop-blur border border-emerald-100 shadow-xl shadow-emerald-100 rounded-2xl px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-100">
              Admin Dashboard · ประวัติการจองทั้งหมด
            </span>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              ประวัติการจองคิวทั้งหมด
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              แสดงประวัติการจองคิวทั้งหมดของลูกค้า พร้อมค้นหาและกรองข้อมูลได้
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-slate-500">
              ผู้ดูแลระบบ:{" "}
              <span className="font-medium text-slate-800">
                {user.email}
              </span>
            </p>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white/80 hover:bg-slate-50 shadow-sm text-slate-700"
              >
                ← กลับหน้า Dashboard
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

        {/* Filter bar */}
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            {/* ค้นหา */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-emerald-900 mb-1">
                ค้นหา (อีเมล / ชื่อบริการ / หมายเหตุ / เวลา)
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                placeholder="เช่น ชื่อลูกค้า, อาบน้ำ, 10:30 เป็นต้น"
              />
            </div>

            {/* บริการ */}
            <div className="min-w-[180px]">
              <label className="block text-xs font-medium text-emerald-900 mb-1">
                ประเภทบริการ
              </label>
              <select
                value={serviceFilter}
                onChange={(e) =>
                  setServiceFilter(e.target.value as ServiceFilter)
                }
                className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              >
                <option value="all">บริการทั้งหมด</option>
                {SERVICES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.icon} {s.title}
                  </option>
                ))}
              </select>
            </div>

            {/* ช่วงวันที่ */}
            <div className="min-w-40">
              <label className="block text-xs font-medium text-emerald-900 mb-1">
                ช่วงวันที่ (ตามวันนัด)
              </label>
              <select
                value={dateFilter}
                onChange={(e) =>
                  setDateFilter(e.target.value as DateFilter)
                }
                className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-black outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              >
                <option value="all">ทั้งหมด</option>
                <option value="7d">7 วันล่าสุด</option>
                <option value="30d">30 วันล่าสุด</option>
              </select>
            </div>
          </div>

          <p className="text-[11px] text-emerald-900/80">
            แสดง {filteredRows.length.toLocaleString("th-TH")} รายการ
            จากทั้งหมด {rows.length.toLocaleString("th-TH")} รายการ
          </p>
        </section>

        {/* Table */}
        <section>
          {loading && (
            <p className="text-sm text-slate-500 mt-2">
              กำลังโหลดประวัติการจอง...
            </p>
          )}

          {!loading && error && (
            <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="mt-3 rounded-2xl border border-dashed border-emerald-200 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
              ยังไม่มีข้อมูลการจองในระบบ
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
              <table className="min-w-full text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">วันนัด / เวลา</th>
                    <th className="px-3 py-2 text-left">บริการ</th>
                    <th className="px-3 py-2 text-left">ลูกค้า</th>
                    <th className="px-3 py-2 text-left">หมายเหตุ</th>
                    <th className="px-3 py-2 text-left">สร้างเมื่อ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-slate-100 hover:bg-emerald-50/40"
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="text-xs text-slate-500">
                          {formatThaiDateFull(r.date)}
                        </div>
                        <div className="text-sm font-medium text-slate-800">
                          {r.time || "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-1 text-sm">
                          <span>
                            {SERVICES.find((s) => s.id === r.serviceId)?.icon}
                          </span>
                          <span>{r.serviceTitle}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        <div className="font-medium text-slate-800">
                          {r.userEmail || r.userId || "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {r.note || <span className="text-slate-400">-</span>}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-500">
                        {r.createdAt
                          ? r.createdAt.toLocaleString("th-TH", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
