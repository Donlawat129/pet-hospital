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
import { onAuthStateChanged } from "firebase/auth";

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

/* ---------- Config ขั้นตอนด้านซ้าย ---------- */

const STEP_CONFIG = [
  {
    key: "selectService",
    title: "เลือกประเภทบริการ",
    description: "เลือกว่าจะอาบน้ำ ตัดแต่งขน หรือตัดเล็บให้น้อง",
  },
  {
    key: "selectDate",
    title: "เลือกวันที่สะดวก",
    description: "เลือกวันจองภายใน 14 วันถัดไป",
  },
  {
    key: "selectTime",
    title: "เลือกช่วงเวลาที่ต้องการ",
    description: "ระบบจะแสดงเฉพาะช่วงเวลาที่ยังว่าง",
  },
  {
    key: "fillInfo",
    title: "กรอกข้อมูลเจ้าของ & น้อง",
    description: "ใส่ชื่อเจ้าของ ชื่อน้อง และน้ำหนักโดยประมาณ",
  },
  {
    key: "confirm",
    title: "ตรวจสอบ & ยืนยันการจอง",
    description: "ตรวจรายละเอียดให้ถูกต้องก่อนกดยืนยัน",
  },
] as const;

/* ---------- การ์ดข้อมูลคลินิก (ใช้ซ้ำได้) ---------- */

function ClinicInfoCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={[
        "rounded-2xl border border-emerald-100 bg-white shadow-sm",
        "p-4 sm:p-5 text-xs text-slate-600",
        "space-y-3",
        className,
      ]
        .join(" ")
        .trim()}
    >
      {/* หัวการ์ด */}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-emerald-800">
          โรงพยาบาลสัตว์สิงห์บุรีสัตวแพทย์
        </p>
        <p className="text-[11px] text-slate-500">
          นายสัตวแพทย์ ปิยวิทย์ กิจกลาง สพ.บ. (จุฬา)
        </p>

        <div className="pt-2">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-100">
            อาบน้ำ · ตัด-แต่งขน · อุปกรณ์สัตว์เลี้ยง
          </span>
        </div>
      </div>

      {/* เส้นแบ่งบาง ๆ ให้ดูเป็นสัดส่วน */}
      <div className="border-t border-emerald-50" />

      {/* รายละเอียดบริการ */}
      <div className="space-y-0.5">
        <p>อาบน้ำ ตัด-แต่งขน</p>
        <p>จำหน่าย แชมพูอาบน้ำ อุปกรณ์สัตว์เลี้ยง</p>
      </div>

      {/* ที่อยู่ / เวลาเปิดทำการ / เบอร์โทร */}
      <div className="space-y-1 pt-1">
        <p>
          <span className="font-medium text-slate-700">เวลาเปิดทำการ:</span>{" "}
          จันทร์ - อาทิตย์ เวลา 10.00 น. - 18.00 น.
        </p>

        <p className="flex items-start gap-1">
          <span className="mt-0.5">📍</span>
          <span>
            9/13 หมู่ 5 สี่แยกไฟแดงยายพาวัดสว่าง ต.ต้นโพธิ์ อ.เมือง
            จ.สิงห์บุรี
          </span>
        </p>

        <p className="flex items-center gap-1">
          <span>📞</span>
          <span>
            <a href="tel:036524534" className="hover:underline text-slate-700">
              036-524-534
            </a>
            {", "}
            <a href="tel:0898304417" className="hover:underline text-slate-700">
              089-830-4417
            </a>
          </span>
        </p>
      </div>
    </div>
  );
}

/* ---------- การ์ดสะสมแต้ม (10 ครั้ง ฟรี 1) ---------- */

type LoyaltyCardProps = {
  usageCount: number | null;
  loading: boolean;
  isLoggedIn: boolean | null;
};

