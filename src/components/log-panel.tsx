import { useEffect, useState, useRef } from "react";
import { attachLogger, LogLevel } from "@tauri-apps/plugin-log";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LogEntry {
  id: number;
  time: Date;
  level: LogLevel;
  message: string;
}

export function LogPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    
    attachLogger((payload) => {
      setLogs((prev) => {
        const newLogs = [...prev, {
          id: nextId.current++,
          time: new Date(),
          level: payload.level,
          message: payload.message,
        }];
        return newLogs.slice(-1000); // Keep last 1000 logs
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  function getLevelColor(level: LogLevel) {
    switch (level) {
      case LogLevel.Error: return "text-error";
      case LogLevel.Warn: return "text-warning";
      case LogLevel.Info: return "text-primary";
      case LogLevel.Debug: return "text-muted-foreground";
      case LogLevel.Trace: return "text-muted-foreground opacity-50";
      default: return "text-foreground";
    }
  }
  
  function getLevelName(level: LogLevel) {
    switch (level) {
      case LogLevel.Error: return "ERROR";
      case LogLevel.Warn: return "WARN";
      case LogLevel.Info: return "INFO";
      case LogLevel.Debug: return "DEBUG";
      case LogLevel.Trace: return "TRACE";
      default: return "LOG";
    }
  }

  return (
    <div className="flex h-[600px] flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="h-4 w-4" />
          Diagnostics Log
        </div>
        <Button variant="secondary" size="sm" onClick={() => setLogs([])}>
          <Trash2 className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <div className="text-center text-muted-foreground mt-10">Waiting for logs...</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="mb-1 flex gap-3 hover:bg-muted/30">
              <span className="shrink-0 text-muted-foreground">
                {log.time.toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 })}
              </span>
              <span className={`shrink-0 w-12 font-medium ${getLevelColor(log.level)}`}>
                {getLevelName(log.level)}
              </span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
