"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function login() {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert("Erro no login: " + error.message);
    } else {
      router.push("/");
    }
  }

  async function criarConta() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      alert("Erro ao criar conta: " + error.message);
    } else {
      alert("Conta criada! Agora faça login.");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 28,
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 34,
            fontWeight: 900,
            color: "#111827",
          }}
        >
          GastosLucca
        </h1>

        <p
          style={{
            marginTop: 8,
            marginBottom: 24,
            color: "#6b7280",
            fontSize: 15,
          }}
        >
          Entre com sua conta para acessar seus lançamentos.
        </p>

        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <label
              style={{
                display: "block",
                marginBottom: 6,
                fontWeight: 700,
                color: "#111827",
              }}
            >
              Email
            </label>
            <input
              type="email"
              placeholder="seuemail@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 16,
                outline: "none",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: 6,
                fontWeight: 700,
                color: "#111827",
              }}
            >
              Senha
            </label>
            <input
              type="password"
              placeholder="Digite sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 16,
                outline: "none",
              }}
            />
          </div>

          <button
            onClick={login}
            style={{
              marginTop: 8,
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              background: "#111827",
              color: "white",
              fontSize: 16,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Entrar
          </button>

          <button
            onClick={criarConta}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "white",
              color: "#111827",
              fontSize: 16,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Criar conta
          </button>
        </div>
      </div>
    </div>
  );
}