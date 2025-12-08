// app/services/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "@/components/TopNav";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";

// ---- ข้อมูลบริการที่มีให้เลือก ----
type ServiceId = "bath" | "groom" | "nail" | "combo";

const SERVICES: {
  id: ServiceId;
  icon: string;
  title: string;
  description: string;
}[] = [
  {
    id: "bath",
    icon: "💦",
    title: "อาบน้ำทำความสะอาด",
    description: "อาบน้ำด้วยแชมพูที่เหมาะกับสภาพผิว ขจัดกลิ่นไม่พึงประสงค์",
  },
  {
    id: "groom",
    icon: "✂️",
    title: "ตัดแต่งขน",
    description: "ตัดขนทรงมาตรฐาน หรือออกแบบตามสไตล์ที่เจ้าของต้องการ",
  },
  {
    id: "nail",
    icon: "🐾",
    title: "ตัดเล็บ & ทำความสะอาดอุ้งเท้า",
    description: "ตัดเล็บให้พอดี ลดโอกาสเกิดเล็บฉีกหรือข่วนเฟอร์นิเจอร์",
  },
  {
    id: "combo",
    icon: "🎀",
    title: "อาบน้ำ & ตัดแต่งขน",
    description: "อาบน้ำ ตัดแต่งขน และดูแลความสะอาดโดยรวม",
  },
];

// ---- helper สำหรับวันที่และเวลา ----
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

// แปลง "HH:MM" → นาทีตั้งแต่ 00:00
function parseTimeToMinutes(time: string): number {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);

  if (Number.isNaN(h) || Number.isNaN(m)) {
    return 0;
  }

  return h * 60 + m;
}

