"""Renova o long-lived token (~60 dias de validade).

ATENÇÃO: o endpoint de renovação depende do tipo de login do seu app:
  - Instagram Login (graph.instagram.com): usa /refresh_access_token (ig_refresh_token)
  - Facebook Login (graph.facebook.com): re-troca via /oauth/access_token (fb_exchange_token)
    e precisa de APP_ID + APP_SECRET.

Este script cobre o caso Facebook Login (Business via Página), o mais comum.
Ajuste se o seu app usar Instagram Login.
"""
from __future__ import annotations

import os

import requests
from dotenv import load_dotenv

load_dotenv()

GRAPH = os.getenv("GRAPH_HOST", "https://graph.facebook.com")
VERSION = os.getenv("GRAPH_VERSION", "v21.0")


def refresh_facebook_long_lived() -> str:
    app_id = os.environ["FB_APP_ID"]
    app_secret = os.environ["FB_APP_SECRET"]
    current = os.environ["IG_ACCESS_TOKEN"]

    resp = requests.get(
        f"{GRAPH}/{VERSION}/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": current,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data["access_token"]
    expires = data.get("expires_in", "?")
    print("Novo token gerado. Atualize IG_ACCESS_TOKEN no .env / Secret.")
    print(f"Expira em ~{expires} segundos.")
    print(token)
    return token


if __name__ == "__main__":
    refresh_facebook_long_lived()
