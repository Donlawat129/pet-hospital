// components/TopNav.tsx
"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    try {
      setLoggingOut(true);
      await signOut(auth);
      router.push("/");
    } catch (err) {
      console.error(err);
      alert("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoggingOut(false);
    }
  }

  const navButtonBase =
    "text-sm px-3 py-1.5 rounded-full transition border";

  const isServices = pathname === "/services";
  const isHistory = pathname === "/history";

  return (
    <header className="sticky top-0 z-20 border-b border-emerald-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        {/* โลโก้ + ชื่อร้าน */}
        <button
          type="button"
          onClick={() => router.push("/services")}
          className="flex items-center gap-2"
        >
          <span className="text-2xl">🐶</span>
          <div className="text-left">
            <div className="text-sm font-semibold text-emerald-700">
              ร้านอาบน้ำตัดแต่งขนสัตว์
            </div>
            <div className="text-[11px] text-slate-400">
              ระบบจองคิวสำหรับลูกค้าสมาชิก
            </div>
          </div>
        </button>

        {/* เมนูขวา */}
        <nav className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/services")}
            className={[
              navButtonBase,
              isServices
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-transparent text-slate-600 hover:bg-emerald-50/60",
            ].join(" ")}
          >
            จองบริการ
          </button>

          <button
            type="button"
            onClick={() => router.push("/history")}
            className={[
              navButtonBase,
              isHistory
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-transparent text-slate-600 hover:bg-emerald-50/60",
            ].join(" ")}
          >
            ประวัติการใช้บริการ
          </button>

          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="ml-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60"
          >
            {loggingOut ? "กำลังออก..." : "ออกจากระบบ"}
          </button>
        </nav>
      </div>
    </header>
  );
}
