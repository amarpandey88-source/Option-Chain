"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Key, CheckCircle2, AlertCircle, ExternalLink, Loader2, Save, Trash2, LogIn, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApiKeysDialogProps {
  onConfigChanged: () => void;
}

const BROKER_INFO = {
  icici: {
    label: "ICICI Direct (Breeze API)",
    signupUrl: "https://api.icicidirect.com/breezeapi",
    fields: [
      { key: "apiKey", label: "API Key (AppKey)", placeholder: "your_api_key", required: true },
      { key: "secretKey", label: "Secret Key", placeholder: "your_secret_key", required: true, type: "password" },
      { key: "sessionToken", label: "Session Token (daily)", placeholder: "the API_Session value from step 2 below", required: true, type: "password" },
    ],
    help: "1) Register an app at https://api.icicidirect.com/breezeapi (approval takes 24-48 hrs). 2) Every day, visit https://api.icicidirect.com/apiuser/login?api_key=YOUR_API_KEY in a browser, log in, and copy the API_Session value from the redirect URL's address bar — paste it above as the Session Token. Breeze has no fully automatic login; this manual step is required daily and expires at midnight.",
  },
  angel: {
    label: "Angel One (SmartAPI)",
    signupUrl: "https://smartapi.angelone.in",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "your_api_key", required: true },
      { key: "secretKey", label: "Secret Key", placeholder: "your_secret_key", required: true, type: "password" },
      { key: "clientCode", label: "Client Code", placeholder: "your_client_code", required: true },
      { key: "password", label: "MPIN / Password", placeholder: "your_password", required: true, type: "password" },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "for auto-login", required: false },
    ],
    help: "Login to SmartAPI → Apps → Create New App. Get API Key + Secret instantly. Best documentation of all Indian brokers.",
  },
  dhan: {
    label: "Dhan (simplest)",
    signupUrl: "https://dhanhq.co",
    fields: [
      { key: "accessToken", label: "Access Token", placeholder: "your_access_token", required: true, type: "password" },
      { key: "clientId", label: "Client ID", placeholder: "your_client_id", required: true },
    ],
    help: "Login to Dhan → API → Generate Access Token. Only 2 fields needed. Free with Dhan account.",
  },
  fyers: {
    label: "Fyers",
    signupUrl: "https://myapi.fyers.in/dashboard",
    oauth: true,
    fields: [
      { key: "appId", label: "App ID", placeholder: "your_app_id-100", required: true },
      { key: "secretId", label: "Secret ID", placeholder: "your_secret_id", required: true, type: "password" },
      { key: "accessToken", label: "Access Token (auto-filled after login, or paste manually)", placeholder: "your_access_token", required: false, type: "password" },
    ],
    help: "One-time setup: create an app at myapi.fyers.in/dashboard, and set its Redirect URL to the exact address shown below. After that, enter your App ID + Secret ID here and click \"Connect via Fyers Login\" — no browser or manual copy-paste needed, even for the daily token refresh. Note: the option-chain request/response format is confirmed from Fyers' own docs and SDK, but the exact endpoint path wasn't independently verified by us — if it fails, check https://myapi.fyers.in/docsv3 (Data API → Option Chain).",
  },
  zerodha: {
    label: "Zerodha Kite (coming soon)",
    notReady: true,
    signupUrl: "https://developers.kite.trade",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "your_api_key", required: true },
      { key: "apiSecret", label: "API Secret", placeholder: "your_api_secret", required: true, type: "password" },
      { key: "accessToken", label: "Access Token", placeholder: "your_access_token", required: true, type: "password" },
    ],
    help: "Not wired up yet — the app doesn't have a confirmed/verified option-chain endpoint for Zerodha, so saving keys here won't do anything useful right now. Use ICICI, Angel One, Dhan, or Groww instead.",
  },
  groww: {
    label: "Groww (free)",
    signupUrl: "https://groww.in/trade-api",
    fields: [
      { key: "accessToken", label: "Access Token", placeholder: "your_groww_access_token", required: true, type: "password" },
      { key: "clientId", label: "Client ID (optional)", placeholder: "your_groww_client_id", required: false },
    ],
    help: "Login to Groww → Trade API → Generate Access Token. Token is TOTP-based, expires daily. Only 1-2 fields needed. Free with Groww account.",
  },
};

