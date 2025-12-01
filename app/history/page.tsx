// app/history/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import TopNav from "@/components/TopNav";
import { auth, db } from "@/lib/firebase";

// type สำหรับแถวที่ใช้แสดงบนหน้า UI
type BookingRow = {
  id: string;
  serviceTitle: string;
  date: Date;
  time: string;
  note?: string;
};

// type สำหรับข้อมูลดิบที่อยู่ใน Firestore
type BookingDocData = {
  serviceTitle?: string;
  serviceId?: string;
  date: Timestamp;
  time?: string;
  note?: string;
};

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

export default function HistoryPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // เช็คสถานะ Login ก่อน
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/");
        return;
      }

      setLoading(true);
      try {
        const q = query(
          collection(db, "bookings"),
          where("userId", "==", user.uid)
        );

        const snap = await getDocs(q);
        const rows: BookingRow[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as BookingDocData;
          const dateObj = data.date.toDate();

          return {
            id: docSnap.id,
            serviceTitle: data.serviceTitle ?? data.serviceId ?? "-",
            date: dateObj,
            time: data.time ?? "",
            note: data.note ?? "",
          };
        });

        // เรียงล่าสุดอยู่บน
        rows.sort((a, b) => {
          const diff = b.date.getTime() - a.date.getTime();
          if (diff !== 0) return diff;
          return a.time.localeCompare(b.time);
        });

        setBookings(rows);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  return (
    <div className="min-h-screen bg-linear-to-br from-emerald-50 via-white to-sky-50">
      <TopNav />

      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-emerald-700 mb-2">
          ประวัติการใช้บริการ
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          สามารถตรวจสอบประวัติการจองคิวอาบน้ำตัดแต่งขนของคุณได้ที่นี่
        </p>

        {loading && (
          <p className="text-sm text-slate-500">กำลังโหลดประวัติการใช้บริการ...</p>
        )}

        {!loading && bookings.length === 0 && (
          <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/70 p-6 text-center text-sm text-slate-500">
            ยังไม่มีประวัติการจองคิว
            <br />
            กรุณาไปที่หน้า{" "}
            <span className="font-semibold text-emerald-600">จองบริการ</span>{" "}
            เพื่อทำการจองครั้งแรก
          </div>
        )}

        {!loading && bookings.length > 0 && (
          <div className="space-y-3">
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
                    {formatThaiDateFull(b.date)} เวลา {b.time} น.
                  </p>
                  {b.note && (
                    <p className="mt-1 text-xs text-slate-600">
                      หมายเหตุ: {b.note}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
