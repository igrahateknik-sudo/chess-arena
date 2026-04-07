'use client';

export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="skeleton h-8 w-64 rounded-xl mb-8" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="skeleton h-36 rounded-2xl" />
          <div className="skeleton h-36 rounded-2xl" />
          <div className="skeleton h-36 rounded-2xl" />
        </div>
        <div className="skeleton h-56 rounded-2xl mt-6" />
      </div>
    </div>
  );
}
