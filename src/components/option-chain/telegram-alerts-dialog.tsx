"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, CheckCircle2, AlertCircle, Loader2, Trash2 } from "lucide-react";

export function TelegramAlertsDialog() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const checkStatus = () => {
    fetch("/api/telegram", { cache: "no-store" }).then(r => r.json()).then(d => setConfigured(!!d.configured)).catch(() => {});
  };

  useEffect(() => { if (open) checkStatus(); }, [open]);

  const handleSave = async () => {
    if (!botToken || !chatId) return;
    setStatus("saving"); setError("");
    try {
      const res = await fetch("/api/telegram", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, chatId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setStatus("saved"); setConfigured(true);
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err: any) {
      setStatus("error"); setError(err.message || "Failed to connect");
    }
  };

  const handleRemove = async () => {
    await fetch("/api/telegram", { method: "DELETE" });
    setConfigured(false); setBotToken(""); setChatId("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className={`px-2.5 h-8 rounded text-[11px] font-semibold transition-colors flex items-center gap-1.5 border ${configured ? "text-sky-400 border-sky-700/40" : "text-slate-400 hover:text-slate-200 border-[#1c2530]"}`}>
          <Send className="h-3.5 w-3.5" /> {configured ? "Telegram ON" : "Telegram"}
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d1219] border-[#1c2530] text-slate-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100"><Send className="h-4 w-4 text-sky-400" /> Telegram Alerts</DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Get trade alerts (BUY CE/PE, SL hit, target hit) on your phone via Telegram — even when this app's window is closed. The app just needs to keep running in the background (see the tray icon / "Run in background" setting) since it's what actually watches the market.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-[#1c2530] bg-[#0a0e14] px-3 py-2.5 space-y-1 text-[11px] text-slate-400">
          <div className="font-semibold text-slate-300">One-time setup (2 minutes):</div>
          <div>1. In Telegram, message <span className="text-sky-400">@BotFather</span> → <code className="text-slate-300">/newbot</code> → copy the token it gives you.</div>
          <div>2. Message <span className="text-sky-400">@userinfobot</span> to get your own numeric Chat ID.</div>
          <div>3. Message your new bot once (anything) so it's allowed to message you back.</div>
          <div>4. Paste both below.</div>
        </div>

        {configured && (
          <div className="rounded-md border border-emerald-700/40 bg-emerald-500/10 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span>
            <Button size="sm" variant="outline" onClick={handleRemove} className="h-7 bg-[#0f1620] border-rose-800/50 text-rose-400 hover:bg-rose-950/40">
              <Trash2 className="h-3 w-3 mr-1" /> Disconnect
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-slate-400">Bot Token</Label>
            <Input value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" type="password" className="bg-[#0f1620] border-[#1c2530] text-slate-200 mt-1" />
          </div>
          <div>
            <Label className="text-xs text-slate-400">Chat ID</Label>
            <Input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="123456789" className="bg-[#0f1620] border-[#1c2530] text-slate-200 mt-1" />
          </div>
        </div>

        {status === "error" && (
          <div className="rounded-md border border-rose-700/40 bg-rose-500/10 px-3 py-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400" /><span className="text-xs text-rose-300">{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleSave} disabled={status === "saving" || !botToken || !chatId} className="bg-sky-600 hover:bg-sky-500 text-white">
            {status === "saving" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            {status === "saving" ? "Sending test message…" : "Save & Send Test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
