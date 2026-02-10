// app/page.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type Role = "admin" | "customer";

function prettyAuthError(err: unknown, mode: "login" | "register"): string {
  const code = (err as any)?.code as string | undefined;

  // แปลง error code ของ Firebase เป็นข้อความภาษาไทยอ่านง่าย
  if (!code) {
    return mode === "login"
      ? "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง"
      : "ไม่สามารถสมัครสมาชิกได้ กรุณาลองใหม่อีกครั้ง";
  }

  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found"
  ) {
    return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  }

  if (code === "auth/too-many-requests") {
    return "พยายามหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง";
  }

  if (code === "auth/email-already-in-use") {
    return "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ หรือใช้อีเมลอื่น";
  }

  if (code === "auth/weak-password") {
    return "รหัสผ่านควรมีความยาวอย่างน้อย 6 ตัวอักษร";
  }

  return mode === "login"
    ? "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง"
    : "ไม่สามารถสมัครสมาชิกได้ กรุณาลองใหม่อีกครั้ง";
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");
  const isLogin = mode === "login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const trimmedEmail = email.trim();

    try {
      if (isLogin) {
        /* ------------------- โหมดเข้าสู่ระบบ ------------------- */
        const credential = await signInWithEmailAndPassword(
          auth,
          trimmedEmail,
          password
        );
        const user = credential.user;

        // อ่าน role จาก Firestore: users/{uid}
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);

        let role: Role = "customer";

        if (snap.exists()) {
          const data = snap.data() as { role?: string };
          if (data.role === "admin") {
            role = "admin";
          } else {
            role = "customer";
          }
        } else {
          // ถ้าไม่มี document ให้สร้างเป็น customer ไว้เลย
          await setDoc(userRef, {
            email: user.email ?? trimmedEmail,
            role: "customer" as Role,
            createdAt: serverTimestamp(),
          });
        }

        // redirect ตาม role
        if (role === "admin") {
          router.push("/dashboard");
        } else {
          router.push("/services");
        }
      } else {
        /* ------------------- โหมดสมัครสมาชิก ------------------- */

        // validate เบื้องต้น
        if (password.length < 6) {
          setError("กรุณาตั้งรหัสผ่านอย่างน้อย 6 ตัวอักษร");
          setLoading(false);
          return;
        }

        if (password !== confirmPassword) {
          setError("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
          setLoading(false);
          return;
        }

        // สมัครสมาชิกบน Firebase Auth
        const credential = await createUserWithEmailAndPassword(
          auth,
          trimmedEmail,
          password
        );
        const user = credential.user;

        // สร้างเอกสาร users/{uid} ให้ role เริ่มต้น = customer
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, {
          email: user.email ?? trimmedEmail,
          role: "customer" as Role,
          createdAt: serverTimestamp(),
        });

        // สมัครเสร็จแล้วให้เข้าใช้ระบบได้เลย → ไปหน้าจองบริการ
        router.push("/services");
      }
    } catch (err) {
      console.error(err);
      setError(prettyAuthError(err, mode));
    } finally {
      setLoading(false);
    }
  }

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-sky-100 via-white to-sky-200 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white/90 shadow-xl p-8 border border-sky-100">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-3xl">
            🐾
          </div>
          <h1 className="text-2xl font-bold text-sky-800">
            {isLogin ? "เข้าสู่ระบบเพื่อจองคิว" : "สมัครสมาชิกเพื่อจองคิว"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            สุนัขและแมวของโรงพยาบาลสัตว์สิงห์บุรี
          </p>

          {/* ปุ่มสลับโหมด */}
          <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1 text-xs">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={[
                "px-4 py-1.5 rounded-full font-medium transition",
                isLogin
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-sky-700",
              ].join(" ")}
            >
              เข้าสู่ระบบ
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={[
                "px-4 py-1.5 rounded-full font-medium transition",
                !isLogin
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-sky-700",
              ].join(" ")}
            >
              สมัครสมาชิก
            </button>
          </div>
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
              onChange={(e) => setEmail(e.target.value)}
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
            {!isLogin && (
              <p className="mt-1 text-[11px] text-slate-400">
                รหัสผ่านควรมีอย่างน้อย 6 ตัวอักษร
              </p>
            )}
          </div>

          {/* ช่องยืนยันรหัสผ่านเฉพาะโหมดสมัครสมาชิก */}
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                ยืนยันรหัสผ่าน
              </label>
              <input
                type="password"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-black outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                placeholder="กรอกรหัสผ่านอีกครั้ง"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

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
            {loading
              ? isLogin
                ? "กำลังเข้าสู่ระบบ..."
                : "กำลังสมัครสมาชิก..."
              : isLogin
              ? "เข้าสู่ระบบ"
              : "สมัครสมาชิก"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          เชี่ยวชาญในการตัดแต่ง ใส่ใจในการบริการ
        </p>
      </div>
    </div>
  );
}
