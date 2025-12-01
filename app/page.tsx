"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1) ล็อกอินด้วย Firebase Auth
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const user = credential.user;

      // 2) อ่าน role จาก Firestore: users/{uid}
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);

      let role: "admin" | "customer" = "customer"; // default เป็น customer

      if (snap.exists()) {
        const data = snap.data() as { role?: string };
        if (data.role === "admin") {
          role = "admin";
        } else {
          role = "customer";
        }
      }

      // 3) redirect ตาม role
      if (role === "admin") {
        router.push("/dashboard");
      } else {
        router.push("/services");
      }
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-sky-100 via-white to-sky-200">
      <div className="w-full max-w-md rounded-2xl bg-white/90 shadow-xl p-8 border border-sky-100">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-3xl">
            🐾
          </div>
          <h1 className="text-2xl font-bold text-sky-800">
            ร้านอาบน้ำตัดแต่งขนสัตว์
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            เข้าสู่ระบบเพื่อจัดการคิวอาบน้ำ ตัดแต่งขน และข้อมูลลูกค้า
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              อีเมล
            </label>
            <input
              type="email"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-black outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              placeholder="คุณหมอ@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              รหัสผ่าน
            </label>
            <input
              type="password"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-black outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          เชี่ยวชาญในการตัดแต่ง ใส่ใจในการบริการ
        </p>
      </div>
    </div>
  );
}
