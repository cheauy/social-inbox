import { useCallback, useEffect, useRef } from "react";

/** A response may update a screen only while its account, scope and request still own it. */
export function useRequestOwner(scope: string) {
  const current = useRef({ scope, sequence: 0, mounted: true });
  if (current.current.scope !== scope) {
    current.current.scope = scope;
    current.current.sequence++;
  }
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; current.current.sequence++; };
  }, []);
  return useCallback(() => {
    if (current.current.scope !== scope || !current.current.mounted) return () => false;
    const sequence = ++current.current.sequence;
    return () => current.current.mounted && current.current.scope === scope && current.current.sequence === sequence;
  }, [scope]);
}
