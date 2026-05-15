'use client';

import { useState, useCallback, useEffect } from 'react';
import rosbridge from '@/lib/rosbridge';

const STORAGE_KEY = 'rosviz.selectedRobotId';

const MUX_SELECT_SERVICE_TYPE = 'topic_tools_interfaces/srv/MuxSelect';
// const MUX_SELECT_SERVICE_TYPE = 'topic_tools/MuxSelect';  // older fallback

interface MuxConfig {
  /** Mux service path, e.g. '/mux_scan_points/select' */
  service: string;
  /** Function returning the input topic for a given robot id */
  inputForRobot: (id: number) => string;
}

const MUXES: MuxConfig[] = [
  {
    service: '/mux_scan_points/select',
    inputForRobot: (id) => `/tb3_${id}/scan/points`,
  },
  {
    service: '/mux_camera_image/select',
    inputForRobot: (id) => `/tb3_${id}/camera/image_raw/compressed`,
  },
  {
    service: '/mux_camera_depth/select',
    inputForRobot: (id) => `/tb3_${id}/camera/depth/image_rect_raw/compressed`,
  },
];

function readPersistedSelection(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function persistSelection(id: number | null) {
  if (typeof window === 'undefined') return;
  if (id === null) {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(STORAGE_KEY, String(id));
  }
}

/**
 * Single source of truth for which robot the individual view is focused on.
 *
 * `selectRobot(id)` does two things atomically:
 *   1. Updates local state (so UI follows).
 *   2. Calls every mux's /select service to route /selected/* to that robot.
 *
 * Selection is persisted to sessionStorage so a page refresh doesn't reset it.
 */
export function useRobotSelection() {
  const [selectedRobotId, setSelectedRobotId] = useState<number | null>(() =>
    readPersistedSelection()
  );

  useEffect(() => {
    persistSelection(selectedRobotId);
  }, [selectedRobotId]);

  const selectRobot = useCallback(async (id: number): Promise<void> => {
    setSelectedRobotId(id);

    // Fire all mux selections in parallel; settle on whatever succeeds.
    const results = await Promise.allSettled(
      MUXES.map((mux) =>
        rosbridge.callService(
          mux.service,
          MUX_SELECT_SERVICE_TYPE,
          { topic: mux.inputForRobot(id) },
          3000
        )
      )
    );

    const failures = results
      .map((r, i) => (r.status === 'rejected' ? { mux: MUXES[i].service, reason: r.reason } : null))
      .filter((x): x is { mux: string; reason: unknown } => x !== null);

    if (failures.length > 0) {
      console.warn(
        `[useRobotSelection] ${failures.length}/${MUXES.length} mux switches failed:`,
        failures
      );
    }
  }, []);

  return { selectedRobotId, selectRobot };
}

export default useRobotSelection;