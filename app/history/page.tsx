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

  ownerName?: string;
  petName?: string;
  weightKg?: number | null;

  // ใหม่
  ownerPhone?: string;
  petAgeYears?: number | null;
  petSex?: string;
  petBreed?: string;
  groomerGender?: string;
};

// type สำหรับข้อมูลดิบที่อยู่ใน Firestore
type BookingDocData = {
  serviceTitle?: string;
  serviceId?: string;
  date: Timestamp;
  time?: string;
  note?: string;

  ownerName?: string;
  petName?: string;
  weightKg?: unknown;

  ownerPhone?: string;
  petAgeYears?: unknown;
  petSex?: string;
  petBreed?: string;
  groomerGender?: string;
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

function petSexToThai(petSex?: string | null): string {
  const v = (petSex ?? "").toLowerCase();
  if (!v) return "";
  if (v === "male" || v === "ตัวผู้" || v === "ผู้") return "ตัวผู้";
  if (v === "female" || v === "ตัวเมีย" || v === "เมีย") return "ตัวเมีย";
  return petSex ?? "";
}

function groomerGenderToThai(gender?: string | null): string {
  const v = (gender ?? "").toLowerCase();
  if (!v) return "";
  if (v === "male" || v === "ชาย" || v === "ผู้ชาย") return "ช่างผู้ชาย";
  if (v === "female" || v === "หญิง" || v === "ผู้หญิง") return "ช่างผู้หญิง";
  return gender ?? "";
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
          where("userId", "==", user.uid),
        );

        const snap = await getDocs(q);
        const rows: BookingRow[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as BookingDocData;
          const dateObj = data.date.toDate();

          // แปลงน้ำหนัก
          let weight: number | null = null;
          if (typeof data.weightKg === "number") {
            weight = data.weightKg;
          } else if (typeof data.weightKg === "string") {
            const n = Number(data.weightKg);
            if (!Number.isNaN(n)) weight = n;
          }

          // แปลงอายุ
          let age: number | null = null;
          if (typeof data.petAgeYears === "number") {
            age = data.petAgeYears;
          } else if (typeof data.petAgeYears === "string") {
            const n = Number(data.petAgeYears);
            if (!Number.isNaN(n)) age = n;
          }

          return {
            id: docSnap.id,
            serviceTitle: data.serviceTitle ?? data.serviceId ?? "-",
            date: dateObj,
            time: data.time ?? "",
            note: data.note ?? "",
            ownerName: data.ownerName ?? "",
            petName: data.petName ?? "",
            weightKg: weight,
            ownerPhone: data.ownerPhone ?? "",
            petAgeYears: age,
            petSex: data.petSex ?? "",
            petBreed: data.petBreed ?? "",
            groomerGender: data.groomerGender ?? "",
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
          <p className="text-sm text-slate-500">
            กำลังโหลดประวัติการใช้บริการ...
          </p>
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
            {bookings.map((b) => {
              const sexLabel = petSexToThai(b.petSex);
              const groomerLabel = groomerGenderToThai(b.groomerGender);

              return (
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

                    {/* แถวข้อมูลเจ้าของ / เบอร์ */}
                    {(b.ownerName || b.ownerPhone) && (
                      <p className="mt-1 text-xs text-slate-600">
                        {b.ownerName && (
                          <>
                            เจ้าของ:{" "}
                            <span className="font-medium">
                              {b.ownerName}
                            </span>
                          </>
                        )}
                        {b.ownerPhone && (
                          <>
                            {b.ownerName ? " · " : ""}
                            เบอร์:{" "}
                            <span className="font-medium">
                              {b.ownerPhone}
                            </span>
                          </>
                        )}
                      </p>
                    )}

                    {/* แถวข้อมูลน้อง: ชื่อ / พันธุ์ / อายุ / เพศ / น้ำหนัก */}
                    {(b.petName ||
                      b.petBreed ||
                      b.petAgeYears != null ||
                      sexLabel ||
                      b.weightKg != null) && (
                      <p className="mt-0.5 text-xs text-slate-600">
                        {b.petName && (
                          <>
                            น้อง:{" "}
                            <span className="font-medium">{b.petName}</span>
                          </>
                        )}
                        {b.petBreed && (
                          <>
                            {b.petName ? " · " : ""}
                            พันธุ์:{" "}
                            <span className="font-medium">
                              {b.petBreed}
                            </span>
                          </>
                        )}
                        {b.petAgeYears != null &&
                          !Number.isNaN(b.petAgeYears) && (
                            <>
                              {b.petName || b.petBreed ? " · " : ""}
                              อายุ:{" "}
                              <span className="font-medium">
                                {b.petAgeYears}
                              </span>{" "}
                              ปี
                            </>
                          )}
                        {sexLabel && (
                          <>
                            {" · "}
                            เพศ:{" "}
                            <span className="font-medium">{sexLabel}</span>
                          </>
                        )}
                        {b.weightKg != null && !Number.isNaN(b.weightKg) && (
                          <>
                            {" · "}
                            น้ำหนัก:{" "}
                            <span className="font-medium">
                              {b.weightKg.toFixed(1)}
                            </span>{" "}
                            กก.
                          </>
                        )}
                      </p>
                    )}

                    {/* ช่างที่เลือก */}
                    {groomerLabel && (
                      <p className="mt-0.5 text-xs text-slate-600">
                        ช่างที่เลือก:{" "}
                        <span className="font-medium">{groomerLabel}</span>
                      </p>
                    )}

                    {b.note && (
                      <p className="mt-1 text-xs text-slate-600">
                        หมายเหตุ: {b.note}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
