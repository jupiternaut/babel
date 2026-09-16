import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConsoleCommand,
  Operation,
  ProcessInfo,
  ResourceSnapshot,
  ServiceDefinition,
  ServiceSnapshot,
} from "../../../../../babel/src/system/types";
import { connectConsole, consoleRequest } from "./client";

export interface ServiceEntry {
  definition: ServiceDefinition;
  snapshot: ServiceSnapshot;
}
export function useSystemConsole() {
  const [resources, setResources] = useState<ResourceSnapshot>();
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string[]>([]);
  const [elevating, setElevating] = useState(false);
  const alive = useRef(true);
  const polling = useRef<AbortController | null>(null);
  const actionControllers = useRef(new Set<AbortController>());
  const busyTargets = useRef(new Set<string>());
  const connecting = useRef(false);
  const paused = useRef(false);
  const refresh = useCallback(async () => {
    if (polling.current || paused.current || document.hidden || !alive.current)
      return;
    const controller = new AbortController();
    polling.current = controller;
    setLoading(true);
    try {
      const [r, p, s, o] = await Promise.all([
        consoleRequest<ResourceSnapshot>(
          "query",
          { name: "resources" },
          controller.signal
        ),
        consoleRequest<ProcessInfo[]>(
          "query",
          { name: "processes" },
          controller.signal
        ),
        consoleRequest<{ services: ServiceEntry[] }>(
          "query",
          { name: "services" },
          controller.signal
        ),
        consoleRequest<Operation[]>(
          "query",
          { name: "operations", limit: 100 },
          controller.signal
        ),
      ]);
      if (!alive.current || controller.signal.aborted) return;
      setResources(r);
      setProcesses(p);
      setServices(s.services);
      setOperations(o);
      setLastUpdated(Date.now());
      setError("");
      setConnected(true);
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setError(String(e));
        setConnected(false);
      }
    } finally {
      if (polling.current === controller) polling.current = null;
      if (alive.current) setLoading(false);
    }
  }, []);
  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    setLoading(true);
    setError("");
    try {
      await connectConsole();
      if (alive.current) {
        setConnected(true);
        await refresh();
      }
    } catch (e) {
      if (alive.current) {
        setError(String(e));
        setConnected(false);
      }
    } finally {
      connecting.current = false;
      if (alive.current) setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    alive.current = true;
    void connect();
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 5000);
    const visibility = () => {
      if (document.hidden) polling.current?.abort();
      else void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      polling.current?.abort();
      for (const controller of actionControllers.current) controller.abort();
    };
  }, [connect, refresh]);
  const act = useCallback(
    async (command: Omit<ConsoleCommand, "requestId">) => {
      const target = command.serviceId ?? `process:${command.process?.pid}`;
      if (busyTargets.current.has(target)) return;
      busyTargets.current.add(target);
      setBusy([...busyTargets.current]);
      setActionError("");
      const controller = new AbortController();
      actionControllers.current.add(controller);
      try {
        const operation = await consoleRequest<Operation>(
          "command",
          { ...command, requestId: crypto.randomUUID() },
          controller.signal
        );
        if (alive.current) {
          setOperations((old) => [
            operation,
            ...old.filter((o) => o.id !== operation.id),
          ]);
          if (
            operation.status === "failed" ||
            operation.status === "interrupted"
          )
            throw new Error(
              operation.error?.message ?? "Operation did not complete"
            );
          polling.current?.abort();
          polling.current = null;
          await refresh();
        }
      } catch (e) {
        if (alive.current && !controller.signal.aborted)
          setActionError(String(e));
      } finally {
        busyTargets.current.delete(target);
        actionControllers.current.delete(controller);
        if (alive.current) setBusy([...busyTargets.current]);
      }
    },
    [refresh]
  );
  const elevate = useCallback(async () => {
    paused.current = true;
    setElevating(true);
    setError("");
    setActionError("");
    polling.current?.abort();
    try {
      const reply = await window.electronAPI.invoke("system-console:elevate");
      if (!reply.ok)
        throw new Error(`${reply.error.code}: ${reply.error.message}`);
      paused.current = false;
      if (alive.current) await refresh();
    } catch (e) {
      if (alive.current) {
        setError(String(e));
        setConnected(false);
      }
    } finally {
      paused.current = false;
      if (alive.current) setElevating(false);
    }
  }, [refresh]);
  const sampledAt = resources ? Date.parse(resources.sampledAt) : NaN;
  const stale =
    !connected ||
    !lastUpdated ||
    now - lastUpdated > 20000 ||
    !Number.isFinite(sampledAt) ||
    now - sampledAt > 20000;
  return {
    resources,
    processes,
    services,
    operations,
    error: actionError || error,
    loading,
    connected,
    lastUpdated,
    stale: stale || elevating,
    busy,
    refresh,
    connect,
    act,
    elevate,
    elevating,
  };
}
