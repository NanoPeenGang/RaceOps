"use client";

import { useEffect } from "react";

/**
 * Registers the trackside service worker.
 *
 * Registration is skipped in development, where a cached shell makes every
 * change look like it did not apply — the single most confusing failure mode
 * a service worker has.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // Registered after load so it never competes with the first paint on a
    // phone on circuit wifi.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration means no offline shell, which is a
        // degradation rather than a break — nothing to surface to the user.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
