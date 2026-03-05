// Modal utilities: portal to <body> + body scroll lock.

"use client";

import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type BodyScrollLockState = {
  count: number;
  overflow: string;
  paddingRight: string;
};

const globalForModal = globalThis as unknown as {
  __bodyScrollLockState?: BodyScrollLockState;
};

function getOrInitLockState(): BodyScrollLockState {
  if (!globalForModal.__bodyScrollLockState) {
    globalForModal.__bodyScrollLockState = { count: 0, overflow: "", paddingRight: "" };
  }
  return globalForModal.__bodyScrollLockState;
}

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const state = getOrInitLockState();

    if (state.count === 0) {
      const body = document.body;
      state.overflow = body.style.overflow;
      state.paddingRight = body.style.paddingRight;

      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      body.style.paddingRight = scrollbarWidth > 0 ? `${scrollbarWidth}px` : state.paddingRight;
    }

    state.count += 1;

    return () => {
      const s = globalForModal.__bodyScrollLockState;
      if (!s) return;

      s.count = Math.max(0, s.count - 1);
      if (s.count === 0) {
        const body = document.body;
        body.style.overflow = s.overflow;
        body.style.paddingRight = s.paddingRight;
      }
    };
  }, [locked]);
}

export function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Portal target exists only on the client; avoid SSR/hydration issues.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(children, document.body);
}
