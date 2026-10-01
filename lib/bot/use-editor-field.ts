"use client";
import { useState, type SetStateAction } from "react";

/** Twelve bounded editor slots, so menu changes retain each Bot's unfinished fields. */
export function useBotEditorField<T>(kind: string, initial: T | (() => T)): [T, (next: SetStateAction<T>) => void] {
  const [fallback] = useState(initial);
  const [values, setValues] = useState<Record<string, T>>({});
  const value = Object.hasOwn(values, kind) ? values[kind] : fallback;
  return [value, next => setValues(previous => ({ ...previous, [kind]: typeof next === "function"
    ? (next as (value: T) => T)(Object.hasOwn(previous, kind) ? previous[kind] : fallback) : next }))];
}
