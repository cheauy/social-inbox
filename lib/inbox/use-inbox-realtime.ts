"use client";

import {
  useEffect,
  useRef,
} from "react";

import {
  createClient,
} from "@/lib/supabase/client";

type UseInboxRealtimeInput = {
  businessId:
    | string
    | null;

  onDatabaseChange:
    () => void;
};

export function useInboxRealtime({
  businessId,
  onDatabaseChange,
}: UseInboxRealtimeInput) {
  const onDatabaseChangeRef =
    useRef(
      onDatabaseChange,
    );

  const refreshTimerRef =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null);

  useEffect(() => {
    onDatabaseChangeRef.current =
      onDatabaseChange;
  }, [
    onDatabaseChange,
  ]);

  useEffect(() => {
    if (!businessId) {
      return;
    }

    const supabase =
      createClient();

    function scheduleRefresh() {
      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current,
        );
      }

      refreshTimerRef.current =
        setTimeout(
          () => {
            onDatabaseChangeRef
              .current();
          },
          180,
        );
    }

    const channel =
      supabase
        .channel(
          `tenh-inbox-${businessId}`,
        )

        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter:
              `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )

        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter:
              `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )

        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "conversations",
            filter:
              `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )

        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "conversations",
            filter:
              `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )

        .subscribe(
          (status) => {
            if (
              status ===
              "SUBSCRIBED"
            ) {
              console.log(
                "Tenh Chat realtime connected.",
                {
                  businessId,
                },
              );
            }
          },
        );

    return () => {
      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current,
        );

        refreshTimerRef.current =
          null;
      }

      void supabase
        .removeChannel(
          channel,
        );
    };
  }, [
    businessId,
  ]);
}