'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { useROS } from '@/hooks/useROS';
import { TOPICS } from '@/lib/rosTopics';
import type { AlertMessage, AlertSeverity, AlertType } from '@/types/ros';

const MAX_ALERTS = 50;
const GRAFANA_URL = 'http://localhost:3001';
const LS_ALERTS_KEY = 'rosviz_alerts';
const LS_ACKED_KEY = 'rosviz_acknowledged';

interface StringMessage {
  data: string;
}

function severityClasses(severity: AlertSeverity): string {
  return severity === 'critical'
    ? 'bg-red-600 text-white'
    : 'bg-yellow-500 text-black';
}

function AlertIcon({ type }: { type: AlertType }) {
  const cls = 'w-3 h-3 flex-shrink-0';
  return type === 'COLLISION' || type === 'CONNECTION_LOSS' || type === 'TILT_WARNING' || type === 'GEOFENCE_BREACH' || type === 'BATTERY_FAULT'
    ? <AlertCircle className={cls} />
    : <AlertTriangle className={cls} />;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatMeasurement(type: AlertType, value: number, threshold: number): string {
  switch (type) {
    case 'COLLISION':         return `${value.toFixed(2)} m / limit ${threshold.toFixed(2)} m`;
    case 'VELOCITY_EXCEEDED': return `${value.toFixed(2)} m/s / limit ${threshold.toFixed(2)} m/s`;
    case 'CONNECTION_LOSS':   return `silent ${value.toFixed(0)} s / limit ${threshold.toFixed(0)} s`;
    case 'LOW_BATTERY':       return `${value.toFixed(0)}% / limit ${threshold.toFixed(0)}%`;
    case 'IMPACT_DETECTED':   return `${value.toFixed(1)} m/s² / limit ${threshold.toFixed(1)} m/s²`;
    case 'TILT_WARNING':      return `${value.toFixed(1)}° / limit ${threshold.toFixed(1)}°`;
    case 'MOTOR_STALL':       return `${value.toFixed(3)} rad/s / limit ${threshold.toFixed(3)} rad/s`;
    case 'GEOFENCE_BREACH':   return `${value.toFixed(1)} m from origin`;
    case 'BATTERY_FAULT':    return `health code ${value.toFixed(0)} (1=good)`;
    case 'MOTOR_OVERLOAD':   return `${value.toFixed(2)} N·m / limit ${threshold.toFixed(2)} N·m`;
    case 'VERTICAL_SHOCK':   return `${value.toFixed(1)} m/s² change / limit ${threshold.toFixed(1)} m/s²`;
    case 'WHEEL_SLIP':       return `wheel ${value.toFixed(2)} rad/s / odom ${threshold.toFixed(2)} m/s`;
    default:                  return `${value.toFixed(2)} / ${threshold.toFixed(2)}`;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      try {
        const stored: AlertMessage[] = JSON.parse(localStorage.getItem(LS_ALERTS_KEY) ?? '[]');
        const ackedRaw: string[] = JSON.parse(localStorage.getItem(LS_ACKED_KEY) ?? '[]');
        const ackedSet = new Set(ackedRaw);
        const trimmed = [
          ...stored.filter(a => !ackedSet.has(a.id)),
          ...stored.filter(a => ackedSet.has(a.id)).slice(-10),
        ].slice(-MAX_ALERTS);
        localStorage.setItem(LS_ALERTS_KEY, JSON.stringify(trimmed));
        localStorage.setItem(key, value);
      } catch {
        // Storage completely full — skip persistence this cycle
      }
    }
  }
}