export function ApiKeysDialog({ onConfigChanged }: ApiKeysDialogProps) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<keyof typeof BROKER_INFO>("icici");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [configuredProvider, setConfiguredProvider] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "waiting" | "success" | "error">("idle");
  const [oauthError, setOauthError] = useState("");
  const [redirectUriCopied, setRedirectUriCopied] = useState(false);
  const oauthPollRef = useRef<{ timer: ReturnType<typeof setInterval> | null; popup: Window | null }>({ timer: null, popup: null });

  // Check current config status
  const checkStatus = async () => {
    try {
      const res = await fetch("/api/broker-config", { cache: "no-store" });
      const data = await res.json();
      setIsConfigured(data.configured);
      setConfiguredProvider(data.provider);
    } catch {}
  };

  useEffect(() => {
    if (open) checkStatus();
  }, [open]);

  // Stop any in-flight OAuth poll/popup if the dialog is closed mid-flow.
  useEffect(() => {
    if (!open) {
      if (oauthPollRef.current.timer) clearInterval(oauthPollRef.current.timer);
      oauthPollRef.current = { timer: null, popup: null };
    }
  }, [open]);

  // ---------------------------------------------------------------------
  // Fyers in-app OAuth login — no system browser, no manual token paste.
  // 1) Ask our server for a login URL (it stashes App ID + Secret ID
  //    server-side, keyed by a one-time state token).
  // 2) Open that URL in a popup. In the Electron build, main.js opens this
  //    as a small in-app child window instead of the system browser.
  // 3) Poll /api/broker-config in the background — once our server-side
  //    callback route has exchanged the code for a token and saved it,
  //    `configured` flips to true with provider "fyers" and we're done.
  //    (Simpler and more robust across Electron/plain-browser than wiring
  //    up postMessage/IPC just for this one flow.)
  // ---------------------------------------------------------------------
  const handleFyersOAuthLogin = async () => {
    setOauthStatus("waiting");
    setOauthError("");
    try {
      if (!credentials.appId || !credentials.secretId) {
        throw new Error("Enter your App ID and Secret ID first.");
      }
      const res = await fetch("/api/broker-config/fyers/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: credentials.appId, secretId: credentials.secretId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start Fyers login");

      const popup = window.open(data.authUrl, "fyers_oauth", "width=480,height=720");
      if (!popup) throw new Error("Popup blocked — allow popups for this app and try again.");

      const startedAt = Date.now();
      const timer = setInterval(async () => {
        // Give up after 3 minutes or if the user closed the popup without finishing.
        if (Date.now() - startedAt > 3 * 60 * 1000 || popup.closed) {
          clearInterval(timer);
          oauthPollRef.current = { timer: null, popup: null };
          setOauthStatus((prev) => (prev === "success" ? prev : "error"));
          setOauthError((prev) => prev || "Login window closed before finishing — try again.");
          return;
        }
        try {
          const statusRes = await fetch("/api/broker-config", { cache: "no-store" });
          const statusData = await statusRes.json();
          if (statusData.configured && statusData.provider === "fyers") {
            clearInterval(timer);
            oauthPollRef.current = { timer: null, popup: null };
            setOauthStatus("success");
            try { popup.close(); } catch {}
            checkStatus();
            onConfigChanged();
            setTimeout(() => setOauthStatus("idle"), 4000);
          }
        } catch {
          // Transient — keep polling, the 3-minute timeout above is the real backstop.
        }
      }, 1500);
      oauthPollRef.current = { timer, popup };
    } catch (err: any) {
      setOauthStatus("error");
      setOauthError(err.message || "Failed to start Fyers login");
    }
  };

  const handleCopyRedirectUri = () => {
    navigator.clipboard.writeText("http://127.0.0.1:3000/api/broker-config/fyers/callback").then(() => {
      setRedirectUriCopied(true);
      setTimeout(() => setRedirectUriCopied(false), 2000);
    });
  };

  const handleSave = async () => {
    setStatus("saving");
    setErrorMessage("");
    try {
      const info = BROKER_INFO[provider];
      // Validate required fields
      for (const field of info.fields) {
        if (field.required && !credentials[field.key]) {
          throw new Error(`Missing required field: ${field.label}`);
        }
      }
      const res = await fetch("/api/broker-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credentials }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setStatus("saved");
      checkStatus();
      onConfigChanged();
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to save");
    }
  };

  const handleDisconnect = async () => {
    setStatus("saving");
    try {
      await fetch("/api/broker-config", { method: "DELETE" });
      setCredentials({});
      setStatus("idle");
      checkStatus();
      onConfigChanged();
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message);
    }
  };

  const info = BROKER_INFO[provider];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "bg-[#0f1620] border-[#1c2530] text-slate-300 hover:text-slate-100 hover:bg-[#1a2230]",
            isConfigured && "border-emerald-700/40 text-emerald-400"
          )}
        >
          <Key className="h-3.5 w-3.5 mr-1" />
          API Keys
          {isConfigured && <CheckCircle2 className="h-3 w-3 ml-1 text-emerald-500" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#0f1620] border-[#1c2530] text-slate-200 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-amber-400" />
            Broker API Keys
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Connect your broker to get real option chain OI (makes PCR, Max Pain, GEX 100% real). Without keys, the app uses Yahoo Finance (free, hybrid mode).
          </DialogDescription>
        </DialogHeader>

        {/* Current status */}
        {isConfigured && (
          <div className="rounded-md border border-emerald-700/40 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <div className="flex-1">
              <div className="text-xs text-emerald-300 font-semibold">Connected: {configuredProvider?.toUpperCase()}</div>
              <div className="text-[10px] text-slate-400">Keys apply immediately — no restart needed.</div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-rose-400 hover:bg-rose-950/30" onClick={handleDisconnect} disabled={status === "saving"}>
              <Trash2 className="h-3 w-3 mr-1" />Disconnect
            </Button>
          </div>
        )}

        {/* Provider selector */}
        <div className="space-y-2">
          <Label className="text-xs">Select your broker</Label>
          <Select value={provider} onValueChange={(v) => { setProvider(v as keyof typeof BROKER_INFO); setCredentials({}); }}>
            <SelectTrigger className="bg-[#0a0e14] border-[#1c2530]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0f1620] border-[#1c2530]">
              {Object.entries(BROKER_INFO).map(([key, val]) => (
                <SelectItem key={key} value={key} className="text-sm" disabled={"notReady" in val && val.notReady}>
                  {val.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Help link */}
        <div className="rounded-md bg-[#0a0e14] border border-[#1c2530] px-3 py-2">
          <div className="text-[11px] text-slate-400 mb-1">{info.help}</div>
          <a href={info.signupUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1">
            Get API keys <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Fyers-only: one-time redirect URL to paste into the Fyers dashboard app */}
        {"oauth" in info && info.oauth && (
          <div className="rounded-md bg-[#0a0e14] border border-[#1c2530] px-3 py-2 space-y-1.5">
            <div className="text-[11px] text-slate-400">
              One-time: set this as your Fyers app's <strong className="text-slate-300">Redirect URL</strong>
            </div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-[11px] text-cyan-300 font-mono bg-[#0f1620] border border-[#1c2530] rounded px-2 py-1 truncate">
                http://127.0.0.1:3000/api/broker-config/fyers/callback
              </code>
              <Button size="sm" variant="outline" className="h-7 px-2 bg-[#0f1620] border-[#1c2530]" onClick={handleCopyRedirectUri}>
                {redirectUriCopied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-slate-400" />}
              </Button>
            </div>
          </div>
        )}

        {/* Credential fields */}
        <div className="space-y-3">
          {info.fields.map((field) => (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-rose-400">*</span>}
              </Label>
              <Input
                type={field.type === "password" ? "password" : "text"}
                placeholder={field.placeholder}
                value={credentials[field.key] || ""}
                onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })}
                className="bg-[#0a0e14] border-[#1c2530] text-slate-100 font-mono text-sm"
              />
            </div>
          ))}
        </div>

        {/* Fyers-only: in-app OAuth login button */}
        {"oauth" in info && info.oauth && (
          <>
            <Button
              size="sm"
              onClick={handleFyersOAuthLogin}
              disabled={oauthStatus === "waiting" || !credentials.appId || !credentials.secretId}
              className="w-full bg-cyan-700 hover:bg-cyan-600 text-white"
            >
              {oauthStatus === "waiting" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <LogIn className="h-3.5 w-3.5 mr-1" />
              )}
              {oauthStatus === "waiting" ? "Waiting for login..." : "Connect via Fyers Login"}
            </Button>
            {oauthStatus === "success" && (
              <div className="rounded-md border border-emerald-700/40 bg-emerald-500/10 px-3 py-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-xs text-emerald-300">Connected! Access token saved automatically.</span>
              </div>
            )}
            {oauthStatus === "error" && (
              <div className="rounded-md border border-rose-700/40 bg-rose-500/10 px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400" />
                <span className="text-xs text-rose-300">{oauthError}</span>
              </div>
            )}
            <div className="text-[10px] text-slate-500 text-center">— or paste an access token manually below —</div>
          </>
        )}

        {/* Status messages */}
        {status === "saved" && (
          <div className="rounded-md border border-emerald-700/40 bg-emerald-500/10 px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-xs text-emerald-300">Saved! Switch to Broker mode above to use it.</span>
          </div>
        )}
        {status === "error" && (
          <div className="rounded-md border border-rose-700/40 bg-rose-500/10 px-3 py-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400" />
            <span className="text-xs text-rose-300">{errorMessage}</span>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" className="bg-[#0a0e14] border-[#1c2530] text-slate-300">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleSave} disabled={status === "saving"} className="bg-amber-700 hover:bg-amber-600 text-white">
            {status === "saving" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save Keys
          </Button>
        </DialogFooter>

        {/* Security note */}
        <div className="text-[10px] text-slate-500 leading-relaxed border-t border-[#1c2530] pt-2">
          🔒 Your API keys are stored locally in <code className="text-slate-400">.env.local</code> on this server only.
          They are never sent anywhere except directly to your broker's API.
          For desktop app builds, keys are bundled into the .exe (offline, secure).
        </div>
      </DialogContent>
    </Dialog>
  );
}
