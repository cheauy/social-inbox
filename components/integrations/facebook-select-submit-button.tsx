"use client";

import { useEffect, useState } from "react";

export function FacebookSelectSubmitButton() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => {
      const total = document.querySelectorAll(
        'input[name="pageId"]:checked',
      ).length;
      setCount(total);
    };

    sync();
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, []);

  const label =
    count <= 0
      ? "Connect Page"
      : `Connect ${count} Page${count === 1 ? "" : "s"}`;

  return (
    <button
      type="submit"
      className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
    >
      {label}
    </button>
  );
}