function LoyaltyCard({ usageCount, loading, isLoggedIn }: LoyaltyCardProps) {
  // ยังไม่ได้ login
  if (isLoggedIn === false) {
    return (
      <div className="rounded-2xl border border-amber-100 bg-white/80 shadow-sm p-4 text-xs text-slate-600">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-white text-lg">
            ★
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-700">
              สะสมแต้มอาบน้ำฟรี
            </p>
            <p className="text-[11px] text-slate-500">
              เข้าสู่ระบบเพื่อเริ่มสะสมการใช้บริการ
            </p>
          </div>
        </div>
      </div>
    );
  }

  // กำลังโหลด
  if (loading) {
    return (
      <div className="rounded-2xl border border-amber-100 bg-white/80 shadow-sm p-4 text-xs text-slate-600 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-full bg-amber-200" />
          <div className="space-y-1 flex-1">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-2 w-32 bg-slate-100 rounded" />
          </div>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded mb-2" />
        <div className="h-2 w-3/4 bg-slate-100 rounded" />
      </div>
    );
  }

  const total = usageCount ?? 0;
  const freeTimes = Math.floor(total / 10);
  const cycleCount = total % 10;
  const remaining = cycleCount === 0 ? 10 : 10 - cycleCount;

  const stars = Array.from({ length: 10 }, (_, i) =>
    i < cycleCount ? "★" : "☆",
  );

  return (
    <div className="rounded-2xl border border-amber-100 bg-linear-to-br from-amber-50 via-white to-emerald-50 shadow-sm p-4 text-xs text-slate-700 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-white text-lg">
          ★
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-700">
            สะสมแต้มอาบน้ำฟรี
          </p>
          <p className="text-[11px] text-slate-500">
            ใช้บริการครบ 10 ครั้ง รับสิทธิ์อาบน้ำฟรี 1 ครั้ง
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs">
          เคยใช้บริการทั้งหมด{" "}
          <span className="font-semibold text-emerald-700">{total}</span>{" "}
          ครั้ง
        </p>
        <p className="text-xs">
          ได้สิทธิ์ฟรีแล้ว{" "}
          <span className="font-semibold text-emerald-700">{freeTimes}</span>{" "}
          ครั้ง
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] text-slate-500">
          รอบสะสมปัจจุบัน: {cycleCount}/10 ครั้ง
        </p>
        <div className="flex items-center gap-1 text-[13px] text-amber-500">
          {stars.map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </div>
        <p className="text-[11px] text-emerald-700 mt-1">
          เหลืออีก{" "}
          <span className="font-semibold">{remaining}</span>{" "}
          ครั้งจะได้สิทธิ์ฟรีรอบถัดไป
        </p>
      </div>
    </div>
  );
}

