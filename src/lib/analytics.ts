export interface TrackEventPayload {
  [key: string]: string | number | boolean | null | undefined;
}

export async function trackEvent(eventName: string, payload: TrackEventPayload = {}) {
  const body = {
    event_name: eventName,
    ts: Date.now(),
    page: window.location.pathname,
    payload,
  };
  console.info("analytics_event", body);
  try {
    if (typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon(
        "/api/events",
        new Blob([JSON.stringify(body)], { type: "application/json" }),
      );
      if (ok) {
        return;
      }
    }
    await fetch("/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
  }
}
