"use client";

import { useEffect, useState } from "react";
import { finishLogin } from "@/lib/auth";

export default function CallbackPage() {
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) { setError("Authorization response is incomplete."); return; }
    finishLogin(code, state).then(() => location.replace("/")).catch((reason) => setError(String(reason)));
  }, []);
  return <main className="grid min-h-screen place-items-center"><p>{error || "Completing secure login..."}</p></main>;
}