export default function ServicesPage() {
  // เวลาปัจจุบัน (นาทีตั้งแต่ 00:00) สำหรับปิด slot ที่เลยเวลาแล้วใน "วันนี้"
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const [selectedService, setSelectedService] = useState<ServiceId | null>(
    null,
  );
  const [selectedDateIndex, setSelectedDateIndex] = useState<number | null>(
    null,
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  // ฟิลด์ใหม่
  const [ownerName, setOwnerName] = useState<string>("");
  const [petName, setPetName] = useState<string>("");
  const [petWeight, setPetWeight] = useState<string>(""); // string ในฟอร์ม แล้วค่อย parse เป็น number

  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // เวลาที่ถูกจองของวันที่/บริการที่เลือก
  const [bookedTimes, setBookedTimes] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const bookingSectionRef = useRef<HTMLDivElement | null>(null);

  // สะสมแต้ม
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const [usageLoading, setUsageLoading] = useState<boolean>(true);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  // เวลาเปิด-ปิดร้าน: 10:00 - 18:00
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
    [],
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

    // reset เวลาที่จอง + ข้อมูลน้อง
    setBookedTimes([]);
    setOwnerName("");
    setPetName("");
    setPetWeight("");

    if (bookingSectionRef.current) {
      bookingSectionRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
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

        const qSlots = query(
          collection(db, "bookings"),
          where("serviceId", "==", selectedService),
          where("date", "==", Timestamp.fromDate(date)),
        );

        const snap = await getDocs(qSlots);

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

  // โหลดจำนวนครั้งที่เคยใช้บริการ (สะสมแต้ม) ตาม userId ปัจจุบัน
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsLoggedIn(false);
        setUsageCount(null);
        setUsageLoading(false);
        return;
      }

      setIsLoggedIn(true);
      setUsageLoading(true);
      try {
        const qUserBookings = query(
          collection(db, "bookings"),
          where("userId", "==", user.uid),
        );
        const snap = await getDocs(qUserBookings);
        setUsageCount(snap.size);
      } catch (err) {
        console.error("โหลดจำนวนครั้งที่ใช้บริการไม่สำเร็จ", err);
        setUsageCount(null);
      } finally {
        setUsageLoading(false);
      }
    });

    return () => unsub();
  }, []);

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

    const owner = ownerName.trim();
    const pet = petName.trim();
    const weightStr = petWeight.trim();

    // validate เบื้องต้น
    if (!owner || !pet) {
      alert("กรุณากรอกชื่อเจ้าของ และชื่อสัตว์เลี้ยงให้ครบ");
      return;
    }

    // แปลงน้ำหนักแบบปลอดภัย
    let weightNum: number | null = null;
    if (weightStr !== "") {
      const parsed = Number.parseFloat(weightStr.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        alert("กรุณากรอกน้ำหนักเป็นตัวเลขมากกว่า 0");
        return;
      }
      weightNum = parsed;
    }

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

        // ฟิลด์ใหม่
        ownerName: owner,
        petName: pet,
        weightKg: weightNum,
      });

      // อัพเดทให้ช่องเวลานี้เป็น "เต็ม" ทันที
      setBookedTimes((prev) =>
        selectedTime && !prev.includes(selectedTime)
          ? [...prev, selectedTime]
          : prev,
      );

      // อัพเดทจำนวนครั้งสะสมใน card ทันที +1
      setUsageCount((prev) => (prev == null ? 1 : prev + 1));

      let msg =
        `จองคิวสำเร็จ\n` +
        `บริการ: ${service?.title ?? selectedService}\n` +
        `วันที่: ${formatThaiDateFull(date)}\n` +
        `เวลา: ${selectedTime} น.\n` +
        `เจ้าของ: ${owner}\n` +
        `สัตว์เลี้ยง: ${pet}\n`;
      if (weightNum != null) {
        msg += `น้ำหนัก: ${weightNum} กก.\n`;
      }
      if (note.trim()) {
        msg += `หมายเหตุ: ${note.trim()}`;
      }

      alert(msg);
    } catch (err) {
      console.error(err);
      alert("ไม่สามารถจองคิวได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  /* ---------- คำนวณขั้นตอนปัจจุบันสำหรับแถบด้านซ้าย / mobile ---------- */

  const currentStepIndex = useMemo(() => {
    if (!selectedService) return 0; // ยังไม่เลือกบริการ
    if (selectedService && selectedDateIndex === null) return 1; // เลือกบริการแล้ว → เลือกวันที่
    if (selectedDateIndex !== null && !selectedTime) return 2; // เลือกวันแล้ว → เลือกเวลา
    if (selectedTime && (!ownerName.trim() || !petName.trim())) {
      return 3; // เลือกเวลาแล้ว แต่ยังไม่กรอกชื่อครบ → กรอกข้อมูล
    }
    return 4; // พร้อมตรวจสอบ & ยืนยัน
  }, [selectedService, selectedDateIndex, selectedTime, ownerName, petName]);

  const safeCurrentStep = Math.min(currentStepIndex, STEP_CONFIG.length - 1);
  const progressPercent =
    ((safeCurrentStep + 1) / STEP_CONFIG.length) * 100;

  return (
    <div className="min-h-screen bg-linear-to-br from-emerald-50 via-white to-sky-50">
      <TopNav />

      <div className="mx-auto px-4 py-8 sm:py-10">
        {/* 3 คอลัมน์: ซ้าย stepper (desktop เท่านั้น) · กลาง form · ขวา clinic card + loyalty card (desktop เท่านั้น) */}
        <div className="grid gap-6 lg:gap-8 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
          {/* ฝั่งซ้าย: ขั้นตอน (เฉพาะจอใหญ่) */}
          <aside className="hidden lg:block lg:col-span-1">
            <div className="rounded-2xl border border-emerald-100 bg-white/80 shadow-sm lg:sticky lg:top-20 px-4 py-4 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  ขั้นตอนการจองคิว
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  ระบบจะไฮไลต์ขั้นตอนที่คุณกำลังทำอยู่แบบอัตโนมัติ
                </p>
              </div>

              <ol className="space-y-3">
                {STEP_CONFIG.map((step, index) => {
                  const status =
                    index < safeCurrentStep
                      ? "done"
                      : index === safeCurrentStep
                        ? "active"
                        : "pending";

                  const isActive = status === "active";
                  const isDone = status === "done";

                  return (
                    <li
                      key={step.key}
                      className={[
                        "flex gap-3 rounded-xl border px-3 py-2.5 items-start transition-colors",
                        isActive
                          ? "border-emerald-500 bg-emerald-50 shadow-sm"
                          : isDone
                            ? "border-emerald-100 bg-emerald-50/40"
                            : "border-slate-100 bg-white/60",
                      ].join(" ")}
                    >
                      <div
                        className={[
                          "mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                          isActive
                            ? "bg-emerald-600 text-white"
                            : isDone
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-400",
                        ].join(" ")}
                      >
                        {isDone ? "✓" : index + 1}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-slate-800">
                          ขั้นตอนที่ {index + 1} · {step.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {step.description}
                        </div>
                        {isActive && (
                          <div className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                            กำลังทำขั้นตอนนี้อยู่
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>

              <p className="text-[11px] text-emerald-900/80">
                ขณะนี้คุณอยู่ในขั้นตอน:{" "}
                <span className="font-medium">
                  {STEP_CONFIG[safeCurrentStep].title}
                </span>
              </p>
            </div>
          </aside>

          {/* ฝั่งกลาง: แบบฟอร์ม */}
          <section className="lg:col-span-1">
            <h1 className="text-xl sm:text-2xl font-bold text-emerald-700 mb-1">
              เลือกบริการอาบน้ำตัดแต่งขน
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mb-3 sm:mb-4">
              ยินดีต้อนรับสู่ระบบจองคิวร้านอาบน้ำตัดแต่งขนสัตว์
              กรุณาเลือกประเภทบริการที่ต้องการด้านล่าง
            </p>

            {/* ตัวบอกขั้นตอนบนมือถือ */}
            <div className="mb-4 lg:hidden">
              <div className="rounded-2xl border border-emerald-100 bg-white/80 px-3 py-2.5 shadow-sm flex items-center gap-3">
                <div className="text-xs">
                  <p className="font-semibold text-emerald-800">
                    ขั้นตอนที่ {safeCurrentStep + 1} / {STEP_CONFIG.length}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {STEP_CONFIG[safeCurrentStep].title}
                  </p>
                </div>
                <div className="flex-1">
                  <div className="ml-2 h-1.5 rounded-full bg-emerald-50 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* การ์ดคลินิก (มือถือ/แท็บเล็ต) */}
            <div className="mb-4 sm:mb-6 lg:hidden">
              <ClinicInfoCard />
            </div>

            {/* ปุ่มเลือกบริการ */}
            <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
              {SERVICES.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => handleSelectService(service.id)}
                  className={[
                    "rounded-xl border p-3 sm:p-4 text-left shadow-sm hover:shadow-md transition",
                    "border-emerald-100 bg-white",
                    selectedService === service.id
                      ? "ring-2 ring-emerald-400 border-emerald-300"
                      : "",
                  ].join(" ")}
                >
                  <div className="text-2xl mb-1.5 sm:mb-2">
                    {service.icon}
                  </div>
                  <div className="font-semibold text-slate-800 text-sm sm:text-base">
                    {service.title}
                  </div>
                  <div className="text-[11px] sm:text-xs text-slate-500 mt-1">
                    {service.description}
                  </div>
                </button>
              ))}
            </div>

            {/* ---- ส่วนจองคิว ---- */}
            {selectedService && (
              <div
                ref={bookingSectionRef}
                className="mt-8 sm:mt-10 border-t border-emerald-100 pt-5 sm:pt-6"
              >
                <h2 className="text-lg sm:text-xl font-semibold text-emerald-700 mb-2">
                  จองคิวบริการ
                </h2>

                <p className="text-xs sm:text-sm text-slate-600 mb-4">
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
                            "rounded-xl border px-3 sm:px-4 py-2 text-[11px] sm:text-xs text-black",
                            "border-emerald-100 bg-white",
                            "flex flex-col items-center justify-center whitespace-nowrap",
                            isSelected
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                              : "hover:border-emerald-300 hover:bg-emerald-50",
                          ].join(" ")}
                        >
                          <div className="text-[10px] opacity-80 text-emerald-600">
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
                              "rounded-lg border px-3 py-2 text-xs sm:text-sm",
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
                              <div className="text-[10px] font-medium">
                                หมดเวลา
                              </div>
                            )}

                            {!isPast && full && (
                              <div className="text-[10px] font-medium">
                                เต็ม
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ข้อมูลเจ้าของ & สัตว์เลี้ยง */}
                {selectedDateIndex !== null && (
                  <div className="mb-4 space-y-3">
                    <p className="text-sm font-medium text-slate-700">
                      ข้อมูลเจ้าของ & สัตว์เลี้ยง
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          ชื่อเจ้าของ <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={ownerName}
                          onChange={(e) => setOwnerName(e.target.value)}
                          className="w-full rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-black outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder="เช่น คุณเอิร์ธ"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          ชื่อสัตว์เลี้ยง{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={petName}
                          onChange={(e) => setPetName(e.target.value)}
                          className="w-full rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-black outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder="เช่น น้องปอม, น้องหมูทอด"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        น้ำหนักโดยประมาณ (กก.)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={petWeight}
                        onChange={(e) => setPetWeight(e.target.value)}
                        className="w-full max-w-xs rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-black outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        placeholder="เช่น 4.5"
                      />
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
                      placeholder="เช่น น้องกลัวไดร์เสียงดัง, ขนพันกันง่าย, ขอใช้แชมพูสูตรอ่อนโยนพิเศษ ฯลฯ"
                    />
                  </div>
                )}

                {/* สรุปก่อนยืนยัน */}
                {selectedService &&
                  selectedDateIndex !== null &&
                  selectedTime && (
                    <div className="mb-4 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                      <h3 className="text-sm font-semibold text-emerald-700 mb-2">
                        สรุปรายการจองคิว
                      </h3>
                      <div className="space-y-1 text-sm text-slate-700">
                        <p>
                          <span className="font-medium text-slate-500">
                            บริการ:
                          </span>{" "}
                          {
                            SERVICES.find((s) => s.id === selectedService)
                              ?.title
                          }
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
                        <p>
                          <span className="font-medium text-slate-500">
                            เจ้าของ:
                          </span>{" "}
                          {ownerName || (
                            <span className="text-slate-400 italic">
                              ยังไม่ได้ระบุ
                            </span>
                          )}
                        </p>
                        <p>
                          <span className="font-medium text-slate-500">
                            สัตว์เลี้ยง:
                          </span>{" "}
                          {petName || (
                            <span className="text-slate-400 italic">
                              ยังไม่ได้ระบุ
                            </span>
                          )}
                        </p>
                        <p>
                          <span className="font-medium text-slate-500">
                            น้ำหนัก:
                          </span>{" "}
                          {petWeight ? (
                            `${petWeight} กก.`
                          ) : (
                            <span className="text-slate-400 italic">
                              ยังไม่ได้ระบุ
                            </span>
                          )}
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
                      !ownerName.trim() ||
                      !petName.trim() ||
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
          </section>

          {/* ฝั่งขวา: การ์ดข้อมูลคลินิก + การ์ดสะสมแต้ม (desktop) */}
          <aside className="hidden lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-20">
            <ClinicInfoCard />
            <LoyaltyCard
              usageCount={usageCount}
              loading={usageLoading}
              isLoggedIn={isLoggedIn}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
