"""Unified LLM client — supports OpenAI-compatible and Claude-compatible protocols."""

import json
import httpx
from typing import Optional


class AIClient:
    """Stateless LLM client. Instantiate per-request with current config."""

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model_name: str,
        api_protocol: str = "openai",  # "openai" | "claude"
        max_tokens: int = 4096,
        temperature: float = 0.3,
        timeout: float = 30.0,
    ):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name
        self.api_protocol = api_protocol
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.timeout = timeout

    # ── public ──

    async def chat(self, messages: list[dict], **kwargs) -> dict:
        """Send a chat completion request. Returns parsed response dict."""
        if self.api_protocol == "claude":
            return await self._chat_claude(messages, **kwargs)
        return await self._chat_openai(messages, **kwargs)

    async def test_connection(self) -> dict:
        """Light-weight connectivity check. Returns {"ok": bool, "message": str}."""
        try:
            resp = await self.chat(
                [{"role": "user", "content": "Hi, reply with exactly: OK"}],
            )
            content = resp.get("content", "")
            return {"ok": True, "message": f"模型响应正常: {content[:100]}"}
        except Exception as exc:
            return {"ok": False, "message": str(exc)[:500]}

    # ── private: OpenAI compatible ──

    async def _chat_openai(self, messages: list[dict], **kwargs) -> dict:
        url = f"{self.api_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "temperature": kwargs.get("temperature", self.temperature),
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            # Standard OpenAI response shape
            choice = data.get("choices", [{}])[0]
            msg = choice.get("message", {})
            return {
                "content": msg.get("content", ""),
                "role": msg.get("role", "assistant"),
                "usage": data.get("usage", {}),
                "raw": data,
            }

    # ── private: Claude compatible ──

    async def _chat_claude(self, messages: list[dict], **kwargs) -> dict:
        url = f"{self.api_url}/v1/messages"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        # Claude requires system to be separate
        system_text = ""
        claude_messages = []
        for m in messages:
            if m.get("role") == "system":
                system_text += m.get("content", "") + "\n"
            else:
                claude_messages.append({"role": m["role"], "content": m["content"]})

        body = {
            "model": self.model_name,
            "messages": claude_messages,
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
        }
        if system_text.strip():
            body["system"] = system_text.strip()

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            # Claude response shape
            content_blocks = data.get("content", [])
            text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
            return {
                "content": text,
                "role": "assistant",
                "usage": data.get("usage", {}),
                "raw": data,
            }