function loadAlerts(): AlertMessage[] {
  try {
    return JSON.parse(localStorage.getItem(LS_ALERTS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function loadAcknowledged(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_ACKED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export default function AlertHistory() {
  const [alerts, setAlerts] = useState<AlertMessage[]>(loadAlerts);
  const [autoStopEnabled, setAutoStopEnabled] = useState(false);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(loadAcknowledged);
  const [missedCount, setMissedCount] = useState(0);
  const [filterSeverity, setFilterSeverity] = useState<'all' | AlertSeverity>('all');
  const [filterRobotId, setFilterRobotId] = useState<number | null>(null);
  const [critFlash, setCritFlash] = useState(false);
  const disconnectTimeRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { subscribe, publish, isConnected } = useROS({ url: 'ws://localhost:9090' });
  const prevConnectedRef = useRef(isConnected);

  const robotIds = useMemo(
    () => [...new Set(alerts.map(a => a.robot_id))].sort((a, b) => a - b),
    [alerts]
  );

  const filteredAlerts = useMemo(
    () => alerts
      .filter(a =>
        (filterSeverity === 'all' || a.severity === filterSeverity) &&
        (filterRobotId === null || a.robot_id === filterRobotId)
      )
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        return b.timestamp - a.timestamp;
      }),
    [alerts, filterSeverity, filterRobotId]
  );

  const critUnacked = useMemo(
    () => alerts.filter(a => a.severity === 'critical' && !acknowledgedIds.has(a.id)).length,
    [alerts, acknowledgedIds]
  );

  const warnUnacked = useMemo(
    () => alerts.filter(a => a.severity === 'warning' && !acknowledgedIds.has(a.id)).length,
    [alerts, acknowledgedIds]
  );

  // Persist alerts to localStorage whenever they change
  useEffect(() => {
    safeSetItem(LS_ALERTS_KEY, JSON.stringify(alerts));
  }, [alerts]);

  // Request history immediately on reconnect — don't wait for the 5s broadcast timer
  useEffect(() => {
    if (isConnected && !prevConnectedRef.current) {
      publish(TOPICS.robotAlertsRequestHistory.path, TOPICS.robotAlertsRequestHistory.type, { data: '' });
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, publish]);

  // Track disconnection windows to report missed alerts on reconnect
  useEffect(() => {
    if (!isConnected) {
      disconnectTimeRef.current = Date.now();
    } else if (disconnectTimeRef.current !== null) {
      const gapStart = disconnectTimeRef.current / 1000;
      const missed = alerts.filter(a => a.timestamp >= gapStart).length;
      if (missed > 0) setMissedCount(missed);
      disconnectTimeRef.current = null;
    }
  }, [isConnected, alerts]);

  function toggleAutoStop() {
    const next = !autoStopEnabled;
    publish(TOPICS.safetyAutoStop.path, TOPICS.safetyAutoStop.type, { data: next });
  }

  function acknowledge(id: string) {
    setAcknowledgedIds(prev => {
      const next = new Set(prev).add(id);
      safeSetItem(LS_ACKED_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function clearHistory() {
    setAlerts([]);
    setAcknowledgedIds(new Set());
    safeSetItem(LS_ALERTS_KEY, '[]');
    safeSetItem(LS_ACKED_KEY, '[]');
  }

  function acknowledgeAll() {
    setAcknowledgedIds(prev => {
      const next = new Set(prev);
      filteredAlerts.forEach(a => next.add(a.id));
      safeSetItem(LS_ACKED_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  useEffect(() => {
    const unsubAlert = subscribe<StringMessage>(
      TOPICS.robotAlerts.path,
      TOPICS.robotAlerts.type,
      (msg) => {
        try {
          const alert: AlertMessage = JSON.parse(msg.data);
          setAlerts(prev => [alert, ...prev].slice(0, MAX_ALERTS));
          if (alert.severity === 'critical') {
            setCritFlash(true);
            if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
            flashTimeoutRef.current = setTimeout(() => setCritFlash(false), 2000);
          }
        } catch (e) {
          console.warn("[AlertHistory] parse failed:", e, "raw:", msg.data);
        }
      }
    );

    const unsubHistory = subscribe<StringMessage>(
      TOPICS.robotAlertsHistory.path,
      TOPICS.robotAlertsHistory.type,
      (msg) => {
        try {
          const history: AlertMessage[] = JSON.parse(msg.data);
          setAlerts(prev => {
            const existingIds = new Set(prev.map(a => a.id));
            const newItems = history.filter(a => !existingIds.has(a.id));
            return [...prev, ...newItems]
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, MAX_ALERTS);
          });
        } catch {
          // ignore malformed messages
        }
      }
    );

    const unsubAutoStop = subscribe<{ data: boolean }>(
      TOPICS.safetyAutoStopStatus.path,
      TOPICS.safetyAutoStopStatus.type,
      (msg) => setAutoStopEnabled(msg.data),
    );

    return () => {
      unsubAlert();
      unsubHistory();
      unsubAutoStop();
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, [subscribe]);

  return (
    <div className={`h-full bg-[#1a1a1a] rounded-sm p-2 border flex flex-col transition-colors duration-500 ${critFlash ? 'border-red-500' : 'border-[#2a2a2a]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[#00a5ff] text-sm font-semibold">Alert History</span>
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-gray-500">
            {'Crit('}
            <span className="text-red-400">{alerts.filter(a => a.severity === 'critical').length}</span>
            {')('}
            <span className="text-red-400 font-bold">{critUnacked}</span>
            {') Warn('}
            <span className="text-yellow-400">{alerts.filter(a => a.severity === 'warning').length}</span>
            {')('}
            <span className="text-yellow-400 font-bold">{warnUnacked}</span>
            {')'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAutoStop}
            disabled={!isConnected}
            title={autoStopEnabled ? 'Auto-stop ON — click to disable' : 'Auto-stop OFF — click to enable'}
            className={`text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 ${
              autoStopEnabled
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-red-700 text-white hover:bg-red-800'
            }`}
          >
            {autoStopEnabled ? 'Auto-stop ON' : 'Auto-stop OFF'}
          </button>
          <button
            onClick={clearHistory}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
            title="Clear all alert history"
          >
            Clear
          </button>
          <a
            href={GRAFANA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#00a5ff] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Grafana
          </a>
        </div>
      </div>

      {/* Filter + ack-all row */}
      {alerts.length > 0 && (
        <div className="flex items-center gap-1 mb-1 flex-shrink-0 flex-wrap">
          {(['all', 'critical', 'warning'] as const).map(s => (
            <button key={s} onClick={() => setFilterSeverity(s)}
              className={`text-xs px-1.5 py-0.5 rounded ${
                filterSeverity === s ? 'bg-[#00a5ff] text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'
              }`}>
              {s === 'all' ? 'All' : s === 'critical' ? 'CRIT' : 'WARN'}
            </button>
          ))}
          <span className="text-gray-600 text-xs">|</span>
          <select
            value={filterRobotId === null ? '' : String(filterRobotId)}
            onChange={e => setFilterRobotId(e.target.value === '' ? null : Number(e.target.value))}
            className="text-xs bg-[#2a2a2a] text-gray-300 rounded px-1.5 py-0.5 border border-[#3a3a3a] focus:outline-none focus:border-[#00a5ff]"
          >
            <option value="">All robots</option>
            {robotIds.map(id => (
              <option key={id} value={String(id)}>tb3_{id}</option>
            ))}
          </select>
          {filteredAlerts.some(a => !acknowledgedIds.has(a.id)) && (
            <button onClick={acknowledgeAll}
              className="text-xs text-gray-500 hover:text-white ml-auto">
              Ack all
            </button>
          )}
        </div>
      )}

      {/* Missed-alert banner */}
      {missedCount > 0 && (
        <div className="flex items-center justify-between text-xs bg-yellow-900/40 border border-yellow-700 rounded px-2 py-1 mb-1 flex-shrink-0">
          <span className="text-yellow-400">
            Reconnected — {missedCount} alert{missedCount !== 1 ? 's' : ''} received while offline
          </span>
          <button
            onClick={() => setMissedCount(0)}
            className="text-gray-400 hover:text-white ml-2"
          >✕</button>
        </div>
      )}

      {/* Alert list */}
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-1 pr-0.5 min-h-0">
        {filteredAlerts.length === 0 ? (
          <div className="text-xs text-gray-500 text-center mt-6">
            {alerts.length === 0 ? 'No alerts' : 'No alerts match current filter'}
          </div>
        ) : (
          filteredAlerts.map(alert => {
            const acked = acknowledgedIds.has(alert.id);
            return (
              <div
                key={alert.id}
                className={`bg-[#222222] rounded px-2 py-1.5 border border-[#333333] flex items-start gap-2 ${acked ? 'opacity-40' : ''}`}
              >
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-semibold flex items-center gap-1 flex-shrink-0 mt-0.5 ${severityClasses(alert.severity)}`}
                >
                  <AlertIcon type={alert.alert_type} />
                  {alert.severity === 'critical' ? 'CRIT' : 'WARN'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white leading-tight truncate">
                    {alert.message}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Robot {alert.robot_id} · {formatTime(alert.timestamp)}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5 font-mono">
                    {formatMeasurement(alert.alert_type, alert.value, alert.threshold)}
                  </div>
                </div>
                {!acked && (
                  <button
                    onClick={() => acknowledge(alert.id)}
                    className="mr-1 text-green-600 hover:text-green-400 flex-shrink-0 self-center text-xs"
                    title="Acknowledge"
                  >✓</button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