export default function ServicesPage() {
  // เวลาปัจจุบัน (นาทีตั้งแต่ 00:00) สำหรับปิด slot ที่เลยเวลาแล้วใน "วันนี้"
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const [selectedService, setSelectedService] = useState<ServiceId | null>(null);
  const [selectedDateIndex, setSelectedDateIndex] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // เวลาที่ถูกจองของวันที่/บริการที่เลือก
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const bookingSectionRef = useRef<HTMLDivElement | null>(null);

  // เวลาเปิด-ปิดร้าน: 08:30 - 17:30 → ช่วงละ 1 ชม.
  const timeSlots = useMemo(
    () => [
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
    ],
    []
  );

  // วันที่ 14 วันถัดไป (รวมวันนี้)
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

  function handleSelectService(id: ServiceId) {
    setSelectedService(id);
    setSelectedDateIndex(null);
    setSelectedTime(null);
    setNote("");
    setBookedTimes([]);

    if (bookingSectionRef.current) {
      bookingSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // โหลดเวลาที่ถูกจองสำหรับวันที่ + บริการที่เลือก
  useEffect(() => {
    if (selectedService == null || selectedDateIndex === null) {
      setBookedTimes([]);
      return;
    }

    const date = days[selectedDateIndex];
    let cancelled = false;

    async function loadBookedTimes() {
      try {
        setLoadingSlots(true);

        const q = query(
          collection(db, "bookings"),
          where("serviceId", "==", selectedService),
          where("date", "==", Timestamp.fromDate(date))
        );

        const snap = await getDocs(q);

        const times: string[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as { time?: string };
          if (data.time) {
            times.push(data.time);
          }
        });

        if (!cancelled) {
          setBookedTimes(times);
        }
      } catch (err) {
        console.error("โหลดข้อมูลคิวไม่สำเร็จ", err);
      } finally {
        if (!cancelled) {
          setLoadingSlots(false);
        }
      }
    }

    loadBookedTimes();

    return () => {
      cancelled = true;
    };
  }, [selectedService, selectedDateIndex, days]);

  async function handleConfirmBooking() {
    if (!selectedService || selectedDateIndex === null || !selectedTime) {
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
      return;
    }

    const date = days[selectedDateIndex];
    const service = SERVICES.find((s) => s.id === selectedService);

    try {
      setSaving(true);

      await addDoc(collection(db, "bookings"), {
        userId: user.uid,
        userEmail: user.email ?? "",
        serviceId: selectedService,
        serviceTitle: service?.title ?? selectedService,
        date: Timestamp.fromDate(date),
        time: selectedTime,
        note: note.trim(),
        createdAt: serverTimestamp(),
      });

      // อัพเดทให้ช่องเวลานี้เป็น "เต็ม" ทันที
      setBookedTimes((prev) =>
        selectedTime && !prev.includes(selectedTime) ? [...prev, selectedTime] : prev
      );

      alert(
        `จองคิวสำเร็จ\n` +
          `บริการ: ${service?.title ?? selectedService}\n` +
          `วันที่: ${formatThaiDateFull(date)}\n` +
          `เวลา: ${selectedTime} น.\n` +
          (note ? `หมายเหตุ: ${note}` : "")
      );
    } catch (err) {
      console.error(err);
      alert("ไม่สามารถจองคิวได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-emerald-50 via-white to-sky-50">
      <TopNav />

      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-emerald-700 mb-4">
          เลือกบริการอาบน้ำตัดแต่งขน
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          ยินดีต้อนรับสู่ระบบจองคิวร้านอาบน้ำตัดแต่งขนสัตว์
          กรุณาเลือกประเภทบริการที่ต้องการด้านล่าง
        </p>

        {/* ปุ่มเลือกบริการ */}
        <div className="grid gap-4 sm:grid-cols-2">
          {SERVICES.map((service) => (
            <button
              key={service.id}
              type="button"
              onClick={() => handleSelectService(service.id)}
              className={[
                "rounded-xl border p-4 text-left shadow-sm hover:shadow-md transition",
                "border-emerald-100 bg-white",
                selectedService === service.id
                  ? "ring-2 ring-emerald-400 border-emerald-300"
                  : "",
              ].join(" ")}
            >
              <div className="text-2xl mb-2">{service.icon}</div>
              <div className="font-semibold text-slate-800">{service.title}</div>
              <div className="text-xs text-slate-500 mt-1">
                {service.description}
              </div>
            </button>
          ))}
        </div>

        {/* ---- ส่วนจองคิว ---- */}
        {selectedService && (
          <div
            ref={bookingSectionRef}
            className="mt-10 border-t border-emerald-100 pt-6"
          >
            <h2 className="text-xl font-semibold text-emerald-700 mb-2">
              จองคิวบริการ
            </h2>

            <p className="text-sm text-slate-600 mb-4">
              บริการที่เลือก:{" "}
              <span className="font-semibold text-emerald-700">
                {SERVICES.find((s) => s.id === selectedService)?.title ??
                  "ไม่ทราบบริการ"}
              </span>
            </p>

            {/* เลือกวันที่ */}
            <div className="mb-4">
              <p className="text-sm font-medium text-slate-700 mb-2">
                เลือกวันที่
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {days.map((date, index) => {
                  const isSelected = index === selectedDateIndex;
                  const isToday = index === 0;

                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => {
                        setSelectedDateIndex(index);
                        setSelectedTime(null);
                      }}
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
            </div>

            {/* เลือกเวลา */}
            {selectedDateIndex !== null && (
              <div className="mb-4">
                <p className="text-sm font-medium text-slate-700 mb-2">
                  เลือกเวลา
                </p>

                {loadingSlots && (
                  <p className="mb-2 text-xs text-slate-400">
                    กำลังเช็คคิวที่ถูกจองในวันดังกล่าว...
                  </p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-black">
                  {timeSlots.map((time) => {
                    const slotMinutes = parseTimeToMinutes(time);

                    const isPast =
                      selectedDateIndex === 0 && slotMinutes <= nowMinutes;

                    const full = bookedTimes.includes(time);
                    const disabled = full || isPast;

                    const isSelected = !disabled && selectedTime === time;

                    return (
                      <button
                        key={time}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (!disabled) setSelectedTime(time);
                        }}
                        className={[
                          "rounded-lg border px-3 py-2 text-sm",
                          disabled
                            ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "border-emerald-100 bg-white hover:border-emerald-300 hover:bg-emerald-50",
                          isSelected
                            ? "bg-emerald-600 text-black border-emerald-600"
                            : "",
                        ].join(" ")}
                      >
                        <div>{time}</div>

                        {isPast && (
                          <div className="text-[11px] font-medium">
                            หมดเวลา
                          </div>
                        )}

                        {!isPast && full && (
                          <div className="text-[11px] font-medium">
                            เต็ม
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* หมายเหตุเพิ่มเติม */}
            {selectedDateIndex !== null && (
              <div className="mb-4">
                <p className="text-sm font-medium text-slate-700 mb-1">
                  หมายเหตุเพิ่มเติม
                </p>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-black outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 resize-none"
                  placeholder="กรุณาใส่ชื่อน้อง หรือความต้องการอื่นๆ เช่น น้องกลัวไดร์เสียงดัง, ขนพันกันง่าย, ขอใช้แชมพูสูตรอ่อนโยนพิเศษ ฯลฯ"
                />
              </div>
            )}

            {/* สรุปรายการก่อนยืนยัน */}
            {selectedService && selectedDateIndex !== null && selectedTime && (
              <div className="mb-4 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-emerald-700 mb-2">
                  สรุปรายการจองคิว
                </h3>
                <div className="space-y-1 text-sm text-slate-700">
                  <p>
                    <span className="font-medium text-slate-500">
                      บริการ:
                    </span>{" "}
                    {SERVICES.find((s) => s.id === selectedService)?.title}
                  </p>
                  <p>
                    <span className="font-medium text-slate-500">
                      วันที่:
                    </span>{" "}
                    {formatThaiDateFull(days[selectedDateIndex])}
                  </p>
                  <p>
                    <span className="font-medium text-slate-500">
                      เวลา:
                    </span>{" "}
                    {selectedTime} น.
                  </p>
                  <p className="flex gap-1">
                    <span className="font-medium text-slate-500">
                      หมายเหตุ:
                    </span>
                    <span
                      className={
                        note ? "text-slate-700" : "text-slate-400 italic"
                      }
                    >
                      {note || "ยังไม่ได้ระบุ"}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {/* ปุ่มยืนยันการจอง */}
            <div className="mt-4">
              <button
                type="button"
                onClick={handleConfirmBooking}
                disabled={
                  !selectedService ||
                  selectedDateIndex === null ||
                  !selectedTime ||
                  saving
                }
                className={[
                  "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm",
                  "bg-emerald-600 text-white hover:bg-emerald-700",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                {saving ? "กำลังบันทึก..." : "ยืนยันการจองคิว"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
