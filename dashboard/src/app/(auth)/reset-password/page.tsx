"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/v1/auth/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        }
      );
      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        toast.success("Password reset successfully!");
      } else {
        setError(data.error?.message || "Failed to reset password");
        toast.error(data.error?.message || "Failed to reset password");
      }
    } catch {
      setError("Network error. Please try again.");
      toast.error("Network error");
    }

    setLoading(false);
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: '#0A0A0F' }}>
        <div className="text-center">
          <h1 className="text-xl font-medium text-zinc-100 mb-3">Invalid Reset Link</h1>
          <p className="text-sm text-zinc-400 mb-4">This password reset link is invalid or has expired.</p>
          <Link href="/forgot-password" className="text-[#5865F2] hover:underline text-sm">Request a new reset link</Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: '#0A0A0F' }}>
        <div className="w-full max-w-[380px] text-center">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6">
            <h2 className="text-lg font-medium text-emerald-300 mb-2">Password Reset!</h2>
            <p className="text-sm text-zinc-400 mb-4">Your password has been updated successfully.</p>
            <Link href="/login" className="inline-block rounded-xl bg-[#5865F2] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#4752C4]">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: '#0A0A0F' }}>
      <div className="w-full max-w-[380px]">
        <div className="mb-8">
          <svg width="36" height="36" viewBox="0 0 32 32" className="mb-6">
            <rect width="32" height="32" fill="#5865F2" rx="8"/>
            <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
            <path d="M20 3v5a2 2 0 002 2h5" fill="#C7D2FE"/>
            <path d="M8 16h10" stroke="#5865F2" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M8 21h14" stroke="#52525B" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <h1 className="font-serif text-[28px] leading-tight text-zinc-100">Create new password</h1>
          <p className="mt-3 text-[14px] text-zinc-400">Enter your new password below.</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-zinc-400">New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-[15px] text-zinc-100 shadow-sm outline-none transition-all focus:border-[#5865F2] focus:ring-2 focus:ring-[#5865F2]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-zinc-400">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-[15px] text-zinc-100 shadow-sm outline-none transition-all focus:border-[#5865F2] focus:ring-2 focus:ring-[#5865F2]/20"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#5865F2] px-4 py-3 text-[15px] font-medium text-white shadow-sm transition-all hover:bg-[#4752C4] active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
