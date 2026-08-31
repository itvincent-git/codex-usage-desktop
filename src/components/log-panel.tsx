import { useEffect, useState, useRef } from "react";
import { attachLogger, LogLevel } from "@tauri-apps/plugin-log";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Check, Copy, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface LogEntry {
  id: number;
  time: Date;
  level: LogLevel;
  message: string;
}

interface LogPanelProps {
  isActive: boolean;
}

export function LogPanel({ isActive }: LogPanelProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;
    
    attachLogger((payload) => {
      if (!active) return;
      setCopied(false);
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
      if (!active) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isActive, logs]);

  async function copyLogs() {
    const text = logs.map((log) => (
      `[${log.time.toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 })}] ${getLevelName(log.level)} ${log.message}`
    )).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

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
          {t("logs.title", { defaultValue: "Diagnostics Log" })}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={logs.length === 0} onClick={() => void copyLogs()}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied
              ? t("logs.btn_copied", { defaultValue: "Copied" })
              : t("logs.btn_copy", { defaultValue: "Copy" })}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { setLogs([]); setCopied(false); }}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t("logs.btn_clear", { defaultValue: "Clear" })}
          </Button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <div className="text-center text-muted-foreground mt-10">{t("logs.waiting", { defaultValue: "Waiting for logs..." })}</div>
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
